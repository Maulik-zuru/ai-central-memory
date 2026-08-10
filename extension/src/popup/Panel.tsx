import { useEffect, useMemo, useState } from "react";
import {
  BrainIcon,
  CaretDownIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SignOutIcon,
  SparkleIcon,
  StackIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { sendToBackground } from "../lib/messages";
import type { Account, Bucket, Memory, Suggestion } from "../lib/types";
import { getPrefs, setPrefs } from "../lib/storage";

// Fixed pixel geometry via inline style rather than Tailwind's spacing-scale utilities — keeps
// the track/thumb/inset relationship provable at a glance instead of derived from utility classes
// that all have to independently agree (see the frontend's identical Toggle for the same fix).
const TOGGLE_TRACK_WIDTH = 40;
const TOGGLE_TRACK_HEIGHT = 22;
const TOGGLE_THUMB_SIZE = 18;
const TOGGLE_INSET = 2;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ width: TOGGLE_TRACK_WIDTH, height: TOGGLE_TRACK_HEIGHT }}
      className={`relative shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--primary)]" : "bg-[var(--secondary)]"}`}
    >
      <span
        style={{
          width: TOGGLE_THUMB_SIZE,
          height: TOGGLE_THUMB_SIZE,
          top: TOGGLE_INSET,
          left: TOGGLE_INSET,
          transform: checked
            ? `translateX(${TOGGLE_TRACK_WIDTH - TOGGLE_THUMB_SIZE - TOGGLE_INSET * 2}px)`
            : "translateX(0)",
        }}
        className="absolute rounded-full bg-white shadow transition-transform"
      />
    </button>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SOURCE_LABEL: Record<Memory["source"], string> = {
  manual: "Added",
  one_click: "Saved",
  auto: "Auto-captured",
};

