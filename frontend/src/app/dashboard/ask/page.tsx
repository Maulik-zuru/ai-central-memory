import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

export default function AskPage() {
  return (
    <EmptyState
      icon={Sparkles}
      title="Ask across memories, chats, and files"
      description="One question, answered by whichever of your memories, past chats, and documents are relevant — with sources."
      eta="Ships in Phase 7"
    />
  );
}
