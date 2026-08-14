import type { SiteAdapter } from "./types";

/**
 * Phase 22 (MemoryPlugin_Parity_Implementation_Plan.md §Phase 22 "why marker-line as an
 * addition"): a marker-line-only platform gets no maintained DOM selectors — the whole point of
 * this mechanism is reaching new platforms without writing/maintaining per-site adapters. This
 * factory trades selector precision for genericity: the "composer" is a heuristic (largest
 * visible text input on the page), and `observeNewTurns` reports the raw text delta added to the
 * page rather than a real per-turn boundary, which is all the marker-line scan actually needs —
 * it's looking for a `to=memoryos&&memory=[...]` pattern anywhere in newly-added text, not for a
 * clean single-turn snippet. `getAllTurns()` deliberately returns nothing: chat-history capture
 * needs a real transcript, which this factory doesn't attempt to reconstruct — a marker-line-only
 * platform is capture-only (memories + the marker-line signal), not chat-history-archive-eligible,
 * until/unless it later earns a real DOM adapter.
 */
function createMarkerLineAdapter(name: string, urlPattern: RegExp, conversationIdPattern: RegExp): SiteAdapter {
  let lastBodyLength = 0;

  return {
    name,

    matches(url) {
      return urlPattern.test(url);
    },

    getComposerEl() {
      const candidates = [
        ...document.querySelectorAll<HTMLElement>("textarea"),
        ...document.querySelectorAll<HTMLElement>('[contenteditable="true"]'),
      ].filter((el) => el.getBoundingClientRect().width > 0);
      if (candidates.length === 0) return null;
      return candidates.reduce((largest, el) => {
        const area = (r: HTMLElement) => r.getBoundingClientRect().width * r.getBoundingClientRect().height;
        return area(el) > area(largest) ? el : largest;
      });
    },

    getComposerText() {
      return this.getComposerEl()?.textContent?.trim() ?? "";
    },

    getLastAssistantTurn() {
      // No stable per-turn boundary without site-specific selectors — good enough for Quick
      // Inject's snippet fallback, which just needs *some* recent conversational context.
      return document.body.innerText.slice(-4000).trim() || null;
    },

    injectText(text) {
      const composer = this.getComposerEl();
      if (!composer) return;
      composer.focus();
      document.execCommand("insertText", false, text);
    },

    observeNewTurns(onTurn) {
      lastBodyLength = document.body.innerText.length;
      const observer = new MutationObserver(() => {
        const current = document.body.innerText;
        if (current.length > lastBodyLength) {
          const delta = current.slice(lastBodyLength).trim();
          lastBodyLength = current.length;
          if (delta) onTurn(delta);
        } else {
          lastBodyLength = current.length;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    },

    getConversationId() {
      return location.pathname.match(conversationIdPattern)?.[1] ?? null;
    },

    getConversationTitle() {
      return document.title.trim() || null;
    },

    getAllTurns() {
      return [];
    },
  };
}

// Best-effort URL patterns, unverified live (same caveat every adapter in this directory carries).
export const grokAdapter = createMarkerLineAdapter("grok", /^https:\/\/grok\.com\//, /\/chat\/([\w-]+)/);
export const deepseekAdapter = createMarkerLineAdapter(
  "deepseek",
  /^https:\/\/chat\.deepseek\.com\//,
  /\/a\/chat\/s\/([\w-]+)/,
);
