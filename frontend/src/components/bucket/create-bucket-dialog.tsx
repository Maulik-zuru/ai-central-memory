"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export function CreateBucketDialog({ parentId, parentName }: { parentId?: string; parentName?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () => api.createBucket(name, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      setOpen(false);
      setName("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" title={parentId ? `New sub-bucket in ${parentName}` : "New bucket"}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parentId ? `New bucket in "${parentName}"` : "New bucket"}</DialogTitle>
          <DialogDescription>Keep unrelated context — personal, a client, a project — separate.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bucket-name">Name</Label>
          <Input id="bucket-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Client A" autoFocus />
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create bucket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
