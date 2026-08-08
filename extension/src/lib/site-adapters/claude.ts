import type { SiteAdapter } from "./types";

// Same caveat as chatgpt.ts — best-effort selectors, not yet verified against a live session.
export const claudeAdapter: SiteAdapter = {
  name: "claude",

  matches(url) {
    return /^https:\/\/claude\.ai\//.test(url);
  },

  getComposerEl() {
    return document.querySelector<HTMLElement>('div[contenteditable="true"][data-testid="chat-input"], div.ProseMirror[contenteditable="true"]');
  },

  getComposerText() {
    return this.getComposerEl()?.textContent?.trim() ?? "";
  },

  getLastAssistantTurn() {
    const turns = document.querySelectorAll<HTMLElement>('[data-testid="assistant-turn"]');
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
    let lastCount = document.querySelectorAll('[data-testid="assistant-turn"]').length;
    const observer = new MutationObserver(() => {
      const turns = document.querySelectorAll<HTMLElement>('[data-testid="assistant-turn"]');
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
