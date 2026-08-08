// One interface, one implementation per platform — a fourth platform later is a new file, not a
// rewrite of the content-script host (docs/Phase8_BrowserExtension_Implementation_Plan.md §4).
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
}
