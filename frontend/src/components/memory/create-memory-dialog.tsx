"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

type Tab = "text" | "image";

export function CreateMemoryDialog({ bucketId }: { bucketId?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("text");
  const [content, setContent] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function reset() {
    setContent("");
    setCaption("");
    setFile(null);
    setTab("text");
  }

  const createText = useMutation({
    mutationFn: () => api.createMemory(content, bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setOpen(false);
      reset();
    },
  });

  const createImage = useMutation({
    mutationFn: () => api.createImageMemory(file!, caption, bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setOpen(false);
      reset();
    },
  });

  const mutation = tab === "text" ? createText : createImage;
  const canSubmit = tab === "text" ? content.trim().length > 0 : file !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New memory
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save a memory</DialogTitle>
          <DialogDescription>Every connected AI will recall this from your next conversation.</DialogDescription>
        </DialogHeader>

        <div className="mb-4 flex gap-1 rounded-lg bg-secondary p-1">
          {(["text", "image"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-sm font-medium transition-colors",
                tab === t ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {t === "text" ? "Text" : "Image"}
            </button>
          ))}
        </div>

        {mutation.isError && <Alert variant="destructive" className="mb-4">Could not save. Try again.</Alert>}

        {tab === "text" ? (
          <Textarea
            autoFocus
            placeholder="e.g. I prefer TypeScript strict mode, no default exports."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-32 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-accent"
            >
              <ImagePlus className="h-5 w-5" />
              {file ? file.name : "Click to choose an image"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="caption">Caption (optional)</Label>
              <Input id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What is this a picture of?" />
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save memory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
