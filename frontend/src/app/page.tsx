// proxy.ts redirects "/" to /dashboard when the optimistic session-cookie check finds a session.
// Everyone else — logged out, or the cookie check bypassed — lands here on the marketing page.
import { MarketingHome } from "@/app/(marketing)/marketing-home";

export default function RootPage() {
  return <MarketingHome />;
}
