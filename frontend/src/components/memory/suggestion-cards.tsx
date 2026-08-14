"use client";

import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Combine, History, Sparkles, Trash2, X } from "lucide-react";
import { api, type Suggestion } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function useApproveDismiss(suggestionId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["memories"] });
  };
  const approve = useMutation({ mutationFn: () => api.approveSuggestion(suggestionId), onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: () => api.dismissSuggestion(suggestionId), onSuccess: invalidate });
  return { approve, dismiss };
}

function CardActions({
  approve,
  dismiss,
  approveLabel = "Approve",
}: {
  approve: ReturnType<typeof useApproveDismiss>["approve"];
  dismiss: ReturnType<typeof useApproveDismiss>["dismiss"];
  approveLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" className="gap-1.5" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
        <X className="h-3.5 w-3.5" />
        Dismiss
      </Button>
      <Button size="sm" className="gap-1.5" disabled={approve.isPending} onClick={() => approve.mutate()}>
        <Check className="h-3.5 w-3.5" />
        {approveLabel}
      </Button>
    </div>
  );
}

function useMemoryPreview(id: string | undefined) {
  return useQuery({
    queryKey: ["memory", id],
    queryFn: () => api.memory(id!),
    enabled: Boolean(id),
  });
}

export function CaptureCard({ suggestion }: { suggestion: Suggestion }) {
  const { approve, dismiss } = useApproveDismiss(suggestion.id);
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-primary">Worth remembering?</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <p className="text-sm">{suggestion.draftContent}</p>
        <CardActions approve={approve} dismiss={dismiss} approveLabel="Save" />
      </CardContent>
    </Card>
  );
}

// Phase 19 (ADR-0004): memoryIds[0] is the redundant memory being removed; a second id, when
// present, is only the "duplicate of" reference the curator's exact/fuzzy tiers attach so the
// reviewer can see what it matched — approving never touches that second memory.
export function RemoveCard({ suggestion }: { suggestion: Suggestion }) {
  const { approve, dismiss } = useApproveDismiss(suggestion.id);
  const target = useMemoryPreview(suggestion.memoryIds[0]);
  const duplicateOf = useMemoryPreview(suggestion.memoryIds[1]);

  return (
    <Card className="border-l-4 border-l-tape">
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
        <Trash2 className="h-3.5 w-3.5 text-tape-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-tape-foreground">Looks like a duplicate</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm">
          <p>{target.data?.memory.content ?? "…"}</p>
          {suggestion.memoryIds[1] && (
            <>
              <div className="h-px bg-border" />
              <p className="text-muted-foreground">{duplicateOf.data?.memory.content ?? "…"}</p>
            </>
          )}
        </div>
        <CardActions approve={approve} dismiss={dismiss} approveLabel="Remove" />
      </CardContent>
    </Card>
  );
}

// Phase 19 (ADR-0004): N-way — memoryIds[0] is the survivor by convention, every other id is
// absorbed into it. draftContent is the curator's own proposed merged text (preserving every
// named category the spec calls out: dates, quantities, identifiers, current state, causal
// "why"), shown as a preview of what approving actually writes — not a blind concatenation.
export function CombineCard({ suggestion }: { suggestion: Suggestion }) {
  const { approve, dismiss } = useApproveDismiss(suggestion.id);
  // useQueries, not one useQuery per id in a .map() — memoryIds.length varies per suggestion, and
  // hooks can't be called a variable number of times per render.
  const previews = useQueries({
    queries: suggestion.memoryIds.map((id) => ({ queryKey: ["memory", id], queryFn: () => api.memory(id) })),
  });

  return (
    <Card className="border-l-4 border-l-tape">
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
        <Combine className="h-3.5 w-3.5 text-tape-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-tape-foreground">
          {suggestion.memoryIds.length} related memories — combine into one?
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm">
          {previews.map((preview, i) => (
            <p key={suggestion.memoryIds[i]} className={i > 0 ? "border-t border-border pt-2 text-muted-foreground" : ""}>
              {preview.data?.memory.content ?? "…"}
            </p>
          ))}
        </div>
        <div className="rounded-lg bg-success/10 p-3 text-sm">
          <p className="mb-1 text-xs text-muted-foreground">Combined into</p>
          <p>{suggestion.draftContent}</p>
        </div>
        <CardActions approve={approve} dismiss={dismiss} approveLabel="Combine" />
      </CardContent>
    </Card>
  );
}

// Phase 19 (ADR-0004): a genuine content rewrite, not just a status flip — memoryIds[0] is the
// stale memory, draftContent is the curator's proposed rewritten (current) text.
export function UpdateCard({ suggestion }: { suggestion: Suggestion }) {
  const { approve, dismiss } = useApproveDismiss(suggestion.id);
  const current = useMemoryPreview(suggestion.memoryIds[0]);

  return (
    <Card className="border-l-4 border-l-destructive">
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
        <History className="h-3.5 w-3.5 text-destructive" />
        <span className="text-xs font-medium uppercase tracking-wide text-destructive">Might be outdated</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-col gap-2 text-sm">
          <div className="rounded-lg bg-destructive/10 p-3">
            <p className="mb-1 text-xs text-muted-foreground">Current</p>
            <p className="line-through opacity-70">{current.data?.memory.content ?? "…"}</p>
          </div>
          <div className="rounded-lg bg-success/10 p-3">
            <p className="mb-1 text-xs text-muted-foreground">Proposed</p>
            <p>{suggestion.draftContent}</p>
          </div>
        </div>
        <CardActions approve={approve} dismiss={dismiss} approveLabel="Update" />
      </CardContent>
    </Card>
  );
}

/** One switch, not four call sites re-deciding which card a suggestion type gets — the dispatch
 * the suggestions page and any future surface (e.g. a per-bucket panel) both go through. */
export function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  switch (suggestion.type) {
    case "capture":
      return <CaptureCard suggestion={suggestion} />;
    case "remove":
      return <RemoveCard suggestion={suggestion} />;
    case "combine":
      return <CombineCard suggestion={suggestion} />;
    case "update":
      return <UpdateCard suggestion={suggestion} />;
    default:
      return null;
  }
}

export function PendingCountBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
      {count}
    </span>
  );
}

/**
 * The spec's "Check for new" manual scan action, across every bucket the caller can write
 * suggestions into at once — a per-bucket button would only ever show up next to a bucket that
 * already has a pending suggestion, which is useless for the exact case this action exists for
 * (a bucket with nothing pending yet, e.g. memories that predate the curator).
 */
export function CheckForNewAcrossBucketsButton({ bucketIds }: { bucketIds: string[] }) {
  const queryClient = useQueryClient();
  const scan = useMutation({
    mutationFn: async () => {
      for (const bucketId of bucketIds) await api.scanSuggestions(bucketId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suggestions"] }),
  });
  if (bucketIds.length === 0) return null;
  return (
    <Button size="sm" variant="outline" className="gap-1.5" disabled={scan.isPending} onClick={() => scan.mutate()}>
      <Sparkles className="h-3.5 w-3.5" />
      {scan.isPending ? "Checking…" : "Check for new"}
    </Button>
  );
}
