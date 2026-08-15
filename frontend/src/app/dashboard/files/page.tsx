"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ProcessingStatusBadge } from "@/components/shared/processing-status-badge";
import { UploadDropzone } from "@/components/file/upload-dropzone";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const buckets = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const defaultBucketId = buckets.data?.buckets.find((b) => b.isDefault)?.id ?? buckets.data?.buckets[0]?.id;

  const files = useQuery({
    queryKey: ["files"],
    queryFn: () => api.files({ limit: 50 }),
    enabled: !query,
    // Processing happens in the background (processing.service.ts) — poll while anything here is
    // still "processing" so the status badge catches up on its own, same as the account-export
    // card's identical queued/running poll (data-export-card.tsx).
    refetchInterval: (q) => (q.state.data?.items.some((f) => f.status === "processing") ? 2000 : false),
  });
  const search = useMutation({ mutationFn: () => api.fileSearch({ query }) });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });

  const showingSearch = query.trim().length > 0 && search.data;
  const items = showingSearch
    ? search.data!.results.map((r) => ({
        id: r.fileId,
        filename: r.filename,
        preview: r.preview as string | null,
        page: r.page as number | null,
        status: "ready" as const,
        sizeBytes: null as number | null,
      }))
    : (files.data?.items ?? []).map((f) => ({
        id: f.id,
        filename: f.filename,
        preview: null as string | null,
        page: null as number | null,
        status: f.status,
        sizeBytes: f.sizeBytes as number | null,
      }));

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query.trim() && search.mutate()}
            placeholder="Search your files by content…"
            className="pl-9"
          />
        </div>
      </div>

      {defaultBucketId && !query && <UploadDropzone bucketId={defaultBucketId} />}

      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={query ? "No files match that search" : "Your document knowledge base lives here"}
          description={
            query
              ? "Try a different phrase, or clear the search to see every file you've uploaded."
              : "Upload a PDF, Word doc, or Markdown file — ask questions and get answers with page-level citations."
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card px-5 shadow-[var(--shadow-card)]">
          {items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-4 border-b border-border py-4 last:border-0">
              <Link href={`/dashboard/files/${item.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{item.filename}</p>
                {item.preview ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    Page {item.page}: {item.preview}
                  </p>
                ) : item.sizeBytes ? (
                  <p className="mt-1 text-xs text-muted-foreground">{formatSize(item.sizeBytes)}</p>
                ) : null}
              </Link>
              <div className="flex items-center gap-2">
                <ProcessingStatusBadge status={item.status} />
                {!showingSearch && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove.mutate(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
