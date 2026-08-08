"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { buildBucketTree } from "@/lib/bucket-tree";
import { CreateBucketDialog } from "./create-bucket-dialog";
import { BucketRow } from "./bucket-row";

export function BucketNav() {
  const { data } = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const tree = buildBucketTree(data?.buckets ?? []);

  return (
    <div className="mt-1 flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Buckets</span>
        <CreateBucketDialog />
      </div>
      {tree.map((bucket) => (
        <BucketRow key={bucket.id} bucket={bucket} depth={0} />
      ))}
    </div>
  );
}
