"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

// Phase 9 shipped this as a static "Upgrade to Pro" card (docs/Phase9_Implementation_Plan.md
// §6.2); Phase 10 wires that same shape to a real checkout session instead of rebuilding it.
export function LockedCard() {
  const [pending, setPending] = useState(false);

  async function upgrade() {
    setPending(true);
    try {
      const { url } = await api.createCheckoutSession("pro");
      window.location.href = url;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
        <Lock className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
      </div>
      <h2 className="text-xl">Intelligence is a Pro feature</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Upgrade to Pro to explore your knowledge graph and see a monthly usage and insights digest.
      </p>
      <Button size="sm" className="mt-1" onClick={upgrade} disabled={pending}>
        {pending ? "Redirecting…" : "Upgrade to Pro"}
      </Button>
    </div>
  );
}
