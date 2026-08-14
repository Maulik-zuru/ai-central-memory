"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const PLATFORMS = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
];

// Gemini/TypingMind/Grok/DeepSeek are a documented gap (Phase5_Implementation_Plan.md §3) — no
// verified export parser exists for them yet, so they're shown but disabled rather than silently
// missing, matching the plan's "not a silent guess shipped as if it worked" stance.
const UNSUPPORTED_PLATFORMS = ["Gemini", "TypingMind", "Grok", "DeepSeek"];

export function ImportWizardDialog({ bucketId }: { bucketId: string }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState(PLATFORMS[0].value);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const usage = useQuery({ queryKey: ["chat-history-usage"], queryFn: api.historyUsage });

  const importMutation = useMutation({
    mutationFn: () => api.importConversations(file!, bucketId, platform),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["chat-history-usage"] });
      setOpen(false);
      setFile(null);
    },
  });

  // Per-platform, not account-wide (MemoryPlugin_Clone_Spec.md §3.3) — the count that matters is
  // however many conversations are already imported from the platform currently selected above,
  // not a total across every platform this account has ever imported from.
  const platformCount = usage.data?.platforms.find((p) => p.platform === platform)?.count ?? 0;
  const atLimit = usage.data?.limit !== null && usage.data !== undefined && platformCount >= (usage.data.limit ?? Infinity);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Import conversations
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import your conversation history</DialogTitle>
          <DialogDescription>Upload an export file from a supported platform.</DialogDescription>
        </DialogHeader>

        {atLimit && (
          <Alert variant="destructive" className="mb-4">
            You&apos;ve reached the Core plan&apos;s {usage.data?.limit}-conversation limit for {platform}. Upgrade
            to Pro for unlimited history.
          </Alert>
        )}
        {importMutation.isError && (
          <Alert variant="destructive" className="mb-4">
            {importMutation.error instanceof Error ? importMutation.error.message : "Import failed"}
          </Alert>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Platform</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlatform(p.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    platform === p.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {UNSUPPORTED_PLATFORMS.map((label) => (
                <span
                  key={label}
                  title="Not supported yet"
                  className="cursor-not-allowed rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground/50"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Export file</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-accent"
            >
              {file ? file.name : "Click to choose a JSON export file"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={!file || atLimit || importMutation.isPending} onClick={() => importMutation.mutate()}>
            {importMutation.isPending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
