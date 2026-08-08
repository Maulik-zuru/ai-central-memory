import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type UsageSummary } from "@/lib/api";

const STATS: { key: keyof UsageSummary; label: string }[] = [
  { key: "memoriesCreated", label: "Memories created" },
  { key: "askQueries", label: "Ask queries" },
  { key: "syncsCompleted", label: "Conversations synced" },
  { key: "tokensSaved", label: "Tokens saved" },
];

// Every number sourced directly from UsageAnalyticsSummary — no placeholder/estimated figure
// rendered as if exact (US-ADV-03's AC).
export function UsageStats({ usage }: { usage: UsageSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {STATS.map((stat) => (
        <Card key={stat.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl">{usage[stat.key]}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
