import { useState } from 'react';
import { agent, type AgentStatus } from '../agent';
import { Button, Card, CardDescription, CardTitle, Toggle } from '../components/ui';

const SAMPLE = 'export OPENAI_API_KEY=sk-abc123def456\nWe decided to ship the migration on Tuesday.';

export function Settings({ status }: { status: AgentStatus }) {
  const [name, setName] = useState(status.deviceName);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">This computer&rsquo;s agent, and what it does.</p>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Capture</CardTitle>
            <CardDescription>
              Pauses everything at once, without disconnecting. Also available from the menu bar.
            </CardDescription>
          </div>
          <Toggle
            label="Capture enabled"
            checked={status.captureEnabled}
            onChange={(next) => void agent.setCaptureEnabled(next)}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>Device name</CardTitle>
        <CardDescription>How this computer appears in your account&rsquo;s device list.</CardDescription>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
          />
          <Button variant="outline" onClick={() => void agent.setDeviceName(name)}>
            Save
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Redaction</CardTitle>
        <CardDescription>
          Credential-shaped text is stripped before anything leaves this computer. It catches the
          usual shapes — API keys, tokens, passwords, private keys — but it cannot catch a secret
          written as ordinary prose.
        </CardDescription>
        <div className="mt-3 flex flex-col gap-2">
          <Button
            variant="outline"
            className="self-start"
            onClick={() => void agent.previewRedaction(SAMPLE).then(setPreview)}
          >
            Show me an example
          </Button>
          {preview && <pre className="mono-tag overflow-x-auto rounded-lg bg-muted p-3 text-xs">{preview}</pre>}
        </div>
      </Card>

      <Card>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          Per-platform capture settings, your memories, and the device list all live in the
          dashboard.
        </CardDescription>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={() => void agent.openDashboard('/dashboard/settings/privacy')}>
            Open privacy settings
          </Button>
          <Button variant="destructive" onClick={() => void agent.disconnect()}>
            Disconnect this computer
          </Button>
        </div>
      </Card>

      <p className="mono-tag text-xs text-muted-foreground">Version {status.appVersion}</p>
    </div>
  );
}
