import { useEffect, useRef, useState } from "react";
import { sendToBackground } from "../lib/messages";
import { API_BASE_URL } from "../lib/config";

// US-INT-01/pairing: the user never sees or types a raw API key. Clicking Connect opens the
// dashboard's pairing-claim tab (an explicit, visible authorization click there) while this
// popup polls for the code to be claimed.
export function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [status, setStatus] = useState<"idle" | "waiting" | "error">("idle");
  const codeRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function connect() {
    setStatus("waiting");
    try {
      const { code } = await sendToBackground<{ code: string }>({ type: "PAIRING_START" });
      codeRef.current = code;
      chrome.tabs.create({ url: `${API_BASE_URL.replace("http://localhost:4000", "http://localhost:3000")}/dashboard/settings/api-keys?pair=${code}` });

      pollRef.current = setInterval(async () => {
        const result = await sendToBackground<{ status: string }>({ type: "PAIRING_POLL", code: codeRef.current! });
        if (result.status === "claimed") {
          if (pollRef.current) clearInterval(pollRef.current);
          onConnected();
        } else if (result.status === "expired") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("error");
        }
      }, 2000);
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
