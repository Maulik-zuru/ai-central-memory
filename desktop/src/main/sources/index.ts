import { claudeCodeSource } from './claude-code.source';
import { cursorSource } from './cursor.source';
import { codexSource } from './codex.source';
import type { SessionSource } from './session-source';

/**
 * Every source the agent knows about, available or not.
 *
 * Unavailable sources are listed rather than hidden, with the reason shown in the Sources screen.
 * A listed-but-silently-broken integration is worse than an honestly-absent one — the same posture
 * taken for Phase 5's chat import (2 of 6 platforms) and Phase 8's unverified site adapters.
 */
export const SOURCES: SessionSource[] = [claudeCodeSource, cursorSource, codexSource];

export function sourceFor(platform: string): SessionSource | undefined {
  return SOURCES.find((s) => s.platform === platform);
}

export type { SessionSource };
