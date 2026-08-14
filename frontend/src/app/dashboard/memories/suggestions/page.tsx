"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles } from "lucide-react";
import { api, type Suggestion } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SuggestionCard, PendingCountBadge, CheckForNewAcrossBucketsButton } from "@/components/memory/suggestion-cards";

// Phase 19 (ADR-0004): "a pending-count badge per bucket" and "a 'Check for new' manual scan
// action" — grouped by bucket right here rather than threaded into the sidebar's bucket tree,
// since suggestions already carry their own bucketId and this page is the one place reviewing
// them happens. "capture" suggestions have no memory yet (bucketId is null) and get their own
// bucket-agnostic group, shown first since they're the most actionable/time-sensitive.
function groupByBucket(suggestions: Suggestion[]): { bucketId: string | null; items: Suggestion[] }[] {
  const order: (string | null)[] = [];
  const byBucket = new Map<string | null, Suggestion[]>();
  for (const suggestion of suggestions) {
    if (!byBucket.has(suggestion.bucketId)) {
      order.push(suggestion.bucketId);
      byBucket.set(suggestion.bucketId, []);
    }
    byBucket.get(suggestion.bucketId)!.push(suggestion);
  }
  return order.map((bucketId) => ({ bucketId, items: byBucket.get(bucketId)! }));
}

export default function SuggestionsPage() {
  const { data } = useQuery({ queryKey: ["suggestions"], queryFn: api.suggestions });
  const { data: bucketsData } = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const suggestions = data?.suggestions ?? [];
  const buckets = bucketsData?.buckets ?? [];
  const bucketsById = new Map(buckets.map((b) => [b.id, b]));
  const groups = groupByBucket(suggestions);
  // "Check for new" only makes sense against buckets the caller can actually write suggestions
  // into (POST /api/suggestions/scan requires editor+) — always offered here, not just next to a
  // bucket that already happens to have something pending, since the whole point of a manual scan
  // is covering buckets with nothing flagged yet.
  const editableBucketIds = buckets.filter((b) => b.role !== "viewer").map((b) => b.id);

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="w-fit gap-1.5 text-muted-foreground">
        <Link href="/dashboard/memories">
          <ArrowLeft className="h-4 w-4" />
          Back to memories
        </Link>
      </Button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">Suggestions</h1>
          <p className="text-sm text-muted-foreground">Review what your notebook noticed — approve or dismiss each one.</p>
        </div>
        <CheckForNewAcrossBucketsButton bucketIds={editableBucketIds} />
      </div>

      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Sparkles className="h-6 w-6" />
          <p className="text-sm">Nothing pending — your notebook is caught up.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            const bucket = group.bucketId ? bucketsById.get(group.bucketId) : undefined;
            return (
              <div key={group.bucketId ?? "capture"} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">{bucket?.name ?? "New memories"}</h2>
                  <PendingCountBadge count={group.items.length} />
                </div>
                <div className="flex flex-col gap-3">
                  {group.items.map((suggestion) => (
                    <SuggestionCard key={suggestion.id} suggestion={suggestion} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
