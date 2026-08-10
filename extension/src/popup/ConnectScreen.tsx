import { useEffect, useRef, useState } from "react";
import { BrainIcon, CheckCircleIcon, LinkSimpleIcon, ShieldCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
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
    <div className="flex flex-col items-center gap-5 px-6 py-9 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)]">
        <BrainIcon size={26} weight="fill" color="var(--primary-foreground)" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-base font-semibold">Connect your account</h1>
        <p className="max-w-[280px] text-xs leading-relaxed text-[var(--muted-foreground)]">
          Sign in on the dashboard tab that opens, then confirm the connection there — you'll never need to copy or
          paste an API key.
        </p>
      </div>

      <div className="flex w-full flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-3 text-left">
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheckIcon size={15} className="shrink-0 text-[var(--success)]" />
          <span>No API key ever touches this popup</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <LinkSimpleIcon size={15} className="shrink-0 text-[var(--success)]" />
          <span>Works across ChatGPT, Claude, and Gemini</span>
        </div>
      </div>

      {status === "error" && (
        <div className="flex w-full items-center gap-2 rounded-[var(--radius-md)] bg-[var(--destructive-foreground)] px-3 py-2 text-left text-xs text-[var(--destructive)]">
          <WarningCircleIcon size={15} weight="fill" className="shrink-0" />
          That didn't work — try connecting again.
        </div>
      )}
      {status === "waiting" && (
        <div className="flex w-full items-center gap-2 rounded-[var(--radius-md)] bg-[var(--primary-tint)] px-3 py-2 text-left text-xs text-[var(--primary)]">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--primary)]" />
          Waiting for confirmation — you can close this popup, it'll finish on its own.
        </div>
      )}

      <button
        onClick={connect}
        disabled={status === "waiting"}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] disabled:opacity-60"
      >
        {status === "waiting" ? (
          "Waiting for confirmation…"
        ) : (
          <>
            <CheckCircleIcon size={15} weight="bold" />
            Connect
          </>
        )}
      </button>
    </div>
  );
}
