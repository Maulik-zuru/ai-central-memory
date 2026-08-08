"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/use-session";

export default function RootPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useSession();

  useEffect(() => {
    if (!isLoading) router.replace(isAuthenticated ? "/dashboard" : "/login");
  }, [isLoading, isAuthenticated, router]);

  return null;
}
