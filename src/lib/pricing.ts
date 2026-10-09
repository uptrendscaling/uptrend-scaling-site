// Central source of truth for UpTrend Scaling's pricing. Checkout builds its
// Stripe prices from these numbers, so changing a plan here changes it
// everywhere (signup page, homepage, checkout, monthly limits).

// Three plans, priced per location per month. "Review requests" means review
// asks sent to customers (the automatic first ask or a manual resend). The one
// follow-up reminder that goes with each ask is included and never counted.
export const PLAN_TIERS = [
  { id: "starter", name: "Starter", priceCents: 7000, monthlyRequests: 1000 },
  { id: "growth", name: "Growth", priceCents: 10000, monthlyRequests: 2500 },
  { id: "pro", name: "Pro", priceCents: 20000, monthlyRequests: 6000 },
] as const;

export type PlanTierId = (typeof PLAN_TIERS)[number]["id"];
export type PlanTier = (typeof PLAN_TIERS)[number];
export const PLAN_TIER_IDS = PLAN_TIERS.map((t) => t.id) as [
  PlanTierId,
  ...PlanTierId[],
];
export const DEFAULT_TIER: PlanTierId = "starter";

export function tierById(id: string | null | undefined): PlanTier {
  return PLAN_TIERS.find((t) => t.id === id) ?? PLAN_TIERS[0];
}

// The cheapest plan's price, used wherever the site says "from $70".
export const MONTHLY_PRICE_CENTS = PLAN_TIERS[0].priceCents;
export const SETUP_FEE_CENTS = 2000; // $20 one-time, applies once per account
export const TRIAL_DAYS = 7; // Free trial length; billing starts on day 7

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function safeLocationCount(locations: number): number {
  return Number.isFinite(locations) ? Math.max(1, Math.round(locations)) : 1;
}

export function monthlyTotalCents(
  locations: number,
  tier: string = DEFAULT_TIER,
): number {
  return tierById(tier).priceCents * safeLocationCount(locations);
}

// Review requests allowed per calendar month for the whole account.
export function monthlyRequestLimit(
  locations: number,
  tier: string | null | undefined,
): number {
  return tierById(tier).monthlyRequests * safeLocationCount(locations);
}
