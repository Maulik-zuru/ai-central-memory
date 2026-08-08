export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          M
        </div>
        <span className="text-lg font-semibold tracking-tight">MemoryOS</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
