"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Pin, PinOff, Trash2 } from "lucide-react";
import { api, type Conversation } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Phase 21 (MemoryPlugin_Clone_Spec.md §3.3): the three distinct chat-history operations — a
// pin toggle, and Exclude/Delete each behind their own confirm dialog since both are destructive
// in different ways (Exclude wipes content but keeps a placeholder that blocks re-import; Delete
// removes the row outright and a later sync/import can recreate it). Shared by the conversation
// list and the transcript detail page so both stay in sync rather than drifting independently.
export function ConversationActions({
  conversation,
  onDeleted,
  onExcluded,
}: {
  conversation: Pick<Conversation, "id" | "pinned">;
  onDeleted?: () => void;
  onExcluded?: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<"delete" | "exclude" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    queryClient.invalidateQueries({ queryKey: ["transcript", conversation.id] });
  }

  const togglePin = useMutation({
    mutationFn: () => api.setConversationPinned(conversation.id, !conversation.pinned),
    onSuccess: invalidate,
  });

  const rejectionMessage = (rejected: { id: string; reason: string }[]) => rejected[0]?.reason ?? "This conversation is pinned.";

  const del = useMutation({
    mutationFn: () => api.deleteConversations([conversation.id]),
    onSuccess: (result) => {
      if (result.rejected.length > 0) {
        setError(rejectionMessage(result.rejected));
        return;
      }
      setConfirming(null);
      invalidate();
      onDeleted?.();
    },
  });

  const exclude = useMutation({
    mutationFn: () => api.excludeConversations([conversation.id]),
    onSuccess: (result) => {
      if (result.rejected.length > 0) {
        setError(rejectionMessage(result.rejected));
        return;
      }
      setConfirming(null);
      invalidate();
      onExcluded?.();
    },
  });

  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Button
        size="icon"
        variant="ghost"
        className={`h-8 w-8 ${conversation.pinned ? "text-primary" : "text-muted-foreground"}`}
        title={conversation.pinned ? "Unpin" : "Pin — protects this conversation from Delete and Exclude"}
        disabled={togglePin.isPending}
        onClick={(e) => {
          e.preventDefault();
          togglePin.mutate();
        }}
      >
        {conversation.pinned ? <Pin className="h-3.5 w-3.5" fill="currentColor" /> : <PinOff className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        title="Exclude — wipes content, never re-imported"
        onClick={(e) => {
          e.preventDefault();
          setError(null);
          setConfirming("exclude");
        }}
      >
        <EyeOff className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        title="Delete — irreversible, but can reappear on a future sync/import"
        onClick={(e) => {
          e.preventDefault();
          setError(null);
          setConfirming("delete");
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirming === "exclude" ? "Exclude this conversation?" : "Delete this conversation?"}</DialogTitle>
            <DialogDescription>
              {confirming === "exclude"
                ? "Wipes its content and vectors, keeping only a placeholder. A future sync or import of this same conversation will never bring it back."
                : "Removes this conversation entirely. Unlike Exclude, a future sync or import of the same conversation can recreate it."}
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={del.isPending || exclude.isPending}
              onClick={() => (confirming === "exclude" ? exclude.mutate() : del.mutate())}
            >
              {confirming === "exclude"
                ? exclude.isPending
                  ? "Excluding…"
                  : "Exclude"
                : del.isPending
                  ? "Deleting…"
                  : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
