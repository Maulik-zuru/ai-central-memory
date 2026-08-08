"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Pencil, Share2, Trash2 } from "lucide-react";
import { type BucketTreeNode } from "@/lib/bucket-tree";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CreateBucketDialog } from "./create-bucket-dialog";
import { RenameBucketDialog } from "./rename-bucket-dialog";
import { DeleteBucketDialog } from "./delete-bucket-dialog";
import { ManageMembersDialog } from "./manage-members-dialog";

function BucketMenu({ bucket, onRename, onDelete, onManage }: { bucket: BucketTreeNode; onRename: () => void; onDelete: () => void; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-raised)]">
            {bucket.role === "owner" && (
              <button
                onClick={() => {
                  setOpen(false);
                  onRename();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5" /> Rename
              </button>
            )}
            {bucket.role === "owner" && (
              <button
                onClick={() => {
                  setOpen(false);
                  onManage();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <Share2 className="h-3.5 w-3.5" /> Share
              </button>
            )}
            {bucket.role === "owner" && !bucket.isDefault && (
              <button
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function BucketRow({ bucket, depth }: { bucket: BucketTreeNode; depth: number }) {
  const searchParams = useSearchParams();
  const active = searchParams.get("bucket") === bucket.id;
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [managing, setManaging] = useState(false);
  const hasChildren = bucket.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md py-1 pr-1 text-sm",
          active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn("shrink-0", !hasChildren && "invisible")}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <Link href={`/dashboard/memories?bucket=${bucket.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{bucket.name}</span>
          {bucket.role !== "owner" && (
            <Badge variant="outline" className="ml-auto shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground">
              {bucket.role}
            </Badge>
          )}
        </Link>
        <CreateBucketDialog parentId={bucket.id} parentName={bucket.name} />
        <BucketMenu
          bucket={bucket}
          onRename={() => setRenaming(true)}
          onDelete={() => setDeleting(true)}
          onManage={() => setManaging(true)}
        />
      </div>

      {expanded && hasChildren && (
        <div>
          {bucket.children.map((child) => (
            <BucketRow key={child.id} bucket={child} depth={depth + 1} />
          ))}
        </div>
      )}

      <RenameBucketDialog bucketId={bucket.id} currentName={bucket.name} open={renaming} onOpenChange={setRenaming} />
      <DeleteBucketDialog bucketId={bucket.id} bucketName={bucket.name} open={deleting} onOpenChange={setDeleting} />
      <ManageMembersDialog bucketId={bucket.id} bucketName={bucket.name} open={managing} onOpenChange={setManaging} />
    </div>
  );
}
