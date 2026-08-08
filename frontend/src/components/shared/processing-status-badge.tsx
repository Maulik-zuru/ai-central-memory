import { Badge } from "@/components/ui/badge";
import { type ProcessingStatus } from "@/lib/api";

// Shared by Chat History's Conversation.status and Files' File.status — one visual language for
// "still working on it" across both phases (see docs/Phase5_Implementation_Plan.md §9 /
// Phase6_Implementation_Plan.md §9), not a badge forked per feature.
const LABELS: Record<ProcessingStatus, string> = {
  processing: "Processing",
  importing: "Importing",
  ready: "Ready",
  error: "Error",
};

export function ProcessingStatusBadge({ status }: { status: ProcessingStatus }) {
  const variant = status === "ready" ? "success" : status === "error" ? "destructive" : "secondary";
  return <Badge variant={variant}>{LABELS[status]}</Badge>;
}
