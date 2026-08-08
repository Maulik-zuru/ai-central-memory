"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/settings", label: "Account" },
  { href: "/dashboard/settings/api-keys", label: "API Keys" },
  { href: "/dashboard/settings/sessions", label: "Sessions" },
  { href: "/dashboard/settings/privacy", label: "Privacy" },
  { href: "/dashboard/settings/smart-memory", label: "Smart Memory" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex max-w-3xl flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account, API access, sessions, and privacy.</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              pathname === tab.href
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
