import chokidar, { type FSWatcher } from 'chokidar';
import type { AgentConfig } from './config';
import type { CaptureQueue } from './queue';
import { redact } from './redact';
import { SOURCES, sourceFor } from './sources';

/**
 * Watches only the paths the user explicitly turned on.
 *
 * What this deliberately does NOT do, and will not: global keyboard, clipboard, screen, or
 * accessibility-API monitoring. The PRD asks for context from *coding sessions*, not from the
 * machine (docs/Phase13_DesktopAgent_Implementation_Plan.md §3). Watching opted-in files is the
 * whole mandate.
 *
 * Debounce exists because editors and CLIs write atomically: one logical append shows up as
 * several filesystem events, and re-reading on each of them would parse the same bytes repeatedly.
 */

const DEBOUNCE_MS = 2_000;

export interface CaptureEvent {
  platform: string;
  snippet: string;
  at: string;
}

interface WatcherOptions {
  config: AgentConfig;
  queue: CaptureQueue;
  onCaptured: (event: CaptureEvent) => void;
}

export class SessionWatcher {
  private watchers: FSWatcher[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly config: AgentConfig;
  private readonly queue: CaptureQueue;
  private readonly onCaptured: (event: CaptureEvent) => void;

  constructor(options: WatcherOptions) {
    this.config = options.config;
    this.queue = options.queue;
    this.onCaptured = options.onCaptured;
  }

  start() {
    this.stop();
    if (!this.config.get().captureEnabled) return;

    for (const source of SOURCES) {
      if (!source.available) continue;
      const settings = this.config.get().sources[source.platform];
      if (!settings?.enabled || settings.paths.length === 0) continue;

      const watcher = chokidar.watch(settings.paths, {
        ignoreInitial: true, // pairing day must not ingest a year of history
        depth: 6,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      });
      watcher.on('add', (file) => this.schedule(source.platform, file));
      watcher.on('change', (file) => this.schedule(source.platform, file));
      this.watchers.push(watcher);
    }
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const watcher of this.watchers) void watcher.close();
    this.watchers = [];
  }

  private schedule(platform: string, file: string) {
    if (!file.endsWith('.jsonl')) return;
    const existing = this.timers.get(file);
    if (existing) clearTimeout(existing);
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        void this.ingest(platform, file);
      }, DEBOUNCE_MS),
    );
  }

  private async ingest(platform: string, file: string) {
    const source = sourceFor(platform);
    if (!source || !this.config.get().captureEnabled) return;

    try {
      const { snippets, nextByte } = await source.parse(file, this.config.offsetFor(file));
      // The offset advances even when every snippet is a duplicate or is dropped — the bytes have
      // been read, and re-reading them would loop forever on a file that yields nothing.
      this.config.setOffset(file, nextByte);

      for (const raw of snippets) {
        const snippet = redact(raw).trim();
        if (snippet.length < 20) continue; // one-word replies are not context
        const item = this.queue.enqueue({ snippet, platform });
        if (item) this.onCaptured({ platform, snippet, at: item.queuedAt });
      }
    } catch {
      // A file that vanished mid-read, or one we cannot open. Neither is worth surfacing; the next
      // change event will try again.
    }
  }
}
