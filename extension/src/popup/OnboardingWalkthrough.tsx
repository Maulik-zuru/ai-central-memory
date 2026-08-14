import { useState } from "react";
import { sendToBackground } from "../lib/messages";

// US-INT-01 AC: "walkthrough covers activation, saving a memory, and syncing chat history; it can
// be replayed later from settings." Three steps, one per covered topic — kept intentionally short
// since this renders inside the extension's small popup, not a full page.
const STEPS = [
  {
    title: "You're connected",
    body: "The floating button on any supported AI site opens Quick Inject — one click sends your selected bucket's memories into the chat, so you never have to retype context.",
  },
  {
    title: "Save a memory",
    body: "Select any text in a chat and a “Save to Memory” button appears. The AI can also propose memories on its own — you'll always see a suggestion to approve before anything is saved.",
  },
  {
    title: "Sync your chat history",
    body: "Import past conversations from the dashboard's Chat History page. Re-importing the same export is always safe — nothing is ever duplicated.",
  },
] as const;

export function OnboardingWalkthrough({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;

  async function finish() {
    await sendToBackground({ type: "DISMISS_ONBOARDING" });
    onDone();
  }

  const current = STEPS[step];

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {STEPS.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-[var(--primary)]" : "bg-[var(--secondary)]"}`}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className="font-serif text-base">{current.title}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{current.body}</p>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={finish}
          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Skip
        </button>
        <button
          onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
          className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-[var(--primary-foreground)]"
        >
          {isLast ? "Got it" : "Next"}
        </button>
      </div>
    </div>
  );
}
