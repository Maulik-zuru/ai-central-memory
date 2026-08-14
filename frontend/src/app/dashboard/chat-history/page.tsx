"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ProcessingStatusBadge } from "@/components/shared/processing-status-badge";
import { ImportWizardDialog } from "@/components/chat-history/import-wizard-dialog";
import { ConversationActions } from "@/components/chat-history/conversation-actions";

function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ChatHistoryPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"semantic" | "precise">("semantic");

  const buckets = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const defaultBucketId = buckets.data?.buckets.find((b) => b.isDefault)?.id ?? buckets.data?.buckets[0]?.id;

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.conversations({ limit: 50 }),
    enabled: !query,
  });

  const search = useMutation({ mutationFn: () => api.chatSearch({ query, mode }) });

  const showingSearch = query.trim().length > 0 && search.data;
  const items = showingSearch
    ? search.data!.results.map((r) => ({
        id: r.conversationId,
        title: r.title,
        platform: r.platform,
        preview: r.preview,
        status: "ready" as const,
        importedAt: null as string | null,
        pinned: null as boolean | null, // search results don't carry full conversation metadata
      }))
    : (conversations.data?.items ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        platform: c.platform,
        preview: c.summary,
        status: c.status,
        importedAt: c.importedAt,
        pinned: c.pinned as boolean | null,
      }));

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && query.trim() && search.mutate()}
              placeholder="Search your conversations by meaning…"
              className="pl-9"
            />
          </div>
          {query.trim() && (
            <div className="flex gap-1 rounded-lg bg-secondary p-1">
              {(["semantic", "precise"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    search.mutate();
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
                    mode === m ? "bg-card shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        {defaultBucketId && <ImportWizardDialog bucketId={defaultBucketId} />}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={query ? "No conversations match that search" : "Your conversation archive lives here"}
          description={
            query
              ? "Try a different phrase, or clear the search to see everything you've imported."
              : "Import a ChatGPT or Claude export to bring your past conversations in — searchable by meaning, not just keywords."
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card px-5 shadow-[var(--shadow-card)]">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/chat-history/${item.id}`}
              className="flex items-start justify-between gap-4 border-b border-border py-4 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                {item.preview && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.preview}</p>}
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {item.platform}
                  </Badge>
                  {item.importedAt && (
                    <span className="mono-tag text-xs text-muted-foreground">{relativeTime(item.importedAt)}</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.status === "excluded" ? <Badge variant="outline">Excluded</Badge> : <ProcessingStatusBadge status={item.status} />}
                {item.pinned !== null && <ConversationActions conversation={{ id: item.id, pinned: item.pinned }} />}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
