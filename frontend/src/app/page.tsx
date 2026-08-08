// proxy.ts intercepts "/" before this ever renders (redirecting to /dashboard or /login based on
// the optimistic session-cookie check). This is just the fallback shown for the instant between
// request and redirect, or if proxy.ts is ever bypassed.
export default function RootPage() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Redirecting…
    </div>
  );
}
