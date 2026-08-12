"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

const SCOPE_LABELS: Record<string, string> = {
  "memories:read": "Read your memories",
  "memories:write": "Create and edit memories",
  "chat-history:read": "Read your chat history",
  "files:read": "Read your uploaded files",
};

// Phase 16 (US-INT-03b): the human half of an MCP client's OAuth flow — reached when
// mcp-oauth.provider.ts's authorize() redirects here after a client (Claude Desktop, Cursor, …)
// starts connecting. This is a real consent decision, not a status page, so it does nothing
// automatically: the request id identifies what's pending, and only an explicit Approve/Deny
// click resolves it, matching the review-before-commit pattern this product uses everywhere else
// an AI-adjacent action needs a human in the loop.
export default function McpAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <McpAuthorizeScreen />
    </Suspense>
  );
}

function McpAuthorizeScreen() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request") ?? "";
  const router = useRouter();
  const { isLoading, isAuthenticated } = useSession();
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    router.replace(`/login?next=${encodeURIComponent(`/mcp/authorize?request=${requestId}`)}`);
  }, [isLoading, isAuthenticated, requestId, router]);

  const info = useQuery({
    queryKey: ["mcp-consent", requestId],
    queryFn: () => api.mcpConsent(requestId),
    enabled: isAuthenticated && Boolean(requestId),
    retry: false,
  });

  const approve = useMutation({
    mutationFn: () => api.approveMcpConsent(requestId),
    onSuccess: (result) => {
      setDecided(true);
      window.location.href = result.redirectUrl;
    },
  });
  const deny = useMutation({
    mutationFn: () => api.denyMcpConsent(requestId),
    onSuccess: (result) => {
      setDecided(true);
      window.location.href = result.redirectUrl;
    },
  });

  if (!requestId) {
    return <CenteredCard title="Missing request" description="This link is missing its connection request. Ask the app you were connecting to try again." />;
  }
  if (isLoading || !isAuthenticated) return null;
  if (info.isError) {
    return (
      <CenteredCard title="Connection request not found">
        <Alert variant="destructive">
          {info.error instanceof ApiError ? info.error.message : "This connection request has expired or was already used."}
        </Alert>
      </CenteredCard>
    );
  }
  if (!info.data) return null;

  return (
    <CenteredCard
      title={`Connect ${info.data.clientName}`}
      description={`${info.data.clientName} wants to access your MemoryOS account. Only approve this if you just started connecting it yourself.`}
    >
      <ul className="flex flex-col gap-1.5 text-sm">
        {info.data.scopes.length === 0 ? (
          <li className="text-muted-foreground">No specific permissions requested.</li>
        ) : (
          info.data.scopes.map((scope) => (
            <li key={scope} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {SCOPE_LABELS[scope] ?? scope}
            </li>
          ))
        )}
      </ul>
      {(approve.isError || deny.isError) && (
        <Alert variant="destructive">Something went wrong completing this request. Try again.</Alert>
      )}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={decided || deny.isPending} onClick={() => deny.mutate()}>
          Deny
        </Button>
        <Button className="flex-1" disabled={decided || approve.isPending} onClick={() => approve.mutate()}>
          {approve.isPending ? "Connecting…" : "Approve"}
        </Button>
      </div>
    </CenteredCard>
  );
}

function CenteredCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        {children && <CardContent className="flex flex-col gap-4">{children}</CardContent>}
      </Card>
    </div>
  );
}
