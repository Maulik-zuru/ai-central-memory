"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api, memoryImageSrc } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SourceBadge } from "@/components/memory/source-badge";
import { VersionTimeline } from "@/components/memory/version-timeline";

export default function MemoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);

  const memoryQuery = useQuery({ queryKey: ["memory", id], queryFn: () => api.memory(id) });
  const versionsQuery = useQuery({ queryKey: ["memory-versions", id], queryFn: () => api.memoryVersions(id) });
  const bucketsQuery = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });

  const move = useMutation({
    mutationFn: (bucketId: string) => api.moveMemory(id, bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", id] });
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const update = useMutation({
    mutationFn: (content: string) => api.updateMemory(id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memory", id] });
      queryClient.invalidateQueries({ queryKey: ["memory-versions", id] });
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setDraft(null);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteMemory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      router.push("/dashboard/memories");
    },
  });

  if (!memoryQuery.data) return null;
  const memory = memoryQuery.data.memory;
  const imageSrc = memoryImageSrc(memory);
  const isEditing = draft !== null;

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit gap-1.5 text-muted-foreground" onClick={() => router.push("/dashboard/memories")}>
        <ArrowLeft className="h-4 w-4" />
        Back to memories
      </Button>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Memory</CardTitle>
            <SourceBadge source={memory.source} />
          </div>
          <div className="flex items-center gap-2">
            {bucketsQuery.data && (
              <select
                value={memory.bucketId}
                disabled={move.isPending}
                onChange={(e) => move.mutate(e.target.value)}
                className="h-8 rounded-md border border-input bg-card px-2 text-xs text-muted-foreground"
              >
                {bucketsQuery.data.buckets
                  .filter((b) => b.role !== "viewer")
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            )}
            <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate()}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {imageSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt={memory.content} className="max-h-80 w-full rounded-lg object-cover" />
          )}

          {isEditing ? (
            <div className="flex flex-col gap-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={update.isPending || !draft.trim()} onClick={() => update.mutate(draft)}>
                  {update.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-left text-sm leading-relaxed hover:text-foreground" onClick={() => setDraft(memory.content)}>
              {memory.content}
            </button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent>
          {versionsQuery.data && versionsQuery.data.versions.length > 0 ? (
            <VersionTimeline versions={versionsQuery.data.versions} />
          ) : (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
