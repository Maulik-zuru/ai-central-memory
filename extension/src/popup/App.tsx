import { useEffect, useState } from "react";
import { sendToBackground } from "../lib/messages";
import { ConnectScreen } from "./ConnectScreen";
import { Panel } from "./Panel";

export function App() {
  const [connected, setConnected] = useState<boolean | null>(null);

  async function refresh() {
    const { connected } = await sendToBackground<{ connected: boolean }>({ type: "GET_CONNECTION_STATE" });
    setConnected(connected);
  }

  useEffect(() => {
    refresh();
  }, []);

  if (connected === null) return <div className="p-6 text-sm text-[var(--muted-foreground)]">Loading…</div>;

  return connected ? (
    <Panel
      onDisconnect={async () => {
        await sendToBackground({ type: "DISCONNECT" });
        setConnected(false);
      }}
    />
  ) : (
    <ConnectScreen onConnected={() => setConnected(true)} />
  );
}
