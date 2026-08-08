import { FolderOpen } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

export default function BucketsPage() {
  return (
    <EmptyState
      icon={FolderOpen}
      title="Organize context into buckets"
      description="Keep Personal, Work, and each client's context separate — and share a bucket with a teammate when you need to."
      eta="Ships in Phase 3"
    />
  );
}
