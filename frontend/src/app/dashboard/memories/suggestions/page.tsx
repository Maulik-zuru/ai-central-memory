"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CaptureCard, DuplicateCard, StaleCard } from "@/components/memory/suggestion-cards";

export default function SuggestionsPage() {
  const { data } = useQuery({ queryKey: ["suggestions"], queryFn: api.suggestions });
  const suggestions = data?.suggestions ?? [];

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="w-fit gap-1.5 text-muted-foreground">
        <Link href="/dashboard/memories">
          <ArrowLeft className="h-4 w-4" />
          Back to memories
        </Link>
      </Button>

      <div>
        <h1 className="text-xl">Suggestions</h1>
        <p className="text-sm text-muted-foreground">Review what your notebook noticed — approve or dismiss each one.</p>
      </div>

      {suggestions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Sparkles className="h-6 w-6" />
          <p className="text-sm">Nothing pending — your notebook is caught up.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {suggestions.map((suggestion) => {
            if (suggestion.type === "capture") return <CaptureCard key={suggestion.id} suggestion={suggestion} />;
            if (suggestion.type === "duplicate") return <DuplicateCard key={suggestion.id} suggestion={suggestion} />;
            return <StaleCard key={suggestion.id} suggestion={suggestion} />;
          })}
        </div>
      )}
    </div>
  );
}
