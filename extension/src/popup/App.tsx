import { useEffect, useState } from "react";
import { sendToBackground } from "../lib/messages";
import { ConnectScreen } from "./ConnectScreen";
import { Panel } from "./Panel";
import { OnboardingWalkthrough } from "./OnboardingWalkthrough";

export function App() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  async function refresh() {
    const { connected } = await sendToBackground<{ connected: boolean }>({ type: "GET_CONNECTION_STATE" });
    setConnected(connected);
    if (connected) {
      const { pending } = await sendToBackground<{ pending: boolean }>({ type: "GET_ONBOARDING_STATE" });
      setShowOnboarding(pending);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (connected === null) return <div className="p-6 text-sm text-[var(--muted-foreground)]">Loading…</div>;

  if (connected && showOnboarding) {
    return <OnboardingWalkthrough onDone={() => setShowOnboarding(false)} />;
  }

  return connected ? (
    <Panel
      onDisconnect={async () => {
        await sendToBackground({ type: "DISCONNECT" });
        setConnected(false);
      }}
      onReplayOnboarding={() => setShowOnboarding(true)}
    />
  ) : (
    // Re-run the full refresh rather than just flipping `connected` locally, so a fresh pairing
    // picks up the onboardingPending flag set on install (background/index.ts) in the same tick
    // instead of only after the popup happens to reopen.
    <ConnectScreen onConnected={() => refresh()} />
  );
}
