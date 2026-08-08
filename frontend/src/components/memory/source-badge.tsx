import { Badge } from "@/components/ui/badge";
import { type Memory } from "@/lib/api";

const LABELS: Record<Memory["source"], string> = {
  manual: "Manual",
  one_click: "One-click",
  auto: "Auto-captured",
};

export function SourceBadge({ source }: { source: Memory["source"] }) {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {LABELS[source]}
    </Badge>
  );
}
