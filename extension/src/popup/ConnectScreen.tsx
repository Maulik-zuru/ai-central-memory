import { useEffect, useRef, useState } from "react";
import { sendToBackground } from "../lib/messages";
import { DASHBOARD_URL } from "../lib/config";

// US-INT-01/pairing: the user never sees or types a raw API key. Clicking Connect opens the
// dashboard's pairing-claim tab (an explicit, visible authorization click there).
//
// The actual completion detection does NOT happen here. Chrome closes this popup the instant the
// dashboard tab takes focus, so any polling loop that lived in this component would be torn down
// before it could ever see the pairing complete — the background service worker's `chrome.alarms`
// job is the durable path (background/pairing.ts). This component only ever asks "how's it
// going?" — on mount (in case pairing finished while it was closed) and, best-effort, on a short
// interval for as long as it happens to still be open.
export function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function check() {
    const result = await sendToBackground<{ status: "pending" | "claimed" | "expired" | "none" }>({
      type: "CHECK_PAIRING",
    });
    if (result.status === "claimed") {
      stopPolling();
      onConnected();
    } else if (result.status === "expired") {
      stopPolling();
      setStatus("error");
    } else if (result.status === "pending") {
      setStatus("waiting");
    }
    return result.status;
  }

  useEffect(() => {
    // Covers the case where the user re-opens the popup after already confirming on the dashboard
    // tab — without this, they'd see "Connect" again for up to a minute (the alarm's period)
    // despite pairing having already succeeded.
    void check();
    return stopPolling;
  }, []);

  function startPolling() {
    stopPolling();
    // Best-effort only: on most platforms Chrome closes this popup the moment the dashboard tab
    // below takes focus, tearing this interval down with it. It costs nothing to keep trying for
    // as long as the popup happens to survive (some window managers don't steal focus instantly),
    // but the alarm in the background worker is what actually finishes the job.
    pollRef.current = setInterval(() => void check(), 2000);
  }

  async function connect() {
    setStatus("waiting");
    try {
      const { code } = await sendToBackground<{ code: string }>({ type: "PAIRING_START" });
      chrome.tabs.create({ url: `${DASHBOARD_URL}/dashboard/settings/api-keys?pair=${code}` });
      startPolling();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--secondary)]">
        <span className="font-serif text-lg">M</span>
      </div>
      <h1 className="text-lg font-medium">Connect your account</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        Sign in on the dashboard tab that opens, then confirm the connection there — you'll never need to copy or
        paste an API key.
      </p>
      {status === "error" && (
        <p className="text-sm text-[var(--destructive)]">That didn't work — try connecting again.</p>
      )}
      {status === "waiting" && (
        <p className="text-sm text-[var(--muted-foreground)]">
          Waiting for confirmation — you can close this popup, the connection will finish on its own.
        </p>
      )}
      <button
        onClick={connect}
        disabled={status === "waiting"}
        className="w-full rounded-full bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-60"
      >
        {status === "waiting" ? "Waiting for confirmation…" : "Connect"}
      </button>
    </div>
  );
}
