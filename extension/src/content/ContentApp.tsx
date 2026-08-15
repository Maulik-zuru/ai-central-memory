import { useCallback, useEffect, useRef, useState } from "react";
import { sendToBackground } from "../lib/messages";
import type { SiteAdapter } from "../lib/site-adapters";
import type { Bucket, ContextPreview, Suggestion } from "../lib/types";
import { getPrefs, setPrefs } from "../lib/storage";
import { extractMarkerLineMemory, MARKER_LINE_INSTRUCTION } from "../lib/marker-line";
import { mergeNewSuggestions, pollForNewCaptureSuggestions } from "../lib/capture-review";

type SelectionState = { text: string; x: number; y: number } | null;
type ToastState = string | null;

// Phase 22 (MemoryPlugin_Clone_Spec.md §5.4 "online sync — no export file needed"): pushes the
// whole visible transcript so far into the chat-history archive, upserted by the page's own
// conversation id. Only fires for adapters with real transcript access — `getAllTurns()` is
// deliberately empty for marker-line-only platforms (see marker-line-adapter.ts) — and only once
// the user has opted in, since a whole-conversation transcript is a bigger data-collection step
// than the extracted individual memories the rest of this app deals in.
async function pushConversationToHistory(adapter: SiteAdapter): Promise<void> {
  const messages = adapter.getAllTurns();
  if (messages.length === 0) return;
  const conversationId = adapter.getConversationId();
  if (!conversationId) return;

  const prefs = await getPrefs();
  if (!prefs.chatHistorySyncEnabled || !prefs.lastBucketId) return;

  await sendToBackground({
    type: "INGEST_CONVERSATION",
    bucketId: prefs.lastBucketId,
    platform: adapter.name,
    conversationId,
    title: adapter.getConversationTitle() ?? "Untitled conversation",
    messages,
  });
}

