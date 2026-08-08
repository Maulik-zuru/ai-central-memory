export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground font-display text-lg text-background">
          M
        </div>
        <span className="font-display text-xl tracking-tight">MemoryOS</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
