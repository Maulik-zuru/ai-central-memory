import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_ROUTES = ["/login", "/register", "/forgot-password"];

// Optimistic check only (Next.js authentication guide): presence of the refresh-token cookie,
// not its validity — the backend still verifies every request. This just avoids the
// flash-of-wrong-content that a client-only redirect causes, by making the decision before the
// page ships to the browser.
//
// Cookie caveat: the refresh cookie is issued by the backend origin, scoped to Path=/api/auth.
// Cookies are matched by domain, not port, so this works when both run on `localhost` in dev.
// In a production split-domain deployment (app.example.com / api.example.com) this cookie would
// not be visible here at all — that setup needs either a same-site cookie domain or a
// same-origin API proxy, which is a Phase 8+ infra decision, not a Phase 1 concern.
const SESSION_COOKIE = "refreshToken";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (pathname === "/" && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/dashboard") && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (AUTH_ROUTES.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login", "/register", "/forgot-password"],
};
