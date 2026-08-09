"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { PLAN_FEATURES } from "@/lib/plan-features";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// US-BIL-01's AC: this table and the actual requirePlan() gates must never disagree — both read
// from PLAN_FEATURES, the same list the backend's retrofit table mirrors
// (docs/Phase10_Implementation_Plan.md §3), not hand-maintained copy that could drift.
export default function PricingPage() {
  const { isAuthenticated, account } = useSession();
  const [pending, setPending] = useState(false);
  const isPro = account?.subscription?.plan === "pro";
  // A free deployment has no plans to compare. Rather than 404 a linked-to page, it states the
  // truth: everything is included.
  const paid = account?.paymentsEnabled ?? true;

  async function upgrade() {
    setPending(true);
    try {
      const { url } = await api.createCheckoutSession("pro");
      window.location.href = url;
    } finally {
      setPending(false);
    }
  }

  if (!paid) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground font-display text-base text-background">
          M
        </div>
        <h1 className="font-display text-3xl">Everything is included</h1>
        <p className="text-sm text-muted-foreground">
          This instance of MemoryOS runs free. Every feature — unlimited history, the knowledge
          graph, full Smart Memory tuning, and precise search — is available on every account. There
          is no paid tier and nothing to upgrade.
        </p>
        <ul className="mt-2 grid gap-2 text-left text-sm sm:grid-cols-2">
          {PLAN_FEATURES.map((f) => (
            <li key={f.label} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{f.label}</span>
            </li>
          ))}
        </ul>
        <Button asChild size="sm" className="mt-2">
          <Link href={isAuthenticated ? "/dashboard" : "/register"}>
            {isAuthenticated ? "Back to dashboard" : "Create an account"}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-16">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-foreground font-display text-base text-background">
          M
        </div>
        <h1 className="font-display text-3xl">Simple, honest pricing</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start free. Upgrade when you want unlimited history, full Smart Memory tuning, and the knowledge graph.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Core</CardTitle>
            <p className="text-sm text-muted-foreground">Everything you need to get started.</p>
            <p className="mt-2 font-display text-3xl">Free</p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {PLAN_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2">
                  {f.core === "Not included" ? (
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>
                    <span className="text-muted-foreground">{f.label}:</span> {f.core}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Pro</CardTitle>
            <p className="text-sm text-muted-foreground">For people who live in their second brain.</p>
            <p className="mt-2 font-display text-3xl">$12/mo</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2 text-sm">
              {PLAN_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <span className="text-muted-foreground">{f.label}:</span> {f.pro}
                  </span>
                </li>
              ))}
            </ul>
            {isPro ? (
              <Button disabled size="sm">
                You're on Pro
              </Button>
            ) : isAuthenticated ? (
              <Button size="sm" onClick={upgrade} disabled={pending}>
                {pending ? "Redirecting…" : "Upgrade to Pro"}
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href="/login?next=/pricing">Log in to upgrade</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
