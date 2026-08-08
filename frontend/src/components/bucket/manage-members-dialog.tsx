"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ManageMembersDialog({
  bucketId,
  bucketName,
  open,
  onOpenChange,
}: {
  bucketId: string;
  bucketName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ["bucket-members", bucketId],
    queryFn: () => api.bucketMembers(bucketId),
    enabled: open,
  });

  const invite = useMutation({
    mutationFn: () => api.inviteToBucket(bucketId, email, role),
    onSuccess: () => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["bucket-members", bucketId] });
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "editor" | "viewer" }) =>
      api.changeMemberRole(bucketId, userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bucket-members", bucketId] }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(bucketId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bucket-members", bucketId] }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share &quot;{bucketName}&quot;</DialogTitle>
          <DialogDescription>Invite a teammate as an editor or viewer.</DialogDescription>
        </DialogHeader>

        <form
          className="mb-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <div className="flex-1">
            <Label htmlFor="invite-email" className="mb-1.5 block text-xs">
              Email
            </Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
            className="h-10 rounded-lg border border-input bg-card px-2 text-sm"
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <Button type="submit" size="sm" disabled={!email.trim() || invite.isPending}>
            Invite
          </Button>
        </form>

        {invite.isError && (
          <Alert variant="destructive" className="mb-3">
            {invite.error instanceof ApiError ? invite.error.message : "Could not send the invite."}
          </Alert>
        )}

        <div className="flex flex-col divide-y divide-border">
          {members.data?.members.map((member) => (
            <div key={member.userId} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm">{member.email}</p>
                {!member.acceptedAt && (
                  <span className="mono-tag text-[11px] text-muted-foreground">pending invite</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {member.role === "owner" ? (
                  <Badge variant="secondary">Owner</Badge>
                ) : (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) => changeRole.mutate({ userId: member.userId, role: e.target.value as "editor" | "viewer" })}
                      className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(member.userId)}>
                      <UserMinus className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
