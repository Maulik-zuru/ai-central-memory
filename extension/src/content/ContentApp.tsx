import { useCallback, useEffect, useState } from "react";
import { sendToBackground } from "../lib/messages";
import type { SiteAdapter } from "../lib/site-adapters";
import type { Bucket, ContextPreview, Suggestion } from "../lib/types";
import { getPrefs } from "../lib/storage";

type SelectionState = { text: string; x: number; y: number } | null;
type ToastState = string | null;

// Extraction (Phase 18 §7.4) typically finishes well within this window; if it doesn't, the
// confirmation card just doesn't appear for this turn — the suggestion still exists and shows up
// next time the popup's inbox is opened, so nothing is lost, only the in-page nudge.
async function pollForNewCaptureSuggestion(
  knownIds: Set<string>,
  attempts = 8,
  intervalMs = 700,
): Promise<Suggestion | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const { suggestions } = await sendToBackground<{ suggestions: Suggestion[] }>({ type: "GET_PENDING_SUGGESTIONS" });
    const fresh = suggestions.find((s) => s.type === "capture" && s.status === "pending" && !knownIds.has(s.id));
    if (fresh) return fresh;
  }
  return null;
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
  const [pendingSuggestion, setPendingSuggestion] = useState<Suggestion | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Text-selection "Save to Memory" affordance (US-MEM-02: exact text, no rewriting, <2s).
  useEffect(() => {
    function onMouseUp() {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 8) {
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
      try {
        const before = await sendToBackground<{ suggestions: Suggestion[] }>({ type: "GET_PENDING_SUGGESTIONS" });
        const knownIds = new Set(before.suggestions.map((s) => s.id));

        await sendToBackground({ type: "CAPTURE", snippet: text, platform: adapter.name });

        // An auto-capture toggle switched off for this platform (US-ACC-07) or nothing worth
        // remembering both look the same here: no new suggestion ever shows up, and polling
        // simply exhausts its attempts — which is the whole point of the toggle.
        const pending = await pollForNewCaptureSuggestion(knownIds);
        if (pending) setPendingSuggestion(pending);
      } catch {
        // The call failed — silently skip; this is a background convenience, not a user-initiated
        // action needing an error surface.
      }
    });
    return unobserve;
  }, [adapter]);

  async function openQuickInject() {
    setQuickInjectOpen(true);
    setPreviewLoading(true);
    setSelectedIds(new Set());
    setInjectFilter("");
    try {
      const { buckets } = await sendToBackground<{ buckets: Bucket[] }>({ type: "GET_BUCKETS" });
      setBuckets(buckets);
      const prefs = await getPrefs();
      const selectedBucket = prefs.lastBucketId ?? buckets.find((b) => b.isDefault)?.id;
      setBucketId(selectedBucket);
      const snippet = adapter.getLastAssistantTurn() || adapter.getComposerText() || "conversation context";
      const result = await sendToBackground<ContextPreview>({ type: "PREVIEW_CONTEXT", snippet, bucketId: selectedBucket });
      setPreview(result);
    } finally {
      setPreviewLoading(false);
    }
  }

  function toggleMemory(id: string) {
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
    showToast("Context injected");
  }

  async function saveSelection() {
    if (!selection) return;
    const text = selection.text;
    setSelection(null);
    await sendToBackground({ type: "ONE_CLICK_SAVE", content: text });
    showToast("Saved to memory");
  }

  return (
    <>
      <button className="quick-inject-btn" style={{ bottom: 96, right: 24 }} onClick={openQuickInject}>
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

      {pendingSuggestion && (
        <div className="panel" style={{ bottom: 96, left: 24 }}>
          <div className="panel-header">
            <span className="panel-title">Save this as a memory?</span>
            <button
              className="panel-close"
              onClick={async () => {
                await sendToBackground({ type: "DISMISS_SUGGESTION", id: pendingSuggestion.id });
                setPendingSuggestion(null);
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <p className="panel-muted" style={{ marginBottom: 10 }}>
            {pendingSuggestion.draftContent}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-outline"
              onClick={async () => {
                await sendToBackground({ type: "DISMISS_SUGGESTION", id: pendingSuggestion.id });
                setPendingSuggestion(null);
              }}
            >
              Dismiss
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                await sendToBackground({ type: "APPROVE_SUGGESTION", id: pendingSuggestion.id });
                setPendingSuggestion(null);
                showToast("Saved to memory");
              }}
            >
              Approve
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
