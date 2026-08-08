import { FileText } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";

export default function FilesPage() {
  return (
    <EmptyState
      icon={FileText}
      title="Turn documents into queryable knowledge"
      description="Upload PDFs, Word docs, and Markdown — ask questions and get answers with page-level citations."
      eta="Ships in Phase 6"
    />
  );
}
