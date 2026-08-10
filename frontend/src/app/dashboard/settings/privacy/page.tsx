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

// Fixed pixel geometry via inline style rather than Tailwind's spacing-scale utilities (w-11,
// translate-x-5, etc.) — this control is small enough that any scale mismatch between the track,
// thumb, and translate distance is immediately visible as the thumb clipping the track's edge.
// Explicit numbers keep the 2px margin provable at a glance instead of derived from three
// separate utility classes that all have to agree.
const TOGGLE_TRACK_WIDTH = 40;
const TOGGLE_TRACK_HEIGHT = 22;
const TOGGLE_THUMB_SIZE = 18;
const TOGGLE_INSET = 2;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ width: TOGGLE_TRACK_WIDTH, height: TOGGLE_TRACK_HEIGHT }}
      className={`relative shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        style={{
          width: TOGGLE_THUMB_SIZE,
          height: TOGGLE_THUMB_SIZE,
          top: TOGGLE_INSET,
          left: TOGGLE_INSET,
          transform: checked
            ? `translateX(${TOGGLE_TRACK_WIDTH - TOGGLE_THUMB_SIZE - TOGGLE_INSET * 2}px)`
            : "translateX(0)",
        }}
        className="absolute rounded-full bg-card shadow transition-transform"
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
