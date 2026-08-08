import Link from "next/link";
import { Pin } from "lucide-react";
import { type Account } from "@/lib/api";

function daysLeft(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// US-ACC-04 + Phase 10's follow-through: reflects the trial-expiry job's real `status: 'expired'`
// transition, not just a days-remaining count that goes stale once the trial actually ends, and
// links to a real upgrade path instead of only stating the countdown.
// Styled like a taped note pinned to the notebook — the one place the "tape" accent color
// appears, kept deliberately rare so it stays a signal, not wallpaper.
export function TrialBanner({ account }: { account: Account }) {
  const sub = account.subscription;
  if (!sub || sub.plan === "pro") return null;
  if (sub.status !== "trialing" && sub.status !== "expired") return null;

  const remaining = daysLeft(sub.trialEndsAt);
  const message =
    sub.status === "expired"
      ? "Your trial has ended."
      : remaining !== null && remaining > 0
        ? `${remaining} day${remaining === 1 ? "" : "s"} left in your Core trial.`
        : null;
  if (!message) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-border bg-tape/15 px-6 py-2 text-center text-sm text-tape-foreground">
      <Pin className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {message}
      <Link href="/pricing" className="font-medium underline underline-offset-2">
        Upgrade to Pro
      </Link>
    </div>
  );
}
