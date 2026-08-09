import type { CaptureQueue } from './queue';

/**
 * Drains the queue into POST /api/capture.
 *
 * This is the only place the agent talks to the network, and the only place the API key is used.
 * The key never leaves the main process — see preload/index.ts for the surface the renderer gets
 * instead.
 *
 * The server does the rest: the per-platform consent gate (US-ACC-07) decides whether the snippet
 * is even looked at, and a snippet that survives becomes a *pending suggestion*, never a memory
 * (US-MEM-03). The agent has no way to write a memory directly and is not supposed to.
 */

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60 * 1000;

export function backoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
}

interface UploaderOptions {
  queue: CaptureQueue;
  apiBaseUrl: string;
  getKey: () => string | null;
  onUnauthorized: () => void;
  fetchImpl?: typeof fetch;
}

export class Uploader {
  private readonly queue: CaptureQueue;
  private readonly apiBaseUrl: string;
  private readonly getKey: () => string | null;
  private readonly onUnauthorized: () => void;
  private readonly fetchImpl: typeof fetch;
  private paused = false;
  private inFlight = false;

  constructor(options: UploaderOptions) {
    this.queue = options.queue;
    this.apiBaseUrl = options.apiBaseUrl;
    this.getKey = options.getKey;
    this.onUnauthorized = options.onUnauthorized;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Called after a successful re-pair. */
  resume() {
    this.paused = false;
  }

  async flush(): Promise<void> {
    if (this.paused || this.inFlight) return;
    const key = this.getKey();
    if (!key) return;

    this.inFlight = true;
    try {
      for (const item of this.queue.pending()) {
        // An item that failed recently is skipped this pass rather than hammered — the next tick
        // will pick it up once its backoff window has elapsed.
        if (item.attempts > 0 && Date.now() - Date.parse(item.queuedAt) < backoffMs(item.attempts)) {
          continue;
        }

        let status: number;
        try {
          const res = await this.fetchImpl(`${this.apiBaseUrl}/api/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ snippet: item.snippet, platform: item.platform }),
          });
          status = res.status;
        } catch (error) {
          this.queue.markFailed(item.id, error instanceof Error ? error.message : 'network error');
          continue;
        }

        if (status === 401 || status === 403) {
          // The device was revoked, or its key was. Stop immediately: every remaining item would
          // get the same answer, and retrying forever turns a revocation into a log flood.
          this.paused = true;
          this.onUnauthorized();
          return;
        }

        if (status >= 200 && status < 300) {
          this.queue.markSent(item.id);
        } else if (status >= 500 || status === 429) {
          this.queue.markFailed(item.id, `server responded ${status}`);
        } else {
          // A 4xx that isn't auth or rate limiting means this specific item will never be
          // accepted. Dropping it is better than blocking the queue behind it forever.
          this.queue.markSent(item.id);
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
