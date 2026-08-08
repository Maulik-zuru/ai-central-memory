"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CreateMemoryDialog } from "@/components/memory/create-memory-dialog";
import { MemoryRow } from "@/components/memory/memory-row";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Brain } from "lucide-react";

export default function MemoriesPage() {
  const [q, setQ] = useState("");
  const searchParams = useSearchParams();
  const bucketId = searchParams.get("bucket") ?? undefined;

  const buckets = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const activeBucket = buckets.data?.buckets.find((b) => b.id === bucketId);

  const memories = useQuery({
    queryKey: ["memories", { q, bucketId }],
    queryFn: () => api.memories({ q: q || undefined, limit: 50, bucketId }),
    placeholderData: (prev) => prev,
  });

  const suggestions = useQuery({ queryKey: ["suggestions"], queryFn: api.suggestions });
  const pendingCount = suggestions.data?.suggestions.length ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {bucketId && (
        <h1 className="text-xl">{activeBucket ? activeBucket.name : "Bucket"}</h1>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your memories…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/memories/suggestions">
            <Badge variant={pendingCount > 0 ? "default" : "outline"} className="cursor-pointer gap-1.5 px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {pendingCount > 0 ? `${pendingCount} suggestion${pendingCount === 1 ? "" : "s"}` : "No suggestions"}
            </Badge>
          </Link>
          <CreateMemoryDialog bucketId={bucketId} />
        </div>
      </div>

      {memories.data && memories.data.items.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={q ? "No memories match that search" : "Your memory notebook lives here"}
          description={
            q
              ? "Try a different word, or clear the search to see everything."
              : "Save a fact, preference, or decision once — every connected AI will recall it from your next conversation."
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card px-5 shadow-[var(--shadow-card)]">
          {memories.data?.items.map((memory) => <MemoryRow key={memory.id} memory={memory} />)}
        </div>
      )}
    </div>
  );
}
