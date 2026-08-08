"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { refreshSession } from "./api-client";
import { useAuthStore } from "./auth-store";

// On first mount there's no access token in memory yet (a full page load always starts empty) —
// silently trade the httpOnly refresh cookie for a new one before the first /account/me call.
export function useSession() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (accessToken) {
      setBootstrapped(true);
      return;
    }
    refreshSession().finally(() => setBootstrapped(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useQuery({
    queryKey: ["account", "me"],
    queryFn: api.me,
    enabled: bootstrapped,
    retry: false,
  });

  return {
    isLoading: !bootstrapped || query.isLoading,
    isAuthenticated: bootstrapped && !query.isError && Boolean(query.data),
    account: query.data?.account,
    refetch: query.refetch,
  };
}
