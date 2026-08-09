/**
 * A local source of AI coding-session data.
 *
 * Third member of the family that already includes `SiteAdapter` (Phase 8) and
 * `ConversationImportProvider` (Phase 5): one interface, N implementations, a host that never
 * learns their names. Adding Cursor or Codex support is a file, not a refactor.
 *
 * `platform` is the literal value sent to POST /api/capture, which is what the server's
 * per-platform consent gate checks (US-ACC-07) — there is no mapping table between the two, on
 * purpose, so they cannot drift.
 */
export interface SessionSource {
  readonly platform: string;
  readonly label: string;
  /** Whether this source can actually be used. See §9 of the phase plan for why some cannot. */
  readonly available: boolean;
  /** Why it is unavailable, shown verbatim in the Sources screen. Empty when available. */
  readonly unavailableReason: string;
  /** Suggested watch roots for the current OS. May not exist on disk. */
  defaultPaths(): string[];
  /** Glob(s), relative to a watch root, matching the files worth reading. */
  watchGlobs(): string[];
  /**
   * Reads new content from `fromByte` forward.
   *
   * Implementations must return a `nextByte` that never sits in the middle of a record: a
   * partially-flushed trailing line is left for the next pass rather than dropped or half-parsed.
   */
  parse(filePath: string, fromByte: number): Promise<{ snippets: string[]; nextByte: number }>;
}
