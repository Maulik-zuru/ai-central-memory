import type { SessionSource } from './session-source';

/**
 * Codex CLI session logs were not available to test against in this environment.
 *
 * Same posture as cursor.source.ts: a visible stub with the reason shown in the UI, rather than a
 * parser written from guesswork that would look like a working integration.
 *
 * To finish it: confirm the on-disk session format against a real install, implement parse() with
 * the offset-resume and partial-record rules the interface documents, add fixture tests, then flip
 * `available`.
 */
export const codexSource: SessionSource = {
  platform: 'codex',
  label: 'Codex',
  available: false,
  unavailableReason:
    'We have not verified a reader for Codex session logs against a real install, so this source is off rather than guessing at the format.',

  defaultPaths() {
    return [];
  },

  watchGlobs() {
    return [];
  },

  async parse() {
    return { snippets: [], nextByte: 0 };
  },
};
