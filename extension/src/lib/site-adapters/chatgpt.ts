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

  // Phase 22: ChatGPT gives every started conversation a `/c/<uuid>` path; the new-chat screen
  // (bare origin, or `/?...` with no `/c/` segment) has none yet — best-effort, unverified live.
  getConversationId() {
    return location.pathname.match(/\/c\/([\w-]+)/)?.[1] ?? null;
  },

  getConversationTitle() {
    return document.title.replace(/\s*[|\-–]\s*ChatGPT\s*$/i, "").trim() || null;
  },

  getAllTurns() {
    const nodes = document.querySelectorAll<HTMLElement>("[data-message-author-role]");
    return Array.from(nodes)
      .map((el) => ({
        role: el.getAttribute("data-message-author-role") === "user" ? ("user" as const) : ("assistant" as const),
        content: el.textContent?.trim() ?? "",
      }))
      .filter((t) => t.content.length > 0);
  },
};
