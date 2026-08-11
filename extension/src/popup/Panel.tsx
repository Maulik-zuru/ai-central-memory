import { useEffect, useState } from "react";
import { sendToBackground } from "../lib/messages";
import type { Account, Bucket, Memory, Suggestion } from "../lib/types";
import { getPrefs, setPrefs } from "../lib/storage";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-[var(--primary)]" : "bg-[var(--secondary)]"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function Panel({
  onDisconnect,
  onReplayOnboarding,
}: {
  onDisconnect: () => void;
  onReplayOnboarding: () => void;
}) {
  const [tab, setTab] = useState<"memories" | "settings">("memories");
  const [account, setAccount] = useState<Account | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketId, setBucketId] = useState<string | undefined>(undefined);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [query, setQuery] = useState("");

  async function loadAll() {
    const { account } = await sendToBackground<{ account: Account }>({ type: "GET_ACCOUNT" });
    setAccount(account);
    const { buckets } = await sendToBackground<{ buckets: Bucket[] }>({ type: "GET_BUCKETS" });
    setBuckets(buckets);
    const prefs = await getPrefs();
    setBucketId(prefs.lastBucketId ?? buckets.find((b) => b.isDefault)?.id);
    const { suggestions: pending } = await sendToBackground<{ suggestions: Suggestion[] }>({ type: "GET_PENDING_SUGGESTIONS" });
    setSuggestions(pending.filter((s) => s.status === "pending"));
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!bucketId) return;
    sendToBackground<{ items: Memory[] }>({ type: "GET_RECENT_MEMORIES", bucketId, q: query || undefined }).then((r) =>
      setMemories(r.items),
    );
  }, [bucketId, query]);

  if (!account) return <div className="p-6 text-sm text-[var(--muted-foreground)]">Loading…</div>;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <span className="font-serif text-sm">AI Memory</span>
        <div className="flex gap-1 rounded-lg bg-[var(--secondary)] p-0.5 text-xs">
          <button
            onClick={() => setTab("memories")}
            className={`rounded-md px-2 py-1 ${tab === "memories" ? "bg-[var(--card)] shadow-sm" : "text-[var(--muted-foreground)]"}`}
          >
            Memories
          </button>
          <button
            onClick={() => setTab("settings")}
            className={`rounded-md px-2 py-1 ${tab === "settings" ? "bg-[var(--card)] shadow-sm" : "text-[var(--muted-foreground)]"}`}
          >
            Settings
          </button>
        </div>
      </div>

      {tab === "memories" ? (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <select
              value={bucketId ?? ""}
              onChange={(e) => {
                setBucketId(e.target.value);
                setPrefs({ lastBucketId: e.target.value });
              }}
              className="h-8 flex-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 text-xs"
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {suggestions.length > 0 && (
              <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary-foreground)]">
                {suggestions.length} pending
              </span>
            )}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your memories…"
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 text-xs"
          />
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {memories.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">No memories yet in this bucket.</p>
            ) : (
              memories.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-xs">
                  <span className="line-clamp-2">{m.content}</span>
                  <button
                    onClick={async () => {
                      await sendToBackground({ type: "DELETE_MEMORY", id: m.id });
                      setMemories((prev) => prev.filter((x) => x.id !== m.id));
                    }}
                    className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span>Smart Mode</span>
            <Toggle
              checked={account.smartMemoryEnabled}
              onChange={async (v) => {
                await sendToBackground({ type: "UPDATE_SMART_MEMORY", enabled: v });
                setAccount({ ...account, smartMemoryEnabled: v });
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Auto-capture per platform
            </span>
            {["chatgpt", "claude", "gemini"].map((platform) => (
              <div key={platform} className="flex items-center justify-between capitalize">
                <span>{platform}</span>
                <Toggle
                  checked={account.autoCapture[platform] ?? true}
                  onChange={async (v) => {
                    const next = { ...account.autoCapture, [platform]: v };
                    await sendToBackground({ type: "UPDATE_AUTO_CAPTURE", autoCapture: next });
                    setAccount({ ...account, autoCapture: next });
                  }}
                />
              </div>
            ))}
          </div>
          <button
            onClick={async () => {
              await sendToBackground({ type: "REPLAY_ONBOARDING" });
              onReplayOnboarding();
            }}
            className="rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--foreground)]"
          >
            Replay walkthrough
          </button>
          <button
            onClick={onDisconnect}
            className="mt-2 rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--destructive)]"
          >
            Disconnect extension
          </button>
        </div>
      )}
    </div>
  );
}
