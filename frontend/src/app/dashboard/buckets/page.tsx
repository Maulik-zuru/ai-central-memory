import { redirect } from "next/navigation";

// Buckets now live in the sidebar tree (Phase 3) rather than their own page — this route stays so
// any old bookmark/link still lands somewhere sensible instead of 404ing.
export default function BucketsPage() {
  redirect("/dashboard/memories");
}
