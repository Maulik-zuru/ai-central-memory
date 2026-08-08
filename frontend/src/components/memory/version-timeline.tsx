"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type MemoryVersion } from "@/lib/api";
import { diffWords } from "@/lib/diff";
import { cn } from "@/lib/utils";

const CHANGE_LABELS: Record<MemoryVersion["changeType"], string> = {
  create: "Created",
  edit: "Edited",
  merge: "Merged",
};

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) => (
        <span
          key={i}
          className={cn(
            part.type === "added" && "bg-success/15 text-success",
            part.type === "removed" && "bg-destructive/15 text-destructive line-through",
          )}
        >
          {part.text}
        </span>
      ))}
    </p>
  );
}

// US-MEM-08: a vertical timeline of versions; expanding one shows a word-level diff against the
// version immediately before it — enough to answer "what changed and when" without a full
// git-style multi-version compare, which this product doesn't need yet.
export function VersionTimeline({ versions }: { versions: MemoryVersion[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <ol className="flex flex-col gap-0">
      {versions.map((version, i) => {
        const previous = versions[i - 1];
        const isOpen = expanded === version.id;
        return (
          <li key={version.id} className="border-l-2 border-border pl-4 pb-6 last:pb-0">
            <div className="-ml-[21px] mb-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span className="mono-tag text-xs text-muted-foreground">
                {new Date(version.createdAt).toLocaleString()}
              </span>
              <span className="text-xs font-medium text-muted-foreground">{CHANGE_LABELS[version.changeType]}</span>
            </div>

            {previous ? (
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : version.id)}
                className="mb-2 flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {isOpen ? "Hide changes" : "View changes from previous version"}
              </button>
            ) : null}

            {isOpen && previous ? (
              <div className="rounded-lg border border-border bg-muted p-3">
                <DiffView before={previous.content} after={version.content} />
              </div>
            ) : (
              <p className="line-clamp-3 text-sm text-muted-foreground">{version.content}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
