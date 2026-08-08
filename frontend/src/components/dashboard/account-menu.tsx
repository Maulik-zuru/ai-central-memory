"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { api, type Account } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";

export function AccountMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      clear();
      queryClient.clear();
      router.push("/login");
    },
  });

  const initial = account.email.charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-border/60 bg-card p-1 shadow-[var(--shadow-raised)]">
          <div className="px-3 py-2 text-sm">
            <p className="truncate font-medium">{account.email}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{account.subscription?.plan ?? "core"} plan</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      )}
    </div>
  );
}
