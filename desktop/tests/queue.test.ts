import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CaptureQueue } from '../src/main/queue';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-'));
  file = path.join(dir, 'queue.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('CaptureQueue', () => {
  it('survives a restart — items written by one instance are readable by the next', () => {
    const a = new CaptureQueue({ filePath: file });
    a.enqueue({ snippet: 'one', platform: 'claude-code' });
    a.enqueue({ snippet: 'two', platform: 'claude-code' });

    const b = new CaptureQueue({ filePath: file });
    expect(b.pending().map((i) => i.snippet)).toEqual(['one', 'two']);
  });

  it('drops the oldest item when the cap is reached, and counts what it dropped', () => {
    const q = new CaptureQueue({ filePath: file, maxItems: 2 });
    q.enqueue({ snippet: 'one', platform: 'claude-code' });
    q.enqueue({ snippet: 'two', platform: 'claude-code' });
    q.enqueue({ snippet: 'three', platform: 'claude-code' });

    expect(q.pending().map((i) => i.snippet)).toEqual(['two', 'three']);
    // Silent truncation reads as "we captured everything". The count is surfaced in the UI.
    expect(q.droppedCount()).toBe(1);
  });

  it('removes an item only once it is confirmed sent', () => {
    const q = new CaptureQueue({ filePath: file });
    const item = q.enqueue({ snippet: 'one', platform: 'claude-code' })!;
    expect(q.pending()).toHaveLength(1);

    q.markSent(item.id);
    expect(q.pending()).toHaveLength(0);
    expect(new CaptureQueue({ filePath: file }).pending()).toHaveLength(0);
  });

  it('records a failure with an attempt count so backoff can widen, keeping the item queued', () => {
    const q = new CaptureQueue({ filePath: file });
    const item = q.enqueue({ snippet: 'one', platform: 'claude-code' })!;

    q.markFailed(item.id, 'network');
    q.markFailed(item.id, 'network');

    const [pending] = q.pending();
    expect(pending.attempts).toBe(2);
    expect(pending.lastError).toBe('network');
  });

  it('tolerates a corrupt line rather than losing the whole queue', () => {
    fs.writeFileSync(file, '{"broken\n' + JSON.stringify({ id: 'a', snippet: 'good', platform: 'claude-code', attempts: 0, queuedAt: '2026-08-09T00:00:00.000Z' }) + '\n');
    const q = new CaptureQueue({ filePath: file });
    expect(q.pending().map((i) => i.snippet)).toEqual(['good']);
  });

  it('compacts the file so a long-running agent does not grow it without bound', () => {
    const q = new CaptureQueue({ filePath: file });
    for (let i = 0; i < 50; i++) {
      const item = q.enqueue({ snippet: `s${i}`, platform: 'claude-code' })!;
      q.markSent(item.id);
    }
    expect(q.pending()).toHaveLength(0);
    // 100 appends (50 enqueue + 50 sent) must not leave 100 lines behind. The file is bounded by
    // the compaction floor rather than driven to zero — compacting on literally every append
    // would rewrite the file constantly on an idle machine, which is the worse trade.
    expect(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length).toBeLessThanOrEqual(64);
  });
});

describe('CaptureQueue deduplication', () => {
  it('refuses a snippet it has already queued, across restarts', () => {
    const a = new CaptureQueue({ filePath: file });
    expect(a.enqueue({ snippet: 'same thing', platform: 'claude-code' })).not.toBeNull();
    expect(a.enqueue({ snippet: 'same thing', platform: 'claude-code' })).toBeNull();

    const b = new CaptureQueue({ filePath: file });
    expect(b.enqueue({ snippet: 'same thing', platform: 'claude-code' })).toBeNull();
  });

  it('treats the same text from a different platform as a different item', () => {
    const q = new CaptureQueue({ filePath: file });
    expect(q.enqueue({ snippet: 'same thing', platform: 'claude-code' })).not.toBeNull();
    expect(q.enqueue({ snippet: 'same thing', platform: 'cursor' })).not.toBeNull();
  });

  it('forgets the oldest hashes once the dedupe window is full, so memory is bounded', () => {
    const q = new CaptureQueue({ filePath: file, maxSeenHashes: 2 });
    q.enqueue({ snippet: 'a', platform: 'claude-code' });
    q.enqueue({ snippet: 'b', platform: 'claude-code' });
    q.enqueue({ snippet: 'c', platform: 'claude-code' });

    // 'a' has aged out of the window and would be accepted again — a bounded window is the
    // deliberate tradeoff, and the server's own suggestion dedupe is the backstop.
    expect(q.enqueue({ snippet: 'a', platform: 'claude-code' })).not.toBeNull();
    expect(q.enqueue({ snippet: 'c', platform: 'claude-code' })).toBeNull();
  });
});
