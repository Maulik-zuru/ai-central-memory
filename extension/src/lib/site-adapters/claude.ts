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

  // Phase 22: Claude's started conversations live at `/chat/<uuid>`; a bare `/new` or root has no
  // id yet — best-effort, unverified live.
  getConversationId() {
    return location.pathname.match(/\/chat\/([\w-]+)/)?.[1] ?? null;
  },

  getConversationTitle() {
    return document.title.replace(/\s*[|\-–]\s*Claude\s*$/i, "").trim() || null;
  },

  getAllTurns() {
    const nodes = document.querySelectorAll<HTMLElement>('[data-testid="user-turn"], [data-testid="assistant-turn"]');
    return Array.from(nodes)
      .map((el) => ({
        role: el.getAttribute("data-testid") === "user-turn" ? ("user" as const) : ("assistant" as const),
        content: el.textContent?.trim() ?? "",
      }))
      .filter((t) => t.content.length > 0);
  },
};
