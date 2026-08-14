export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// One interface, one implementation per platform — a fourth platform later is a new file, not a
// rewrite of the content-script host (docs/Phase8_BrowserExtension_Implementation_Plan.md §4).
// Phase 22 grows this interface by three methods (getConversationId/Title/AllTurns) needed for
// marker-line's inject-once-per-conversation gating and for chat-history capture's transcript
// push — every adapter, DOM-scraping or marker-line-only, implements the same shape.
export interface SiteAdapter {
  name: string;
  matches(url: string): boolean;
  getComposerEl(): HTMLElement | null;
  getComposerText(): string;
  /** The most recent assistant turn's text, used as the capture snippet — null if none yet. */
  getLastAssistantTurn(): string | null;
  /** Inserts text into the composer without navigating away from the page. */
  injectText(text: string): void;
  /** Observes the page for a new assistant turn completing; calls `onTurn` with its text. */
  observeNewTurns(onTurn: (text: string) => void): () => void;
  /**
   * A stable per-conversation id derived from the URL, or null on a fresh/new-chat screen with no
   * conversation started yet. Used to inject the marker-line instruction once per conversation
   * (not once per turn) and to key chat-history capture's upsert-by-externalId.
   */
  getConversationId(): string | null;
  /** The conversation's display title, best-effort — required by the chat-history ingest
   * endpoint, which has no title-less path. Never null when getConversationId() isn't. */
  getConversationTitle(): string | null;
  /** Every visible turn in order, oldest first — the transcript chat-history capture pushes,
   * distinct from getLastAssistantTurn's single-turn capture snippet. */
  getAllTurns(): ConversationTurn[];
}
