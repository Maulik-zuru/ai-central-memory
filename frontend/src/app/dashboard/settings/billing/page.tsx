"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function daysLeft(iso: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function BillingSettingsPage() {
  const { data: summary } = useQuery({ queryKey: ["billing-summary"], queryFn: api.billingSummary });
  const [pending, setPending] = useState<"checkout" | "portal" | null>(null);

  async function goToCheckout() {
    setPending("checkout");
    try {
      const { url } = await api.createCheckoutSession("pro");
      window.location.href = url;
    } finally {
      setPending(null);
    }
  }

  async function goToPortal() {
    setPending("portal");
    try {
      const { url } = await api.createBillingPortalSession();
      window.location.href = url;
    } finally {
      setPending(null);
    }
  }

  if (!summary) return null;

  // The tab is hidden when payments are off, but the route still resolves if someone lands on it
  // from a bookmark or a stale link. Say so plainly rather than rendering a plan card for a plan
  // that doesn't exist.
  if (!summary.paymentsEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No billing on this instance</CardTitle>
          <CardDescription>
            This instance of MemoryOS runs free. Every feature is available on your account, there
            are no usage limits, and there is nothing to pay for.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Conversations stored</span>
          <span>{summary.history.count}</span>
        </CardContent>
      </Card>
    );
  }

  const isPro = summary.plan === "pro";
  const remaining = daysLeft(summary.trialEndsAt);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Your current subscription.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="capitalize">{summary.plan} plan</span>
            <Badge variant={summary.status === "expired" ? "destructive" : "secondary"} className="capitalize">
              {summary.status}
            </Badge>
          </div>
          {summary.status === "trialing" && remaining !== null && (
            <p className="text-muted-foreground">
              {remaining > 0 ? `${remaining} day${remaining === 1 ? "" : "s"} left in your trial.` : "Your trial has ended."}
            </p>
          )}
          {isPro ? (
            <Button size="sm" variant="outline" onClick={goToPortal} disabled={pending !== null} className="self-start">
              {pending === "portal" ? "Redirecting…" : "Manage subscription"}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={goToCheckout} disabled={pending !== null}>
                {pending === "checkout" ? "Redirecting…" : "Upgrade to Pro"}
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/pricing">Compare plans</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>What you've used this month.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Conversation history</span>
            <span>
              {summary.history.count}
              {summary.history.limit !== null ? ` / ${summary.history.limit}` : " (unlimited)"}
            </span>
          </div>
          {summary.history.limit !== null && summary.history.count >= summary.history.limit * 0.9 && (
            <p className="rounded-lg border border-tape/40 bg-tape/10 px-3 py-2 text-xs text-tape-foreground">
              You're approaching the {summary.history.limit}-conversation Core plan limit. Upgrade to Pro for
              unlimited history.
            </p>
          )}
          {summary.usage && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Memories created</span>
                <span>{summary.usage.memoriesCreated}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Ask queries</span>
                <span>{summary.usage.askQueries}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tokens saved</span>
                <span>{summary.usage.tokensSaved}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
