"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LockedCard } from "@/components/intelligence/locked-card";
import { UsageStats } from "@/components/intelligence/usage-stats";
import { GraphExplorer } from "@/components/intelligence/graph-explorer";

export default function IntelligencePage() {
  const { account } = useSession();
  const isPro = account?.subscription?.plan === "pro";

  const graph = useQuery({ queryKey: ["intelligence-graph"], queryFn: () => api.knowledgeGraph(), enabled: isPro });
  const usage = useQuery({ queryKey: ["intelligence-usage"], queryFn: () => api.usageSummary(), enabled: isPro });
  const insight = useQuery({ queryKey: ["intelligence-insight"], queryFn: () => api.intelligenceInsight(), enabled: isPro });

  if (!isPro) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-2xl">Intelligence</h1>
        <LockedCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl">Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Connections across your memories and conversations, plus how much you're getting out of MemoryOS.
        </p>
      </div>

      {usage.data && <UsageStats usage={usage.data.usage} />}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Monthly insights</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{insight.data?.insight.month}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {insight.data?.insight.summary ?? "Not enough activity yet this month to generate a digest."}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Knowledge graph</h2>
        {graph.data && <GraphExplorer graph={graph.data} />}
      </div>
    </div>
  );
}
