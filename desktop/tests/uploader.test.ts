import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CaptureQueue } from '../src/main/queue';
import { Uploader, backoffMs } from '../src/main/uploader';

let dir: string;
let queue: CaptureQueue;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-'));
  queue = new CaptureQueue({ filePath: path.join(dir, 'queue.jsonl') });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function uploaderWith(send: (item: { snippet: string; platform: string }) => Promise<Response>, onUnauthorized = () => {}) {
  return new Uploader({
    queue,
    apiBaseUrl: 'https://api.test',
    getKey: () => 'mp_testkey',
    onUnauthorized,
    fetchImpl: (_url, init) => send(JSON.parse(String(init?.body)) as { snippet: string; platform: string }),
  });
}

function response(status: number) {
  return new Response(JSON.stringify({}), { status });
}

describe('Uploader', () => {
  it('sends each queued item and clears it on success', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    queue.enqueue({ snippet: 'two', platform: 'claude-code' });

    const sent: string[] = [];
    const uploader = uploaderWith(async (body) => {
      sent.push(body.snippet);
      return response(201);
    });

    await uploader.flush();
    expect(sent).toEqual(['one', 'two']);
    expect(queue.pending()).toHaveLength(0);
  });

  it('sends the platform through untouched — the server consent gate reads it', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    let seen = '';
    await uploaderWith(async (body) => {
      seen = body.platform;
      return response(201);
    }).flush();
    expect(seen).toBe('claude-code');
  });

  it('keeps an item queued on a network failure and records the attempt', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    const uploader = uploaderWith(async () => {
      throw new Error('ECONNREFUSED');
    });

    await uploader.flush();
    expect(queue.pending()).toHaveLength(1);
    expect(queue.pending()[0].attempts).toBe(1);
  });

  it('keeps an item queued on a 5xx — the server may recover', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    await uploaderWith(async () => response(503)).flush();
    expect(queue.pending()).toHaveLength(1);
  });

  // A revoked device retrying forever is how a revocation turns into a log flood. The right
  // response is to stop and ask to be reconnected.
  it('stops on a 401, pauses itself, and does not burn the rest of the queue', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    queue.enqueue({ snippet: 'two', platform: 'claude-code' });

    let calls = 0;
    let unauthorized = false;
    const uploader = uploaderWith(
      async () => {
        calls += 1;
        return response(401);
      },
      () => {
        unauthorized = true;
      },
    );

    await uploader.flush();
    expect(calls).toBe(1);
    expect(unauthorized).toBe(true);
    expect(uploader.isPaused()).toBe(true);
    expect(queue.pending()).toHaveLength(2);

    await uploader.flush();
    expect(calls).toBe(1); // still paused — no further attempts until reconnected
  });

  it('drops an item the server rejects as malformed, rather than retrying it forever', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    await uploaderWith(async () => response(400)).flush();
    expect(queue.pending()).toHaveLength(0);
  });

  it('does nothing at all when there is no key yet', async () => {
    queue.enqueue({ snippet: 'one', platform: 'claude-code' });
    let calls = 0;
    const uploader = new Uploader({
      queue,
      apiBaseUrl: 'https://api.test',
      getKey: () => null,
      onUnauthorized: () => {},
      fetchImpl: async () => {
        calls += 1;
        return response(201);
      },
    });
    await uploader.flush();
    expect(calls).toBe(0);
    expect(queue.pending()).toHaveLength(1);
  });
});

describe('backoffMs', () => {
  it('widens with each attempt and then stops widening', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(3));
    expect(backoffMs(3)).toBeLessThan(backoffMs(6));
    expect(backoffMs(20)).toBe(backoffMs(50));
  });
});
