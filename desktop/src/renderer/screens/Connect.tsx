import { useState } from 'react';
import { agent, type AgentStatus } from '../agent';
import { Button, Card, CardDescription, CardTitle } from '../components/ui';

/**
 * First run. US-INT-07's acceptance criterion in one screen: the agent shows a code, opens the
 * dashboard in the user's own browser, and waits. It cannot enroll itself — the claim endpoint
 * requires a logged-in session on the other side.
 */
export function Connect({ status }: { status: AgentStatus }) {
  const [name, setName] = useState(status.deviceName);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    setError(null);
    try {
      const result = await agent.startPairing(name);
      setCode(result.code);
    } catch {
      setError('Could not reach MemoryOS. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 py-10">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground font-display text-lg text-background">
          M
        </div>
        <h1 className="font-display text-2xl">Connect this computer</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The agent watches only the folders you turn on, and everything it finds becomes a
          suggestion you approve — never a saved memory on its own.
        </p>
      </div>

      <Card>
        {code ? (
          <div className="flex flex-col gap-3 text-center">
            <CardTitle>Confirm in your browser</CardTitle>
            <CardDescription>
              We opened MemoryOS in your browser. Check that this code matches, then choose Connect
              there.
            </CardDescription>
            <p className="mono-tag my-2 text-3xl tracking-[0.3em]">{code}</p>
            <Button variant="ghost" onClick={() => void agent.cancelPairing().then(() => setCode(null))}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="device-name">
              Name this computer
            </label>
            <input
              id="device-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            />
            <p className="text-xs text-muted-foreground">
              This is how the device appears in Settings &rsaquo; Devices, where you can disconnect
              it at any time.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button disabled={pending || !name.trim()} onClick={() => void connect()}>
              {pending ? 'Starting…' : 'Connect'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
