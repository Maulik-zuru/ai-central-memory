"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brain, MessageSquare, FileText, Sparkles, Settings, Network } from "lucide-react";
import { useSession } from "@/lib/use-session";
import { NavItem } from "@/components/dashboard/nav-item";
import { AccountMenu } from "@/components/dashboard/account-menu";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import { OnboardingTour } from "@/components/dashboard/onboarding-tour";
import { BucketNav } from "@/components/bucket/bucket-nav";

const NAV_ITEMS = [
  { href: "/dashboard/chat-history", icon: MessageSquare, label: "Chat History" },
  { href: "/dashboard/files", icon: FileText, label: "Files" },
  { href: "/dashboard/ask", icon: Sparkles, label: "Ask" },
  { href: "/dashboard/intelligence", icon: Network, label: "Intelligence" },
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
    <div className="flex min-h-[100dvh] flex-col bg-background md:flex-row">
      {/* The 256px sidebar left ~130px of content on a 390px phone (Phase 12 mobile pass), so it
          becomes a horizontally scrollable strip below md rather than a permanent column. */}
      <aside className="flex shrink-0 flex-col border-b border-border bg-card px-3 py-3 md:w-64 md:border-b-0 md:border-r md:py-5">
        <div className="mb-3 flex items-center gap-2.5 px-2 md:mb-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground font-display text-base text-background">
            M
          </div>
          <span className="font-display text-lg tracking-tight">MemoryOS</span>
        </div>
        <nav
          aria-label="Main"
          className="flex flex-1 flex-row gap-0.5 overflow-x-auto md:flex-col md:overflow-x-visible md:overflow-y-auto"
        >
          <NavItem href="/dashboard/memories" icon={Brain} label="Memories" />
          {/* The bucket tree is a vertical structure that doesn't survive a horizontal strip —
              it stays available on the Buckets page itself on small screens. */}
          <div className="hidden md:contents">
            <BucketNav />
            <div className="my-2 h-px bg-border" />
          </div>
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TrialBanner account={account} />
        <header className="flex h-16 items-center justify-between gap-4 border-b border-border px-4 md:px-8">
          <span className="truncate text-sm text-muted-foreground">
            {account.subscription?.plan === "pro" ? "Pro" : "Core"} workspace
          </span>
          <AccountMenu account={account} />
        </header>
        <main className="flex flex-1 flex-col p-4 md:p-8">{children}</main>
        <OnboardingTour account={account} />
      </div>
    </div>
  );
}
