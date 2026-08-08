"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AccountSettingsPage() {
  const { data } = useQuery({ queryKey: ["account", "me"], queryFn: api.me });
  const account = data?.account;
  if (!account) return null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account details.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{account.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Password</span>
            <Badge variant={account.hasPassword ? "secondary" : "outline"}>
              {account.hasPassword ? "Set" : "Not set (Google only)"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Google account</span>
            <Badge variant={account.googleLinked ? "success" : "outline"}>
              {account.googleLinked ? "Linked" : "Not linked"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Member since</span>
            <span className="mono-tag text-xs text-muted-foreground">
              {new Date(account.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Current subscription status.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span className="capitalize">{account.subscription?.plan ?? "core"} plan</span>
          <Badge variant="secondary" className="capitalize">
            {account.subscription?.status ?? "active"}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>Export and permanent deletion are on the way.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Full data export and account deletion ship with the Security &amp; Privacy phase — coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
