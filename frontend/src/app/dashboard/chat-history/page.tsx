import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

export default function ChatHistoryPage() {
  return (
    <EmptyState
      icon={MessageSquare}
      title="Import your past AI conversations"
      description="Bring in your history from ChatGPT, Claude, Gemini, and more — searchable by meaning, not just keywords."
      eta="Ships in Phase 5"
    />
  );
}
