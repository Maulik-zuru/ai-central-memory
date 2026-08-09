import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionSource } from './session-source';

/**
 * Claude Code stores one JSONL transcript per session under
 * ~/.claude/projects/<project-slug>/<sessionId>.jsonl, appending a line per event. Conversation
 * lines carry `type: "user" | "assistant"` and a `message.content` that is either a plain string
 * or an array of content blocks; everything else (queue operations, attachments, tool bookkeeping)
 * is ignored.
 *
 * Reads are incremental from a stored byte offset, so appending a line to a multi-megabyte
 * transcript costs one small read rather than a full re-parse.
 */

interface TranscriptLine {
  type?: string;
  message?: { role?: string; content?: unknown };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      block && typeof block === 'object' && (block as { type?: string }).type === 'text'
        ? String((block as { text?: string }).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

export const claudeCodeSource: SessionSource = {
  platform: 'claude-code',
  label: 'Claude Code',
  available: true,
  unavailableReason: '',

  defaultPaths() {
    return [path.join(os.homedir(), '.claude', 'projects')];
  },

  watchGlobs() {
    return ['**/*.jsonl'];
  },

  async parse(filePath, fromByte) {
    const { size } = await fs.stat(filePath);
    // The transcript was rewritten shorter than our offset (rotated, or a fresh session reusing
    // the name). Reading from the stale offset would return garbage or nothing forever, so start
    // over rather than silently going deaf on this file.
    const start = fromByte > size ? 0 : fromByte;
    if (start === size) return { snippets: [], nextByte: size };

    const handle = await fs.open(filePath, 'r');
    let buffer: Buffer;
    try {
      buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
    } finally {
      await handle.close();
    }

    const text = buffer.toString('utf8');
    const lastNewline = text.lastIndexOf('\n');
    // Everything after the final newline is a line another process is still writing. Leave it —
    // the offset stops before it, so the next pass reads it whole.
    const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline + 1);
    const nextByte = start + Buffer.byteLength(complete, 'utf8');

    const snippets: string[] = [];
    for (const raw of complete.split('\n')) {
      if (!raw.trim()) continue;
      let parsed: TranscriptLine;
      try {
        parsed = JSON.parse(raw) as TranscriptLine;
      } catch {
        // A line that is complete but not valid JSON will never become valid. Skipping it (rather
        // than holding the offset) is what stops one bad line from stalling a file forever.
        continue;
      }
      if (parsed.type !== 'user' && parsed.type !== 'assistant') continue;
      const content = extractText(parsed.message?.content).trim();
      if (content) snippets.push(content);
    }

    return { snippets, nextByte };
  },
};
