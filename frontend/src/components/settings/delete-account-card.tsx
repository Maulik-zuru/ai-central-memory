"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CONFIRMATION = "DELETE";

export function DeleteAccountCard() {
  const router = useRouter();
  const clearAuth = useAuthStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Counted from real rows rather than a hardcoded list, so what the user is told matches what the
  // cascade actually removes (US-ACC-06: told what will be deleted before confirming).
  const { data } = useQuery({ queryKey: ["deletion-preview"], queryFn: api.deletionPreview, enabled: open });
  const preview = data?.preview;

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(typed),
    onSuccess: () => {
      clearAuth();
      router.replace("/login");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Deletion failed"),
  });

  const items = preview
    ? [
        { label: "memories", count: preview.memories },
        { label: "buckets", count: preview.buckets },
        { label: "imported conversations", count: preview.conversations },
        { label: "files", count: preview.files },
        { label: "Ask threads", count: preview.askThreads },
        { label: "active API keys", count: preview.apiKeys },
      ]
    : [];

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete account</CardTitle>
        <CardDescription>
          Permanently deletes your account and everything in it. This cannot be undone and there is
          no recovery window.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setTyped("");
              setError(null);
            }
          }}
        >
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
            Delete account
          </Button>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This permanently removes your account and all of its data from our servers, including
                the files you&apos;ve uploaded. It cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {preview && (
              <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
                <p className="mb-1.5 font-medium">This will delete:</p>
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {items.map((item) => (
                    <li key={item.label}>
                      {item.count} {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Label htmlFor="delete-confirmation">
                Type <span className="mono-tag">{CONFIRMATION}</span> to confirm
              </Label>
              <Input
                id="delete-confirmation"
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
                placeholder={CONFIRMATION}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              {/* Cancel stays a first-class, equally reachable action — the friction here is the
                  typed confirmation, not a hard-to-find way out. */}
              <DialogClose asChild>
                <Button variant="outline" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                size="sm"
                disabled={typed !== CONFIRMATION || remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? "Deleting…" : "Permanently delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
