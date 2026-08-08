import { Brain } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

export default function MemoriesPage() {
  return (
    <EmptyState
      icon={Brain}
      title="Your memory notebook lives here"
      description="Save facts, preferences, and decisions once — every connected AI will recall them from your next conversation."
      eta="Ships in Phase 2"
    />
  );
}
