"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DataExportCard } from "@/components/settings/data-export-card";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";

const PLATFORMS = [
  { key: "chatgpt", label: "ChatGPT" },
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
  { key: "cursor", label: "Cursor / Claude Code" },
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
        <CardContent className="flex flex-col divide-y divide-border">
          {PLATFORMS.map((platform) => {
            const enabled = account.autoCapture[platform.key] ?? true;
            return (
              <div key={platform.key} className="flex items-center justify-between py-3">
                <Label className="font-normal">{platform.label}</Label>
                <Toggle checked={enabled} onChange={(v) => setPlatform(platform.key, v)} />
              </div>
            );
          })}
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
