// Mirrors backend/docs/Phase10_Implementation_Plan.md §3's retrofit table exactly — the same list
// of gates the backend's requirePlan('pro') actually enforces. Kept as one array so the pricing
// page and any other plan-comparison surface read from the same source instead of hand-maintained
// copy that could drift from what's actually gated (US-BIL-01's AC).
export interface PlanFeature {
  label: string;
  core: string;
  pro: string;
}

export const PLAN_FEATURES: PlanFeature[] = [
  { label: "Memories, capture & retrieval", core: "Included", pro: "Included" },
  { label: "Conversation history", core: "Up to 500 conversations", pro: "Unlimited" },
  { label: "Shared bucket collaborators", core: "Up to 3 per bucket", pro: "Unlimited" },
  { label: "Smart Memory categorization", core: "Basic on/off", pro: "Full category tuning" },
  { label: "Conversation summaries", core: "Not included", pro: "Included" },
  { label: "Monthly insights digest", core: "Not included", pro: "Included" },
  { label: "Precise search (high-accuracy recall)", core: "5 free previews", pro: "Unlimited" },
  { label: "Knowledge graph", core: "Not included", pro: "Included" },
  { label: "Usage analytics dashboard", core: "Not included", pro: "Included" },
];
