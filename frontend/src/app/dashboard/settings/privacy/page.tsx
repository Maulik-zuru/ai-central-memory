"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DataExportCard } from "@/components/settings/data-export-card";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";

// These keys are the `platform` value each client sends to /api/capture, so they are the exact
// strings the server checks — one list, no translation layer that could drift. Phase 13 split the
// old catch-all "cursor" row into the three sources the desktop agent can actually watch.
const BROWSER_PLATFORMS = [
  { key: "chatgpt", label: "ChatGPT" },
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
];

const DESKTOP_PLATFORMS = [
  { key: "claude-code", label: "Claude Code" },
  { key: "cursor", label: "Cursor" },
  { key: "codex", label: "Codex" },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function PrivacyPage() {
  const { data } = useQuery({ queryKey: ["account", "me"], queryFn: api.me });
  const queryClient = useQueryClient();
  const account = data?.account;

  const update = useMutation({
    mutationFn: api.updateAutoCapture,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", "me"] }),
  });

  if (!account) return null;

  function setPlatform(platform: string, enabled: boolean) {
    update.mutate({ ...account!.autoCapture, [platform]: enabled });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Automatic capture</CardTitle>
          <CardDescription>
            Choose which platforms are allowed to suggest memories automatically. You always approve a
            suggestion before it&apos;s saved — this only controls whether suggestions happen at all.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col divide-y divide-border">
            <p className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Browser extension
            </p>
            {BROWSER_PLATFORMS.map((platform) => {
              const enabled = account.autoCapture[platform.key] ?? true;
              return (
                <div key={platform.key} className="flex items-center justify-between py-3">
                  <Label className="font-normal">{platform.label}</Label>
                  <Toggle checked={enabled} onChange={(v) => setPlatform(platform.key, v)} />
                </div>
              );
            })}
          </div>
          <div className="flex flex-col divide-y divide-border">
            <p className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Desktop agent
            </p>
            {DESKTOP_PLATFORMS.map((platform) => {
              const enabled = account.autoCapture[platform.key] ?? true;
              return (
                <div key={platform.key} className="flex items-center justify-between py-3">
                  <Label className="font-normal">{platform.label}</Label>
                  <Toggle checked={enabled} onChange={(v) => setPlatform(platform.key, v)} />
                </div>
              );
            })}
            <p className="pt-3 text-xs text-muted-foreground">
              These apply to any computer running the desktop agent. The agent also has its own
              per-folder controls — both have to be on for anything to be captured.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data handling</CardTitle>
          <CardDescription>How your content is stored and what it is never used for.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">Encrypted in transit and at rest</p>
            <p className="text-muted-foreground">
              All API traffic runs over TLS, and database connections require SSL outside local
              development. Uploaded files and database storage are encrypted at the infrastructure
              layer.
            </p>
          </div>
          <div>
            <p className="font-medium">Never used to train a model</p>
            <p className="text-muted-foreground">
              Content sent to our language-model provider runs under a zero-retention, no-training
              configuration. We do not fine-tune on your data on any plan.
            </p>
          </div>
          <div>
            <p className="font-medium">Never sold, and never in analytics</p>
            <p className="text-muted-foreground">
              Usage analytics record counts and timings only — never the text of a memory,
              conversation, or file. Nothing is sold or shared with advertisers.
            </p>
          </div>
        </CardContent>
      </Card>

      <DataExportCard />
      <DeleteAccountCard />
    </div>
  );
}
