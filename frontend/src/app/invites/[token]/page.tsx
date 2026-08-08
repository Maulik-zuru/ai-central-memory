"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useSession();
  const [attempted, setAttempted] = useState(false);

  const accept = useMutation({ mutationFn: () => api.acceptInvite(token) });

  useEffect(() => {
    if (isLoading || attempted) return;
    if (!isAuthenticated) {
      router.replace(`/login?next=/invites/${token}`);
      return;
    }
    setAttempted(true);
    accept.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Bucket invite</CardTitle>
          <CardDescription>
            {accept.isSuccess
              ? "You're in — this bucket's memories are now in your notebook."
              : "Joining the shared bucket…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {accept.isError && (
            <Alert variant="destructive">
              {accept.error instanceof ApiError ? accept.error.message : "This invite couldn't be accepted."}
            </Alert>
          )}
          {accept.isSuccess && (
            <Button onClick={() => router.push("/dashboard/memories")}>Go to your memories</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
