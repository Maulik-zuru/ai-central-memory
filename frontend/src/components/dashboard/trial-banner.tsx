import { Pin } from "lucide-react";
import { type Account } from "@/lib/api";

function daysLeft(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// Read-only display of Subscription.plan/trialEndsAt (US-ACC-04). Real limit enforcement and
// upgrade flows are Phase 10 — this banner only has to tell the truth about current state.
// Styled like a taped note pinned to the notebook — the one place the "tape" accent color
// appears, kept deliberately rare so it stays a signal, not wallpaper.
export function TrialBanner({ account }: { account: Account }) {
  const sub = account.subscription;
  if (!sub || sub.status !== "trialing") return null;

  const remaining = daysLeft(sub.trialEndsAt);
  if (remaining === null) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-border bg-tape/15 px-6 py-2 text-center text-sm text-tape-foreground">
      <Pin className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {remaining > 0
        ? `${remaining} day${remaining === 1 ? "" : "s"} left in your Core trial.`
        : "Your trial has ended."}
    </div>
  );
}
