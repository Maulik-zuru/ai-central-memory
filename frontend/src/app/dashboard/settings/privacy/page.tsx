"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

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
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Encrypted in transit and at rest.</p>
          <p>Never used to train any model, never sold to a third party.</p>
          <p>Full technical verification of these guarantees lands with the Security &amp; Compliance phase.</p>
        </CardContent>
      </Card>
    </div>
  );
}
