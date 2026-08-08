import { type Bucket } from "./api";

export interface BucketTreeNode extends Bucket {
  children: BucketTreeNode[];
}

// Flat list -> tree, using the same "unreachable parent means top-level" rule the backend applies
// (a bucket whose true parent the caller can't see is reported as top-level for them).
export function buildBucketTree(buckets: Bucket[]): BucketTreeNode[] {
  const byId = new Map<string, BucketTreeNode>(buckets.map((b) => [b.id, { ...b, children: [] }]));
  const roots: BucketTreeNode[] = [];

  for (const bucket of byId.values()) {
    if (bucket.parentId && byId.has(bucket.parentId)) {
      byId.get(bucket.parentId)!.children.push(bucket);
    } else {
      roots.push(bucket);
    }
  }
  return roots;
}
