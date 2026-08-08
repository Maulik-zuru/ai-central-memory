import type { SiteAdapter } from "./types";

// Selectors below are best-effort, based on ChatGPT's DOM structure as of this writing — every
// AI chat UI ships DOM changes without notice, and this adapter has not been verified against a
// live, authenticated ChatGPT session in this environment. Flagged explicitly rather than
// presented as verified (docs/Phase8_BrowserExtension_Implementation_Plan.md §11: "manually
// verify the exit criteria live on all three launch platforms" is a real, still-open step).
export const chatGptAdapter: SiteAdapter = {
  name: "chatgpt",

  matches(url) {
    return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
  },

  getComposerEl() {
    return document.querySelector<HTMLElement>('#prompt-textarea, [data-testid="prompt-textarea"]');
  },

  getComposerText() {
    return this.getComposerEl()?.textContent?.trim() ?? "";
  },

  getLastAssistantTurn() {
    const turns = document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]');
    const last = turns[turns.length - 1];
    return last?.textContent?.trim() ?? null;
  },

  injectText(text) {
    const composer = this.getComposerEl();
    if (!composer) return;
    composer.focus();
    document.execCommand("insertText", false, text);
  },

  observeNewTurns(onTurn) {
    let lastCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
    const observer = new MutationObserver(() => {
      const turns = document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]');
      if (turns.length > lastCount) {
        lastCount = turns.length;
        const text = turns[turns.length - 1]?.textContent?.trim();
        if (text) onTurn(text);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  },
};
