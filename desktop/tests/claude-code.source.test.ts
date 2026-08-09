import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeCodeSource } from '../src/main/sources/claude-code.source';

// The transcript shape is taken from real Claude Code session files: one JSON object per line,
// `type` of "user" | "assistant", `message.content` either a string or an array of content blocks,
// plus bookkeeping line types that carry no conversation and must be ignored.
function line(obj: unknown) {
  return `${JSON.stringify(obj)}\n`;
}

const USER = line({
  type: 'user',
  message: { role: 'user', content: 'I always deploy with pnpm, never npm.' },
  timestamp: '2026-08-09T05:43:05.265Z',
  cwd: '/home/user/project',
  gitBranch: 'main',
});

const ASSISTANT = line({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Noted — pnpm it is.' }] },
  timestamp: '2026-08-09T05:43:09.100Z',
});

const NOISE = line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-08-09T05:43:04.175Z' });

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-source-'));
  file = path.join(dir, 'session.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('claudeCodeSource.parse', () => {
  it('extracts user and assistant text and ignores bookkeeping lines', async () => {
    fs.writeFileSync(file, NOISE + USER + ASSISTANT);

    const result = await claudeCodeSource.parse(file, 0);
    expect(result.snippets).toHaveLength(2);
    expect(result.snippets[0]).toContain('pnpm');
    expect(result.snippets[1]).toContain('Noted');
    expect(result.nextByte).toBe(fs.statSync(file).size);
  });

  it('resumes from a byte offset — an appended line costs one partial read, not a re-parse', async () => {
    fs.writeFileSync(file, USER);
    const first = await claudeCodeSource.parse(file, 0);
    expect(first.snippets).toHaveLength(1);

    fs.appendFileSync(file, ASSISTANT);
    const second = await claudeCodeSource.parse(file, first.nextByte);
    expect(second.snippets).toHaveLength(1);
    expect(second.snippets[0]).toContain('Noted');
  });

  // The file is being appended to by another process while we read it. A trailing line that has
  // not been fully flushed must be neither dropped nor half-parsed: the offset stays before it so
  // the next pass picks it up whole.
  it('leaves a partially-written trailing line for the next pass', async () => {
    const partial = '{"type":"user","message":{"role":"user","content":"half a th';
    fs.writeFileSync(file, USER + partial);

    const result = await claudeCodeSource.parse(file, 0);
    expect(result.snippets).toHaveLength(1);
    expect(result.nextByte).toBe(Buffer.byteLength(USER));

    fs.writeFileSync(file, USER + line({ type: 'user', message: { role: 'user', content: 'half a thought completed' } }));
    const second = await claudeCodeSource.parse(file, result.nextByte);
    expect(second.snippets).toEqual(['half a thought completed']);
  });

  it('skips malformed lines that will never parse, rather than stalling on them forever', async () => {
    fs.writeFileSync(file, 'not json at all\n' + USER);
    const result = await claudeCodeSource.parse(file, 0);
    expect(result.snippets).toHaveLength(1);
    expect(result.nextByte).toBe(fs.statSync(file).size);
  });

  it('ignores empty and whitespace-only content', async () => {
    fs.writeFileSync(file, line({ type: 'user', message: { role: 'user', content: '   ' } }));
    const result = await claudeCodeSource.parse(file, 0);
    expect(result.snippets).toHaveLength(0);
  });

  it('handles a truncated file by restarting from zero rather than reading past the end', async () => {
    fs.writeFileSync(file, USER + ASSISTANT);
    const full = await claudeCodeSource.parse(file, 0);

    fs.writeFileSync(file, USER); // session file rotated / rewritten shorter
    const after = await claudeCodeSource.parse(file, full.nextByte);
    expect(after.snippets).toHaveLength(1);
    expect(after.nextByte).toBe(fs.statSync(file).size);
  });

  it('reports the platform key the backend gates on', () => {
    expect(claudeCodeSource.platform).toBe('claude-code');
  });
});
