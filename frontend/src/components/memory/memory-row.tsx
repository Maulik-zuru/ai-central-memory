"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, memoryImageSrc, type Memory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "./source-badge";

function relativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// content-visibility keeps rendering cheap past hundreds of rows without a virtualization
// library — the browser skips layout/paint for rows outside the viewport (US-MEM-09;
// vercel-react-best-practices rendering-content-visibility).
export function MemoryRow({ memory }: { memory: Memory }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteMemory(memory.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memories"] }),
  });

  const imageSrc = memoryImageSrc(memory);

  return (
    <div
      className="flex items-start gap-4 border-b border-border py-4 last:border-0"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 88px" }}
    >
      {imageSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt={memory.content} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      )}
      <Link href={`/dashboard/memories/${memory.id}`} className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm text-foreground">{memory.content}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="mono-tag text-xs text-muted-foreground">{relativeTime(memory.createdAt)}</span>
          <SourceBadge source={memory.source} />
        </div>
      </Link>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
