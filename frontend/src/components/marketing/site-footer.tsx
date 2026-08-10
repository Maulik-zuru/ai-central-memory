import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#integrations", label: "Integrations" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/register", label: "Create account" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-14 sm:px-6 md:flex-row md:justify-between">
        <div className="max-w-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground font-display text-sm text-background">
              M
            </div>
            <span className="font-marker text-lg tracking-tight">MemoryOS</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            One memory, every AI you use. Your notebook follows you from ChatGPT to Claude to
            Cursor, never retyped, never lost.
          </p>
        </div>

        <div className="flex gap-12">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-medium text-foreground">{col.title}</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-muted-foreground hover:text-foreground">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col-reverse gap-3 border-t border-border/70 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>&copy; {new Date().getFullYear()} MemoryOS. All memories stay yours.</p>
        <span className="mono-tag inline-flex -rotate-1 items-center rounded-full bg-note-green px-2.5 py-1 text-[11px] text-note-green-foreground">
          Encrypted in transit and at rest
        </span>
      </div>
    </footer>
  );
}
