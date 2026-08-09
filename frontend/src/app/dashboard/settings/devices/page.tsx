"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const PLATFORM_LABEL: Record<string, string> = { darwin: "macOS", win32: "Windows" };

// The one dashboard-side, session-authenticated step in desktop pairing
// (docs/Phase13_DesktopAgent_Implementation_Plan.md §6.3), and the whole of US-INT-07's
// "explicit, visible authorization step (no silent background enrollment)". The agent opens this
// URL in the system browser; nothing is claimed until this button is clicked.
function DesktopPairingBanner() {
  const searchParams = useSearchParams();
  const code = searchParams.get("pair");
  const deviceName = searchParams.get("name") ?? "This computer";
  const platform = searchParams.get("platform") ?? "";
  const appVersion = searchParams.get("version") ?? undefined;
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  const claim = useMutation({
    mutationFn: () => api.claimDesktopPairing({ code: code!, deviceName, platform, appVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["desktop-devices"] });
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });

  if (!code || dismissed) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent">
          <Laptop className="h-4 w-4 text-accent-foreground" />
        </div>
        <div>
          <CardTitle className="text-base">Connect &quot;{deviceName}&quot;?</CardTitle>
          <CardDescription>
            This desktop agent will be able to suggest memories from the coding sessions you point it
            at, and read context — never manage your API keys, billing, or account. You still approve
            every suggestion before it&apos;s saved.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {claim.isError && <Alert variant="destructive">This pairing code is invalid or has expired.</Alert>}
        {claim.isSuccess ? (
          <p className="text-sm text-success">Connected — you can close this tab and return to the app.</p>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDismissed(true)}>
              Cancel
            </Button>
            <Button disabled={claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DisconnectDialog({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const revoke = useMutation({
    mutationFn: () => api.revokeDesktopDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["desktop-devices"] });
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Unplug className="h-4 w-4" />
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect &quot;{name}&quot;?</DialogTitle>
          <DialogDescription>
            The agent on that computer stops capturing immediately and will ask to be connected again.
            Memories it already saved are kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            {revoke.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DevicesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["desktop-devices"], queryFn: api.desktopDevices });
  const devices = data?.devices ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <DesktopPairingBanner />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle>Desktop agents</CardTitle>
          <CardDescription>
            Computers running the MemoryOS desktop app. Each one only watches the folders you turn on
            in the app itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && devices.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No desktop agents connected. Install the app on your Mac or PC and choose Connect.
            </p>
          )}
          <div className="flex flex-col divide-y divide-border">
            {devices.map((device) => (
              <div key={device.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{device.name}</p>
                    {device.revoked && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Disconnected
                      </Badge>
                    )}
                  </div>
                  <p className="mono-tag text-xs text-muted-foreground">
                    {PLATFORM_LABEL[device.platform] ?? device.platform}
                    {device.osVersion ? ` ${device.osVersion}` : ""}
                    {device.appVersion ? ` · app ${device.appVersion}` : ""}
                    {device.lastSeenAt
                      ? ` · last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                      : " · never checked in"}
                  </p>
                </div>
                {!device.revoked && <DisconnectDialog id={device.id} name={device.name} />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
