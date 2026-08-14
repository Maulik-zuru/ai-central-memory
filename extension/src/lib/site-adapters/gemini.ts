import type { SiteAdapter } from "./types";

// Same caveat as chatgpt.ts — best-effort selectors, not yet verified against a live session.
// Gemini's web app is an Angular app with heavily obfuscated class names, so this adapter leans
// on `contenteditable`/`aria-label` attributes, which tend to be more stable than class names.
export const geminiAdapter: SiteAdapter = {
  name: "gemini",

  matches(url) {
    return /^https:\/\/gemini\.google\.com\//.test(url);
  },

  getComposerEl() {
    return document.querySelector<HTMLElement>('div[contenteditable="true"][aria-label*="Prompt" i], rich-textarea div[contenteditable="true"]');
  },

  getComposerText() {
    return this.getComposerEl()?.textContent?.trim() ?? "";
  },

  getLastAssistantTurn() {
    const turns = document.querySelectorAll<HTMLElement>('model-response, [data-response-index]');
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
    let lastCount = document.querySelectorAll("model-response, [data-response-index]").length;
    const observer = new MutationObserver(() => {
      const turns = document.querySelectorAll<HTMLElement>("model-response, [data-response-index]");
      if (turns.length > lastCount) {
        lastCount = turns.length;
        const text = turns[turns.length - 1]?.textContent?.trim();
        if (text) onTurn(text);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  },

  // Phase 22: a started Gemini conversation lives at `/app/<hash>`; the new-chat screen (bare
  // `/app` or root) has none yet — best-effort, unverified live.
  getConversationId() {
    return location.pathname.match(/\/app\/([\w-]+)/)?.[1] ?? null;
  },

  getConversationTitle() {
    return document.title.replace(/\s*[|\-–]\s*Gemini\s*$/i, "").trim() || null;
  },

  getAllTurns() {
    const nodes = document.querySelectorAll<HTMLElement>("user-query, model-response, [data-response-index]");
    return Array.from(nodes)
      .map((el) => ({
        role: el.tagName.toLowerCase() === "user-query" ? ("user" as const) : ("assistant" as const),
        content: el.textContent?.trim() ?? "",
      }))
      .filter((t) => t.content.length > 0);
  },
};
