"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SessionsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const revokeOthers = useMutation({
    mutationFn: api.revokeOtherSessions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const sessions = data?.sessions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices and browsers currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="flex flex-col divide-y divide-border">
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{session.userAgent ?? "Unknown device"}</p>
                <p className="mono-tag text-xs text-muted-foreground">
                  {session.ipAddress ?? "unknown ip"} · last active {new Date(session.lastActiveAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
              >
                <LogOut className="h-4 w-4" />
                Revoke
              </Button>
            </div>
          ))}
        </div>

        {sessions.length > 1 && (
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Signed in somewhere you don&apos;t recognise? Sign out everywhere except this device.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-2"
              disabled={revokeOthers.isPending}
              onClick={() => revokeOthers.mutate()}
            >
              <LogOut className="h-4 w-4" />
              {revokeOthers.isPending ? "Signing out…" : "Sign out other devices"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
