"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type AskCitation } from "@/lib/api";

const LABELS: Record<AskCitation["sourceType"], string> = {
  memory: "Memory",
  message: "Chat",
  file: "File",
};

// Reuses the three existing detail pages Phase 2/5/6 already built — no new detail view for Ask.
function hrefFor(citation: AskCitation): string {
  if (citation.sourceType === "memory") return `/dashboard/memories/${citation.sourceId}`;
  if (citation.sourceType === "message") return `/dashboard/chat-history/${citation.sourceId}`;
  return `/dashboard/files/${citation.sourceId}`;
}

function labelFor(citation: AskCitation): string {
  if (citation.sourceType === "file") {
    const filename = citation.meta.filename as string | undefined;
    const page = citation.meta.page as number | undefined;
    return filename ? `${filename}${page ? ` · p.${page}` : ""}` : "File";
  }
  if (citation.sourceType === "message") {
    const title = citation.meta.title as string | undefined;
    return title ?? "Conversation";
  }
  return citation.snippet.slice(0, 40);
}

export function CitationChip({ citation }: { citation: AskCitation }) {
  return (
    <Link
      href={hrefFor(citation)}
      className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left text-xs transition-colors hover:border-primary"
    >
      <Badge variant="outline" className="w-fit">
        {LABELS[citation.sourceType]}
      </Badge>
      <span className="font-medium text-foreground">{labelFor(citation)}</span>
      <span className="line-clamp-2 text-muted-foreground">{citation.snippet}</span>
    </Link>
  );
}
