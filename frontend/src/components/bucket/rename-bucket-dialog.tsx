"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RenameBucketDialog({
  bucketId,
  currentName,
  open,
  onOpenChange,
}: {
  bucketId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(currentName);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const rename = useMutation({
    mutationFn: () => api.renameBucket(bucketId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename bucket</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rename-bucket">Name</Label>
          <Input id="rename-bucket" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || rename.isPending} onClick={() => rename.mutate()}>
            {rename.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
