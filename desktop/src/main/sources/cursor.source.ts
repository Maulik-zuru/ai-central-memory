import type { SessionSource } from './session-source';

/**
 * Cursor stores chat history in a workspace-scoped SQLite database rather than plain-text
 * transcripts, and its layout is undocumented and version-dependent.
 *
 * This adapter is a deliberate, visible stub: no sample of the real format was available to write
 * and verify a parser against, and shipping a parser written from guesswork would mean an
 * integration that appears to work and silently captures nothing (or the wrong thing). The Sources
 * screen shows this reason verbatim.
 *
 * To finish it: read Cursor's workspace storage, confirm the message table shape against a real
 * install, implement parse() with the same offset-resume and partial-record discipline as
 * claude-code.source.ts, and write the fixture tests before flipping `available`.
 */
export const cursorSource: SessionSource = {
  platform: 'cursor',
  label: 'Cursor',
  available: false,
  unavailableReason:
    'Cursor keeps its chat history in an undocumented local database. We have not verified a reader against a real install yet, so this source is off rather than guessing at the format.',

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
