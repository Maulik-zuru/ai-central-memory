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

  function confirmInject() {
    if (!preview) return;
    const contextText = preview.memories.map((m) => `- ${m.content}`).join("\n");
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
        ✦ Quick Inject
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
        <div className="panel" style={{ bottom: 140, right: 24 }}>
          <div className="panel-title">Quick Inject</div>
          {buckets.length > 0 && (
            <select
              value={bucketId ?? ""}
              onChange={(e) => setBucketId(e.target.value)}
              style={{ width: "100%", marginBottom: 8, padding: 6, borderRadius: 8 }}
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
          ) : (
            <>
              <p className="panel-muted" style={{ marginBottom: 8 }}>
                {preview.memories.length} memories · {preview.actualTokens} tokens
                {preview.everythingTokens > preview.actualTokens
                  ? ` (${Math.round((1 - preview.actualTokens / preview.everythingTokens) * 100)}% smaller than everything)`
                  : ""}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-outline" onClick={() => setQuickInjectOpen(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={confirmInject} disabled={preview.memories.length === 0}>
                  Inject
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {pendingSuggestion && (
        <div className="panel" style={{ bottom: 96, left: 24 }}>
          <div className="panel-title">Save this as a memory?</div>
          <p className="panel-muted" style={{ marginBottom: 8 }}>
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
