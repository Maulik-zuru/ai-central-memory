"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Brain, Sparkles, Puzzle } from "lucide-react";
import { api, type Account } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const STEPS = [
  {
    icon: Brain,
    title: "Save what matters",
    body: "Write a memory yourself, or let the browser extension suggest one from a conversation. Nothing is saved automatically without you approving it first.",
    href: "/dashboard/memories",
    cta: "Go to Memories",
  },
  {
    icon: Sparkles,
    title: "Ask across everything",
    body: "Ask questions against your memories, imported chat history, and uploaded files at once. Every answer cites where it came from.",
    href: "/dashboard/ask",
    cta: "Try Ask",
  },
  {
    icon: Puzzle,
    title: "Connect your AI tools",
    body: "Pair the browser extension from Settings to bring your memory into ChatGPT, Claude, and Gemini without copy-pasting.",
    href: "/dashboard/settings/api-keys",
    cta: "Open Settings",
  },
];

/**
 * First-run tour, shown once (US: Phase 12 onboarding polish). Gated on the server-side
 * `hasSeenTour` flag rather than localStorage so it doesn't reappear on a second device — and
 * dismissed optimistically, because a failed "mark seen" call should never trap someone in a
 * modal they've already read.
 */
export function OnboardingTour({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  // A deep link carries a specific intent the user is mid-way through — the extension and desktop
  // pairing flows land on /dashboard/settings/{api-keys,devices}?pair=<code> and need their consent
  // banner clickable.
  // A welcome modal covering that is worse than useless: it blocks the very task the user came to
  // do, on a brand-new account, which is exactly when this tour would otherwise fire.
  const deepLinkedTask = searchParams.has("pair");
  const [open, setOpen] = useState(!account.hasSeenTour && !deepLinkedTask);
  const [step, setStep] = useState(0);

  const markSeen = useMutation({
    mutationFn: api.markTourSeen,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["account", "me"] }),
  });

  function dismiss() {
    setOpen(false);
    markSeen.mutate();
  }

  if (account.hasSeenTour || deepLinkedTask) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Icon className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
          </div>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>

        <div className="mt-6 flex items-center justify-between">
          {/* The dots are decorative; the step position is announced as text instead. A bare div
              cannot carry aria-label (axe: aria-prohibited-attr), and a progress dot row is not a
              landmark worth inventing a role for. */}
          <div className="flex items-center gap-1.5">
            <span className="sr-only">
              Step {step + 1} of {STEPS.length}
            </span>
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                aria-hidden
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-primary" : "w-1.5 bg-border"}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={dismiss}>
              Skip
            </Button>
            {isLast ? (
              <Button size="sm" className="gap-2" asChild onClick={dismiss}>
                <Link href={current.href}>
                  {current.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button size="sm" className="gap-2" onClick={() => setStep((s) => s + 1)}>
                Next
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
