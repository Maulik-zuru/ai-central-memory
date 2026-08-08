"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, type ContextPreview } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function CategoryRow({ id, label, memoryCount }: { id: string; label: string; memoryCount: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const queryClient = useQueryClient();

  const rename = useMutation({
    mutationFn: (nextLabel: string) => api.renameCategory(id, nextLabel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setEditing(false);
    },
  });

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      {editing ? (
        <div className="flex flex-1 items-center gap-2">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) rename.mutate(draft.trim());
              if (e.key === "Escape") {
                setDraft(label);
                setEditing(false);
              }
            }}
            className="h-8"
          />
          <Button size="sm" disabled={!draft.trim() || rename.isPending} onClick={() => rename.mutate(draft.trim())}>
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(label);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline"
        >
          {label}
        </button>
      )}
      {!editing && <Badge variant="secondary">{memoryCount}</Badge>}
    </div>
  );
}

export default function SmartMemoryPage() {
  const queryClient = useQueryClient();
  const [snippet, setSnippet] = useState("");
  const [preview, setPreview] = useState<ContextPreview | null>(null);

  const account = useQuery({ queryKey: ["account", "me"], queryFn: api.me });
  const categories = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateSmartMemory(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account", "me"] });
      setPreview(null);
    },
  });

  const runPreview = useMutation({
    mutationFn: () => api.previewContext({ snippet }),
    onSuccess: (result) => setPreview(result),
  });

  const smartMemoryEnabled = account.data?.account.smartMemoryEnabled ?? true;
  const savingsPercent =
    preview && preview.everythingTokens > 0
      ? Math.round((1 - preview.actualTokens / preview.everythingTokens) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Smart Mode</CardTitle>
            <CardDescription>
              When on, only the memories relevant to a conversation are sent — not your whole notebook.
            </CardDescription>
          </div>
          <Toggle checked={smartMemoryEnabled} onChange={(v) => toggle.mutate(v)} />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>
            Memories are grouped automatically as you save them. Click a label to rename its category.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {categories.data && categories.data.categories.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              No categories yet — save a few memories and they&apos;ll be grouped here.
            </p>
          )}
          {categories.data?.categories.map((category) => (
            <CategoryRow key={category.id} id={category.id} label={category.label} memoryCount={category.memoryCount} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Try it</CardTitle>
          <CardDescription>
            Paste a sample snippet to see exactly what Smart Memory would inject — this calls the same
            endpoint a real AI conversation will use.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snippet">Sample conversation snippet</Label>
            <Textarea
              id="snippet"
              rows={3}
              value={snippet}
              onChange={(e) => setSnippet(e.target.value)}
              placeholder="e.g. What database should I use for my next side project?"
            />
          </div>
          <Button
            size="sm"
            className="w-fit gap-2"
            disabled={!snippet.trim() || runPreview.isPending}
            onClick={() => runPreview.mutate()}
          >
            <Sparkles className="h-4 w-4" />
            {runPreview.isPending ? "Previewing…" : "Preview"}
          </Button>

          {preview && (
            <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
              {preview.smartModeEnabled ? (
                <p className="text-sm text-muted-foreground">
                  Reduced from {preview.everythingTokens} to {preview.actualTokens} tokens (~{savingsPercent}%
                  smaller).
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Smart Mode is off — showing everything, unfiltered ({preview.everythingTokens} tokens).
                </p>
              )}

              {preview.memories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No memories in scope yet.</p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {preview.memories.map((memory) => {
                    const category = categories.data?.categories.find((c) => c.id === memory.categoryId);
                    return (
                      <div key={memory.id} className="flex items-start justify-between gap-3 py-2.5">
                        <p className="line-clamp-2 text-sm text-foreground">{memory.content}</p>
                        {category && (
                          <Badge variant="outline" className="shrink-0">
                            {category.label}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
