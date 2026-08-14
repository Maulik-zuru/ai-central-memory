"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, type ContextPreview, type RecategorizeResult } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const RESET_CONFIRMATION = "RESET";

// Fixed pixel geometry via inline style rather than Tailwind's spacing-scale utilities (w-11,
// translate-x-5, etc.) — this control is small enough that any scale mismatch between the track,
// thumb, and translate distance is immediately visible as the thumb clipping the track's edge.
// Explicit numbers keep the 2px margin provable at a glance instead of derived from three
// separate utility classes that all have to agree.
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
      className={`relative shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
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
        className="absolute rounded-full bg-card shadow transition-transform"
      />
    </button>
  );
}

function CategoryRow({
  id,
  label,
  summary,
  additionalContext,
  memoryCount,
}: {
  id: string;
  label: string;
  summary: string;
  additionalContext: string;
  memoryCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const queryClient = useQueryClient();

  const rename = useMutation({
    mutationFn: (nextLabel: string) => api.renameCategory(id, nextLabel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setEditing(false);
    },
  });

  return (
    <div className="flex flex-col gap-1 py-2.5">
      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) rename.mutate(draft.trim());
                if (e.key === "Escape") {
                  setDraft(label);
                  setEditing(false);
                }
              }}
              className="h-8"
            />
            <Button size="sm" disabled={!draft.trim() || rename.isPending} onClick={() => rename.mutate(draft.trim())}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(label);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
          >
            {label}
          </button>
        )}
        {!editing && <Badge variant="secondary">{memoryCount}</Badge>}
      </div>
      {!editing && (
        <>
          <p className="text-xs text-muted-foreground">{summary}</p>
          <p className="text-xs italic text-muted-foreground/80">{additionalContext}</p>
        </>
      )}
    </div>
  );
}

function ResetCategoriesDialog({ bucketId, disabled }: { bucketId: string; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () => api.resetCategories(bucketId, typed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setOpen(false);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Reset failed"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped("");
          setError(null);
        }
      }}
    >
      <Button variant="destructive" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        Reset categories
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset this bucket&apos;s categories?</DialogTitle>
          <DialogDescription>
            Detaches every memory in this bucket from its category. Your memories themselves are not
            touched — only the grouping is removed. This cannot be undone; re-running Smart Memory
            afterward creates fresh categories from scratch.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-2">
          <Label htmlFor="reset-confirmation">
            Type <span className="mono-tag">{RESET_CONFIRMATION}</span> to confirm
          </Label>
          <Input
            id="reset-confirmation"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            placeholder={RESET_CONFIRMATION}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={typed !== RESET_CONFIRMATION || reset.isPending}
            onClick={() => reset.mutate()}
          >
            {reset.isPending ? "Resetting…" : "Reset categories"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function recategorizeMessage(result: RecategorizeResult): string {
  if (result.status === "too_few") {
    return `Not enough memories yet — Smart Memory needs at least ${result.minimum} in this bucket (it has ${result.memoryCount}).`;
  }
  if (result.status === "too_large") {
    return `This bucket is too large to categorize right now (${result.memoryCount} memories, ${result.tokenCount} tokens — limits are ${result.maxMemories} memories / ${result.maxTokens} tokens).`;
  }
  return `Categorized into ${result.categories.length} ${result.categories.length === 1 ? "category" : "categories"}.`;
}

export default function SmartMemoryPage() {
  const queryClient = useQueryClient();
  const [snippet, setSnippet] = useState("");
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [bucketId, setBucketId] = useState<string | undefined>(undefined);
  const [recategorizeMsg, setRecategorizeMsg] = useState<string | null>(null);

  const account = useQuery({ queryKey: ["account", "me"], queryFn: api.me });
  const buckets = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const memoryBuckets = buckets.data?.buckets.filter((b) => b.type === "memory") ?? [];
  const activeBucketId = bucketId ?? memoryBuckets[0]?.id;
  const activeBucket = memoryBuckets.find((b) => b.id === activeBucketId);

  const categories = useQuery({
    queryKey: ["categories", activeBucketId],
    queryFn: () => api.categories(activeBucketId),
    enabled: Boolean(activeBucketId),
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateSmartMemory(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account", "me"] });
      setPreview(null);
    },
  });

  const recategorize = useMutation({
    mutationFn: () => api.recategorizeCategories(activeBucketId!),
    onSuccess: (result) => {
      setRecategorizeMsg(recategorizeMessage(result));
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const runPreview = useMutation({
    mutationFn: () => api.previewContext({ snippet, bucketId: activeBucketId }),
    onSuccess: (result) => setPreview(result),
  });

  const smartMemoryEnabled = account.data?.account.smartMemoryEnabled ?? true;
  const savingsPercent =
    preview && preview.everythingTokens > 0
      ? Math.round((1 - preview.actualTokens / preview.everythingTokens) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Smart Mode</CardTitle>
            <CardDescription>
              When on, only the memories relevant to a conversation are sent — not your whole notebook.
            </CardDescription>
          </div>
          <Toggle checked={smartMemoryEnabled} onChange={(v) => toggle.mutate(v)} />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              Smart Memory groups one bucket&apos;s memories into named categories in a single batch pass —
              re-run it any time to reflect what you&apos;ve saved since.
            </CardDescription>
          </div>
          {memoryBuckets.length > 0 && (
            <select
              value={activeBucketId ?? ""}
              onChange={(e) => {
                setBucketId(e.target.value);
                setRecategorizeMsg(null);
              }}
              className="h-8 shrink-0 rounded-md border border-input bg-card px-2 text-xs text-muted-foreground"
            >
              {memoryBuckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {activeBucket?.role === "owner" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                disabled={!activeBucketId || recategorize.isPending}
                onClick={() => recategorize.mutate()}
              >
                {recategorize.isPending ? "Categorizing…" : "Run Smart Memory"}
              </Button>
              {activeBucketId && (
                <ResetCategoriesDialog bucketId={activeBucketId} disabled={(categories.data?.categories.length ?? 0) === 0} />
              )}
            </div>
          )}
          {recategorizeMsg && <p className="text-sm text-muted-foreground">{recategorizeMsg}</p>}

          <div className="flex flex-col divide-y divide-border">
            {categories.data && categories.data.categories.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                Not categorized yet{activeBucket?.role === "owner" ? " — run Smart Memory above." : "."}
              </p>
            )}
            {categories.data?.categories.map((category) => (
              <CategoryRow
                key={category.id}
                id={category.id}
                label={category.label}
                summary={category.summary}
                additionalContext={category.additionalContext}
                memoryCount={category.memoryCount}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Try it</CardTitle>
          <CardDescription>
            Paste a sample snippet to see exactly what Smart Memory would inject for the selected bucket —
            this calls the same endpoint a real AI conversation will use.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet">Sample conversation snippet</Label>
            <Textarea
              id="snippet"
              rows={3}
              value={snippet}
              onChange={(e) => setSnippet(e.target.value)}
              placeholder="e.g. What database should I use for my next side project?"
            />
          </div>
          <Button
            size="sm"
            className="w-fit gap-2"
            disabled={!snippet.trim() || runPreview.isPending}
            onClick={() => runPreview.mutate()}
          >
            <Sparkles className="h-4 w-4" />
            {runPreview.isPending ? "Previewing…" : "Preview"}
          </Button>

          {preview && (
            <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
              {preview.smartModeEnabled ? (
                <p className="text-sm text-muted-foreground">
                  Reduced from {preview.everythingTokens} to {preview.actualTokens} tokens (~{savingsPercent}%
                  smaller).
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Smart Mode is off — showing everything, unfiltered ({preview.everythingTokens} tokens).
                </p>
              )}

              {preview.categories && (
                <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-2.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tier 1 — category summaries
                  </p>
                  {preview.categories.map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className={c.expanded ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                      <Badge variant={c.expanded ? "default" : "outline"} className="shrink-0">
                        {c.expanded ? "expanded" : "summary only"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              {preview.memories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No memories in scope yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {preview.memories.map((memory) => {
                    const category = preview.categories?.find((c) => c.id === memory.categoryId);
                    return (
                      <div key={memory.id} className="flex items-start justify-between gap-3 py-2.5">
                        <p className="line-clamp-2 text-sm text-foreground">{memory.content}</p>
                        {category && (
                          <Badge variant="outline" className="shrink-0">
                            {category.label}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
