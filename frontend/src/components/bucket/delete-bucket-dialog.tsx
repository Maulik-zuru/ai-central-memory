"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function DeleteBucketDialog({
  bucketId,
  bucketName,
  open,
  onOpenChange,
}: {
  bucketId: string;
  bucketName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.deleteBucket(bucketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &quot;{bucketName}&quot;?</DialogTitle>
          <DialogDescription>
            Move or delete anything inside it first — a bucket with memories or sub-buckets can&apos;t be deleted.
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <Alert variant="destructive">
            {remove.error instanceof ApiError ? remove.error.message : "Could not delete this bucket."}
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : "Delete bucket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
