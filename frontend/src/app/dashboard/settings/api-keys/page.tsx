"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import { api, type ApiKey } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.createApiKey(name),
    onSuccess: (data) => {
      setCreatedKey(data.apiKey.key);
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
    },
  });

  function reset() {
    setName("");
    setCreatedKey(null);
    setCopied(false);
    mutation.reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>Key created</DialogTitle>
              <DialogDescription>Copy it now — you won&apos;t be able to see it again.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-3">
              <code className="mono-tag flex-1 overflow-x-auto text-xs">{createdKey}</code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(createdKey);
                  setCopied(true);
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {copied && <p className="mt-2 text-xs text-success">Copied to clipboard.</p>}
            <DialogFooter>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create a new API key</DialogTitle>
              <DialogDescription>Name it after where it&apos;ll be used, e.g. &quot;Cursor MCP&quot;.</DialogDescription>
            </DialogHeader>
            {mutation.isError && <Alert variant="destructive">Could not create the key. Try again.</Alert>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cursor MCP" />
            </div>
            <DialogFooter>
              <Button disabled={!name || mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({ apiKey }: { apiKey: ApiKey }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.revokeApiKey(apiKey.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke &quot;{apiKey.name}&quot;?</DialogTitle>
          <DialogDescription>
            Any integration using this key will stop working immediately. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const { data, isLoading } = useQuery({ queryKey: ["apiKeys"], queryFn: api.apiKeys });
  const keys = data?.apiKeys ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>API keys</CardTitle>
          <CardDescription>Use these to authenticate MCP clients, scripts, or your own integrations.</CardDescription>
        </div>
        <CreateKeyDialog />
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && keys.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to connect an MCP client or script.
          </p>
        )}
        <div className="flex flex-col divide-y divide-border">
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{key.name}</p>
                  {key.revoked && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Revoked
                    </Badge>
                  )}
                </div>
                <p className="mono-tag text-xs text-muted-foreground">
                  {key.preview} · created {new Date(key.createdAt).toLocaleDateString()}
                  {key.lastUsedAt ? ` · last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : " · never used"}
                </p>
              </div>
              {!key.revoked && <RevokeKeyDialog apiKey={key} />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
