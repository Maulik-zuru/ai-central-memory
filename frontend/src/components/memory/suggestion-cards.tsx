"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, History, X } from "lucide-react";
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

function useMemoryPreview(id: string | null) {
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

export function DuplicateCard({ suggestion }: { suggestion: Suggestion }) {
  const { approve, dismiss } = useApproveDismiss(suggestion.id);
  const a = useMemoryPreview(suggestion.memoryIdA);
  const b = useMemoryPreview(suggestion.memoryIdB);

  return (
    <Card className="border-l-4 border-l-tape">
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
        <Copy className="h-3.5 w-3.5 text-tape-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-tape-foreground">Looks like a duplicate</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm">
          <p>{a.data?.memory.content ?? "…"}</p>
          <div className="h-px bg-border" />
          <p>{b.data?.memory.content ?? "…"}</p>
        </div>
        <CardActions approve={approve} dismiss={dismiss} approveLabel="Merge" />
      </CardContent>
    </Card>
  );
}

// Phase 18.6 (ADR-0003): "replaces" (a genuine contradiction) and "extends" (an addition that
// doesn't invalidate the older memory) approve to different real actions — only "replaces"
// deactivates the older memory. "stale" is the pre-Phase-18 generic type (still handled for any
// suggestion created before this classification existed) and reads the same as "replaces".
// A full unified three-type suggestion card is Phase 19's own deliverable; this is the minimal
// copy/action split needed so approving an "extends" suggestion doesn't claim to do something it
// doesn't.
export function StaleCard({ suggestion }: { suggestion: Suggestion }) {
  const { approve, dismiss } = useApproveDismiss(suggestion.id);
  const older = useMemoryPreview(suggestion.memoryIdA);
  const newer = useMemoryPreview(suggestion.memoryIdB);
  const isExtends = suggestion.type === "extends";

  return (
    <Card className={isExtends ? "border-l-4 border-l-tape" : "border-l-4 border-l-destructive"}>
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
        <History className={`h-3.5 w-3.5 ${isExtends ? "text-tape-foreground" : "text-destructive"}`} />
        <span className={`text-xs font-medium uppercase tracking-wide ${isExtends ? "text-tape-foreground" : "text-destructive"}`}>
          {isExtends ? "Related memories" : "Might be outdated"}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex flex-col gap-2 text-sm">
          <div className={isExtends ? "rounded-lg bg-muted p-3" : "rounded-lg bg-destructive/10 p-3"}>
            <p className="mb-1 text-xs text-muted-foreground">{isExtends ? "Existing" : "Older"}</p>
            <p className={isExtends ? "" : "line-through opacity-70"}>{older.data?.memory.content ?? "…"}</p>
          </div>
          <div className="rounded-lg bg-success/10 p-3">
            <p className="mb-1 text-xs text-muted-foreground">{isExtends ? "New" : "Newer"}</p>
            <p>{newer.data?.memory.content ?? "…"}</p>
          </div>
        </div>
        <CardActions approve={approve} dismiss={dismiss} approveLabel={isExtends ? "Keep both" : "Mark old one inactive"} />
      </CardContent>
    </Card>
  );
}
