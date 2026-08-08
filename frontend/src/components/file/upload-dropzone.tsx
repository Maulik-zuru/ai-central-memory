"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { Alert } from "@/components/ui/alert";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
];

// Drag-drop with a keyboard/screen-reader-accessible fallback (a real <input type="file">
// triggered by a focusable button, not drag-drop-only) — web-design-guidelines' accessibility
// bar for this phase's new interactive element.
export function UploadDropzone({ bucketId }: { bucketId: string }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadFile(file, bucketId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) upload.mutate(file);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors ${
          dragOver ? "border-primary bg-accent" : "border-border hover:bg-accent"
        }`}
      >
        <UploadCloud className="h-5 w-5" />
        {upload.isPending ? "Uploading…" : "Drag a file here, or click to choose one"}
        {/* No opacity modifier: /70 dropped this below the AA contrast floor (Phase 12 a11y pass). */}
        <span className="text-xs text-muted-foreground">PDF, Word, Markdown, or plain text</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {upload.isError && (
        <Alert variant="destructive">
          {upload.error instanceof Error ? upload.error.message : "Upload failed"}
        </Alert>
      )}
    </div>
  );
}