function SourceBadge({ source }: { source: Memory["source"] }) {
  const tone =
    source === "auto"
      ? "bg-[var(--primary-tint)] text-[var(--primary)]"
      : "bg-[var(--secondary)] text-[var(--muted-foreground)]";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{SOURCE_LABEL[source]}</span>;
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-card)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function Panel({ onDisconnect }: { onDisconnect: () => void }) {
  const [tab, setTab] = useState<"memories" | "settings">("memories");
  const [account, setAccount] = useState<Account | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucketId, setBucketId] = useState<string | undefined>(undefined);
  const [bucketMenuOpen, setBucketMenuOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [query, setQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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
    setMemoriesLoading(true);
    sendToBackground<{ items: Memory[] }>({ type: "GET_RECENT_MEMORIES", bucketId, q: query || undefined })
      .then((r) => setMemories(r.items))
      .finally(() => setMemoriesLoading(false));
  }, [bucketId, query]);

  const activeBucket = useMemo(() => buckets.find((b) => b.id === bucketId), [buckets, bucketId]);

  async function saveDraft() {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const { memory } = await sendToBackground<{ memory: Memory }>({ type: "ONE_CLICK_SAVE", content, bucketId });
      setMemories((prev) => [memory, ...prev]);
      setDraft("");
      setComposerOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function respondToSuggestion(id: string, action: "APPROVE_SUGGESTION" | "DISMISS_SUGGESTION") {
    await sendToBackground({ type: action, id });
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    if (action === "APPROVE_SUGGESTION") loadAll();
  }

  if (!account) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-[var(--muted-foreground)]">Loading…</div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary)]">
            <BrainIcon size={16} weight="fill" color="var(--primary-foreground)" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Memory</span>
            <span className="text-[11px] text-[var(--muted-foreground)]">{account.email}</span>
          </div>
        </div>
        <div className="flex gap-1 rounded-lg bg-[var(--secondary)] p-0.5">
          <TabButton active={tab === "memories"} onClick={() => setTab("memories")} icon={<StackIcon size={13} />} label="Memories" />
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<GearSixIcon size={13} />} label="Settings" />
        </div>
      </div>

      {tab === "memories" ? (
        <div className="flex flex-col gap-3 p-4">
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-tint)] p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]">
                <SparkleIcon size={14} weight="fill" />
                {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} to review
              </div>
              <p className="line-clamp-2 text-xs text-[var(--foreground)]/80">{suggestions[0].draftContent}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => respondToSuggestion(suggestions[0].id, "DISMISS_SUGGESTION")}
                  className="flex-1 rounded-full border border-[var(--border)] bg-[var(--card)] py-1.5 text-xs font-medium hover:bg-[var(--secondary)]"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => respondToSuggestion(suggestions[0].id, "APPROVE_SUGGESTION")}
                  className="flex-1 rounded-full bg-[var(--primary)] py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
                >
                  Save it
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <button
                onClick={() => setBucketMenuOpen((v) => !v)}
                className="flex h-8 w-full items-center justify-between gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] px-2.5 text-xs font-medium"
              >
                <span className="truncate">{activeBucket?.name ?? "Select bucket"}</span>
                <CaretDownIcon size={12} className="shrink-0 text-[var(--muted-foreground)]" />
              </button>
              {bucketMenuOpen && (
                <div className="absolute left-0 top-9 z-10 w-full animate-in overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-popover)]">
                  {buckets.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setBucketId(b.id);
                        setPrefs({ lastBucketId: b.id });
                        setBucketMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[var(--secondary)] ${
                        b.id === bucketId ? "font-semibold text-[var(--primary)]" : ""
                      }`}
                    >
                      {b.name}
                      {b.isDefault && <span className="text-[10px] text-[var(--muted-foreground)]">Default</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setComposerOpen((v) => !v)}
              className="flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
            >
              <PlusIcon size={13} weight="bold" />
              Add
            </button>
          </div>

          {composerOpen && (
            <div className="flex animate-in flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-2.5 shadow-[var(--shadow-card)]">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft();
                  if (e.key === "Escape") setComposerOpen(false);
                }}
                placeholder="Write something to remember…"
                rows={3}
                className="resize-none rounded-[var(--radius-sm)] bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  Saves to <span className="font-medium">{activeBucket?.name ?? "default"}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setComposerOpen(false);
                      setDraft("");
                    }}
                    className="rounded-full px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveDraft}
                    disabled={!draft.trim() || saving}
                    className="rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="relative">
            <MagnifyingGlassIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your memories…"
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] pl-8 pr-2 text-xs outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {memoriesLoading ? (
              <div className="flex flex-col gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-[var(--radius-md)] bg-[var(--secondary)]" />
                ))}
              </div>
            ) : memories.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--secondary)]">
                  <BrainIcon size={18} className="text-[var(--muted-foreground)]" />
                </div>
                <p className="text-xs font-medium">{query ? "No matches" : "No memories yet"}</p>
                <p className="max-w-[220px] text-[11px] text-[var(--muted-foreground)]">
                  {query
                    ? "Try a different search term, or clear it to see everything in this bucket."
                    : "Select text on any page, or use Add above, to start building your memory."}
                </p>
              </div>
            ) : (
              memories.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-2.5 text-xs shadow-[var(--shadow-card)]"
                >
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="line-clamp-3 leading-relaxed">{m.content}</span>
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source={m.source} />
                      <span className="text-[10px] text-[var(--muted-foreground)]">{relativeTime(m.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await sendToBackground({ type: "DELETE_MEMORY", id: m.id });
                      setMemories((prev) => prev.filter((x) => x.id !== m.id));
                    }}
                    className="shrink-0 rounded-full p-1 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--destructive-foreground)] hover:text-[var(--destructive)] group-hover:opacity-100"
                    aria-label="Delete memory"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold">Smart Mode</span>
              <span className="text-[11px] leading-snug text-[var(--muted-foreground)]">
                Automatically pick the most relevant memories to inject into context.
              </span>
            </div>
            <Toggle
              checked={account.smartMemoryEnabled}
              onChange={async (v) => {
                await sendToBackground({ type: "UPDATE_SMART_MEMORY", enabled: v });
                setAccount({ ...account, smartMemoryEnabled: v });
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Auto-capture per platform
            </span>
            <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-1">
              {["chatgpt", "claude", "gemini"].map((platform, i) => (
                <div
                  key={platform}
                  className={`flex items-center justify-between px-2 py-2 capitalize ${
                    i > 0 ? "border-t border-[var(--border)]" : ""
                  }`}
                >
                  <span className="text-xs">{platform === "chatgpt" ? "ChatGPT" : platform}</span>
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
          </div>

          <button
            onClick={onDisconnect}
            className="mt-1 flex items-center justify-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--destructive)] hover:bg-[var(--destructive-foreground)]"
          >
            <SignOutIcon size={13} />
            Disconnect extension
          </button>
        </div>
      )}
    </div>
  );
}
