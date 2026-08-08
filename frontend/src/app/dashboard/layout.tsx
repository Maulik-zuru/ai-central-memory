"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brain, MessageSquare, FileText, Sparkles, Settings } from "lucide-react";
import { useSession } from "@/lib/use-session";
import { NavItem } from "@/components/dashboard/nav-item";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import { BucketNav } from "@/components/bucket/bucket-nav";

const NAV_ITEMS = [
  { href: "/dashboard/chat-history", icon: MessageSquare, label: "Chat History" },
  { href: "/dashboard/files", icon: FileText, label: "Files" },
  { href: "/dashboard/ask", icon: Sparkles, label: "Ask" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoading, isAuthenticated, account } = useSession();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated || !account) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your dashboard…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-64 flex-col border-r border-border bg-card px-3 py-5">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground font-display text-base text-background">
            M
          </div>
          <span className="font-display text-lg tracking-tight">MemoryOS</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          <NavItem href="/dashboard/memories" icon={Brain} label="Memories" />
          <BucketNav />
          <div className="my-2 h-px bg-border" />
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <TrialBanner account={account} />
        <header className="flex h-16 items-center justify-between border-b border-border px-8">
          <span className="text-sm text-muted-foreground">
            {account.subscription?.plan === "pro" ? "Pro" : "Core"} workspace
          </span>
          <AccountMenu account={account} />
        </header>
        <main className="flex flex-1 flex-col p-8">{children}</main>
      </div>
    </div>
  );
}