export function ContentApp({ adapter }: { adapter: SiteAdapter }) {
  const [quickInjectOpen, setQuickInjectOpen] = useState(false);
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [injectFilter, setInjectFilter] = useState("");
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketId, setBucketId] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<SelectionState>(null);
  const [toast, setToast] = useState<ToastState>(null);
  // A busy conversation can leave several capture suggestions pending at once — one per turn,
  // sometimes more than one per turn (capture.service.ts's extraction loop) — so this is a list
  // reviewed together with one "Save all" action, not a single card overwritten by whichever
  // suggestion the next poll happens to find.
  const [pendingSuggestions, setPendingSuggestions] = useState<Suggestion[]>([]);
  // Phase 22: seconds remaining in the auto-inject countdown, or null when not counting down —
  // behind a setting, default off (see storage.ts's Prefs.autoInjectCountdown) until verified.
  const [countdown, setCountdown] = useState<number | null>(null);
  // Phase 22 (MemoryPlugin_Clone_Spec.md §4.1 "floating draggable button with remembered per-site
  // position"): null means "use the original fixed bottom/right spot" — only set once the user
  // has actually dragged the button at least once on this site.
  const [buttonPos, setButtonPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  useEffect(() => {
    getPrefs().then((prefs) => {
      const saved = prefs.buttonPosition?.[adapter.name];
      if (saved) setButtonPos(saved);
    });
  }, [adapter]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Text-selection "Save to Memory" affordance (US-MEM-02: exact text, no rewriting, <2s).
  // Phase 22: threshold lowered from 8 to 3 chars per MemoryPlugin_Clone_Spec.md's own minimum —
  // "Save to Memory" is kept as this label (not renamed) since it's already this product's own
  // established name for the action, used identically elsewhere (the dashboard's capture card,
  // the popup's composer, and this same toast's wording all already say "Save"/"Saved to memory").
  useEffect(() => {
    function onMouseUp() {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 3) {
        setSelection(null);
        return;
      }
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelection({ text, x: rect.left, y: rect.top - 36 });
    }
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, []);

  // Capture-confirmation: watch for new assistant turns, run the same draft-then-confirm
  // pipeline the dashboard's inbox already uses (US-MEM-03).
  //
  // Phase 18 (§7.4): the server now runs extraction fire-and-forget, so `CAPTURE` only
  // acknowledges the snippet was queued — it no longer hands back the suggestion it produces (if
  // any) in the same response. This polls the general pending-suggestions list briefly afterward
  // and picks out whichever suggestion is new since the request was made — an id-diff rather than
  // a timestamp comparison, since the extension's clock and the server's can drift.
  useEffect(() => {
    const unobserve = adapter.observeNewTurns(async (text) => {
      // Phase 22: marker-line — a second, complementary capture signal alongside the full-turn
      // capture below, both routing through the same CAPTURE pipeline unchanged
      // (MemoryPlugin_Parity_Implementation_Plan.md Phase 22 §2, "no new capture semantics").
      // Fire-and-forget: a missing marker is the overwhelmingly common case and must never delay
      // or block the turn's own capture.
      const markerMemory = extractMarkerLineMemory(text);
      if (markerMemory) {
        void sendToBackground({ type: "CAPTURE", snippet: markerMemory, platform: adapter.name }).catch(() => {});
      }
      void pushConversationToHistory(adapter).catch(() => {});

      try {
        const before = await sendToBackground<{ suggestions: Suggestion[] }>({ type: "GET_PENDING_SUGGESTIONS" });
        const knownIds = new Set(before.suggestions.map((s) => s.id));

        await sendToBackground({ type: "CAPTURE", snippet: text, platform: adapter.name });

        // An auto-capture toggle switched off for this platform (US-ACC-07) or nothing worth
        // remembering both look the same here: no new suggestion ever shows up, and polling
        // simply exhausts its attempts — which is the whole point of the toggle.
        const fresh = await pollForNewCaptureSuggestions(knownIds);
        if (fresh.length > 0) setPendingSuggestions((prev) => mergeNewSuggestions(prev, fresh));
      } catch {
        // The call failed — silently skip; this is a background convenience, not a user-initiated
        // action needing an error surface.
      }
    });
    return unobserve;
  }, [adapter]);

  // Phase 22: injects the marker-line instruction once per conversation, only while the composer
  // is empty (never interleaves with text the user is actively typing). Polls rather than hooking
  // a platform-specific "submit" event, since none of the adapters expose one and intercepting
  // send across five different composers is far more invasive than reusing the same injectText()
  // Quick Inject already uses. `lastInjectedKeyRef` re-arms whenever the page's own conversation
  // id (or, before one exists, the URL) changes, so a second new chat in the same tab gets its
  // own injection.
  //
  // NOT YET LIVE-VERIFIED (see lib/marker-line.ts's module comment) — the polling cadence and
  // "composer must be empty" gate are a best-effort design pending real-session confirmation that
  // this doesn't surprise or interrupt anyone.
  useEffect(() => {
    const lastInjectedKeyRef = { current: "" };
    function maybeInject() {
      const key = adapter.getConversationId() ?? location.href;
      if (key === lastInjectedKeyRef.current) return;
      if (adapter.getComposerText().length > 0) return;
      lastInjectedKeyRef.current = key;
      adapter.injectText(MARKER_LINE_INSTRUCTION);
    }
    maybeInject();
    const interval = setInterval(maybeInject, 1500);
    return () => clearInterval(interval);
  }, [adapter]);

  async function openQuickInject() {
    setQuickInjectOpen(true);
    setPreviewLoading(true);
    setSelectedIds(new Set());
    setInjectFilter("");
    setCountdown(null);
    try {
      const { buckets } = await sendToBackground<{ buckets: Bucket[] }>({ type: "GET_BUCKETS" });
      setBuckets(buckets);
      const prefs = await getPrefs();
      const selectedBucket = prefs.lastBucketId ?? buckets.find((b) => b.isDefault)?.id;
      setBucketId(selectedBucket);
      const snippet = adapter.getLastAssistantTurn() || adapter.getComposerText() || "conversation context";
      const result = await sendToBackground<ContextPreview>({ type: "PREVIEW_CONTEXT", snippet, bucketId: selectedBucket });
      setPreview(result);
      // Phase 22: the countdown is an alternative to fully-manual click-to-inject, not a change to
      // it — everything preview surfaces gets pre-selected and a 5s cancellable countdown starts;
      // cancelling (or unchecking anything) just leaves the panel in ordinary manual mode.
      if (prefs.autoInjectCountdown && result.memories.length > 0) {
        setSelectedIds(new Set(result.memories.map((m) => m.id)));
        setCountdown(5);
      }
    } finally {
      setPreviewLoading(false);
    }
  }

  function toggleMemory(id: string) {
    setCountdown(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmInject() {
    if (!preview) return;
    const selected = preview.memories.filter((m) => selectedIds.has(m.id));
    if (selected.length === 0) return;
    const contextText = selected.map((m) => `- ${m.content}`).join("\n");
    adapter.injectText(`Context from my memory:\n${contextText}\n\n`);
    setQuickInjectOpen(false);
    setCountdown(null);
    showToast("Context injected");
  }

  // Phase 22: ref mirror of confirmInject so the countdown effect below always calls the latest
  // closure (current preview/selectedIds) without re-running itself on every unrelated re-render.
  const confirmInjectRef = useRef(confirmInject);
  confirmInjectRef.current = confirmInject;

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown === 0) confirmInjectRef.current();
  }, [countdown]);

  async function saveSelection() {
    if (!selection) return;
    const text = selection.text;
    setSelection(null);
    await sendToBackground({ type: "ONE_CLICK_SAVE", content: text });
    showToast("Saved to memory");
  }

  // The one-click "save everything this pass found" action — the whole point of batching the
  // review instead of showing one suggestion at a time.
  async function saveAllPendingSuggestions() {
    const ids = pendingSuggestions.map((s) => s.id);
    if (ids.length === 0) return;
    setPendingSuggestions([]);
    await sendToBackground({ type: "APPROVE_SUGGESTIONS", ids });
    showToast(ids.length === 1 ? "Saved to memory" : `Saved ${ids.length} memories`);
  }

  async function dismissAllPendingSuggestions() {
    const ids = pendingSuggestions.map((s) => s.id);
    if (ids.length === 0) return;
    setPendingSuggestions([]);
    await sendToBackground({ type: "DISMISS_SUGGESTIONS", ids });
  }

  async function dismissOnePendingSuggestion(id: string) {
    setPendingSuggestions((prev) => prev.filter((s) => s.id !== id));
    await sendToBackground({ type: "DISMISS_SUGGESTIONS", ids: [id] });
  }

  // Phase 22: a pointer-drag distance under this threshold is treated as a click (opens Quick
  // Inject) rather than a drag — same idea as any draggable-vs-clickable UI element.
  const DRAG_THRESHOLD_PX = 4;

  function handleButtonPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: buttonPos?.x ?? rect.left, originY: buttonPos?.y ?? rect.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleButtonPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true;
    if (drag.moved) setButtonPos({ x: drag.originX + dx, y: drag.originY + dy });
  }

  async function handleButtonPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      openQuickInject();
      return;
    }
    setButtonPos((pos) => {
      if (pos) {
        getPrefs().then((prefs) => setPrefs({ buttonPosition: { ...prefs.buttonPosition, [adapter.name]: pos } }));
      }
      return pos;
    });
  }

  return (
    <>
      <button
        className="quick-inject-btn"
        style={buttonPos ? { left: buttonPos.x, top: buttonPos.y } : { bottom: 96, right: 24 }}
        onPointerDown={handleButtonPointerDown}
        onPointerMove={handleButtonPointerMove}
        onPointerUp={handleButtonPointerUp}
      >
        <span className="badge-dot">✦</span>
        Quick Inject
      </button>

      {selection && (
        <button
          className="save-selection-btn"
          style={{ left: selection.x, top: Math.max(selection.y, 8) }}
          onClick={saveSelection}
        >
          Save to Memory
        </button>
      )}

      {quickInjectOpen && (
        <div className="panel panel-lg" style={{ bottom: 140, right: 24 }}>
          <div className="panel-header">
            <span className="panel-title">Quick Inject</span>
            <button className="panel-close" onClick={() => setQuickInjectOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>

          {buckets.length > 0 && (
            <select
              value={bucketId ?? ""}
              onChange={(e) => setBucketId(e.target.value)}
              className="panel-select"
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {countdown !== null && (
            <div className="panel-stat" style={{ marginBottom: 8 }}>
              <span className="panel-muted">Auto-injecting in {countdown}s…</span>
              <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => setCountdown(null)}>
                Cancel
              </button>
            </div>
          )}

          {previewLoading || !preview ? (
            <p className="panel-muted">Loading preview…</p>
          ) : preview.memories.length === 0 ? (
            <p className="panel-muted" style={{ marginBottom: 4 }}>
              No relevant memories found for this conversation yet.
            </p>
          ) : (
            (() => {
              const filtered = preview.memories.filter((m) =>
                m.content.toLowerCase().includes(injectFilter.trim().toLowerCase()),
              );
              const selectedCount = selectedIds.size;
              const selectedTokens =
                preview.memories.length > 0
                  ? Math.round((selectedCount / preview.memories.length) * preview.actualTokens)
                  : 0;
              const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id));

              return (
                <>
                  <div className="inject-search">
                    <span className="inject-search-icon">⌕</span>
                    <input
                      value={injectFilter}
                      onChange={(e) => setInjectFilter(e.target.value)}
                      placeholder="Search these memories…"
                    />
                  </div>

                  <div className="panel-stat">
                    <strong style={{ fontSize: 13 }}>{selectedCount}</strong>
                    <span className="panel-muted">
                      of {preview.memories.length} selected · ~{selectedTokens} tokens
                    </span>
                    <button
                      className="link-btn"
                      style={{ marginLeft: "auto" }}
                      onClick={() =>
                        setSelectedIds((prev) => {
                          if (allFilteredSelected) {
                            const next = new Set(prev);
                            filtered.forEach((m) => next.delete(m.id));
                            return next;
                          }
                          const next = new Set(prev);
                          filtered.forEach((m) => next.add(m.id));
                          return next;
                        })
                      }
                    >
                      {allFilteredSelected ? "Clear" : "Select all"}
                    </button>
                  </div>

                  <div className="memory-checklist">
                    {filtered.length === 0 ? (
                      <p className="panel-muted" style={{ padding: 12, textAlign: "center" }}>
                        No memories match “{injectFilter}”.
                      </p>
                    ) : (
                      filtered.map((m) => {
                        const checked = selectedIds.has(m.id);
                        return (
                          <label key={m.id} className={`memory-check-row ${checked ? "is-checked" : ""}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleMemory(m.id)} />
                            <span className="memory-check-text">{m.content}</span>
                          </label>
                        );
                      })
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn-outline" onClick={() => setQuickInjectOpen(false)}>
                      Cancel
                    </button>
                    <button className="btn-primary" onClick={confirmInject} disabled={selectedCount === 0}>
                      {selectedCount > 0 ? `Inject (${selectedCount})` : "Select memories to inject"}
                    </button>
                  </div>
                </>
              );
            })()
          )}
        </div>
      )}

      {pendingSuggestions.length > 0 && (
        <div className="panel panel-lg" style={{ bottom: 96, left: 24 }}>
          <div className="panel-header">
            <span className="panel-title">
              {pendingSuggestions.length === 1 ? "Save this as a memory?" : `${pendingSuggestions.length} memories to review`}
            </span>
            <button className="panel-close" onClick={dismissAllPendingSuggestions} aria-label="Dismiss all">
              ✕
            </button>
          </div>

          <div className="memory-checklist" style={{ marginBottom: 10 }}>
            {pendingSuggestions.map((s) => (
              <div key={s.id} className="memory-row" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px" }}>
                <span style={{ flex: 1 }}>{s.draftContent}</span>
                <button className="link-btn" onClick={() => dismissOnePendingSuggestion(s.id)}>
                  Skip
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-outline" onClick={dismissAllPendingSuggestions}>
              Dismiss all
            </button>
            <button className="btn-primary" onClick={saveAllPendingSuggestions}>
              {pendingSuggestions.length === 1 ? "Save" : `Save all (${pendingSuggestions.length})`}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ bottom: 24, right: 24 }}>
          {toast}
        </div>
      )}
    </>
  );
}
