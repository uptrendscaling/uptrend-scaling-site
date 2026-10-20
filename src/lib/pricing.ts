// Central source of truth for UpTrend Scaling's pricing. Checkout builds its
// Stripe prices from these numbers, so changing a plan here changes it
// everywhere (signup page, homepage, checkout, monthly limits).

// Three plans, priced per location per month. "Review requests" means review
// asks sent to customers (the automatic first ask or a manual resend). The one
// follow-up reminder that goes with each ask is included and never counted.
export const PLAN_TIERS = [
  { id: "starter", name: "Starter", priceCents: 5000, monthlyRequests: 1000 },
  { id: "growth", name: "Growth", priceCents: 9000, monthlyRequests: 2500 },
  { id: "pro", name: "Pro", priceCents: 17000, monthlyRequests: 6000 },
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

// The cheapest plan's price, used wherever the site says "from $50".
export const MONTHLY_PRICE_CENTS = PLAN_TIERS[0].priceCents;
export const SETUP_FEE_CENTS = 1500; // $15 one-time, applies once per account
export const TRIAL_DAYS = 7; // Free trial length; billing starts on day 7

// ---- Website offers ---------------------------------------------------------
// Sold at checkout (/start) next to, or instead of, the Google review plans.
// "build" is a one-time design and build, "maintenance" is a monthly hosting
// and updates plan, and "build_maintenance" is both. Checkout names its Stripe
// lines "UpTrend Website ..." (WEBSITE_LINE_MARKER) so affiliate commission can
// tell website money apart from review-plan money (see affiliates.server.ts).
export const WEBSITE_BUILD_CENTS = 29900; // $299 one-time
export const WEBSITE_MAINTENANCE_CENTS = 9900; // $99 per month
export const WEBSITE_LINE_MARKER = "UpTrend Website";

export const WEBSITE_OPTIONS = [
  {
    id: "build",
    name: "Website build",
    priceText: "$299 one-time",
    detail:
      "We design and build your site. You approve it before it goes live.",
    buildCents: WEBSITE_BUILD_CENTS,
    monthlyCents: 0,
  },
  {
    id: "build_maintenance",
    name: "Website + maintenance",
    priceText: "$299 once, then $99/mo",
    detail: "The build, plus hosting, small updates and support every month.",
    buildCents: WEBSITE_BUILD_CENTS,
    monthlyCents: WEBSITE_MAINTENANCE_CENTS,
  },
  {
    id: "maintenance",
    name: "Maintenance only",
    priceText: "$99/mo",
    detail: "For a site you already have: hosting, small updates and support.",
    buildCents: 0,
    monthlyCents: WEBSITE_MAINTENANCE_CENTS,
  },
] as const;

export type WebsiteOption = (typeof WEBSITE_OPTIONS)[number];
export type WebsiteOptionId = WebsiteOption["id"];
export const WEBSITE_OPTION_IDS = WEBSITE_OPTIONS.map((o) => o.id) as [
  WebsiteOptionId,
  ...WebsiteOptionId[],
];

export function websiteOptionById(
  id: string | null | undefined,
): WebsiteOption | null {
  return WEBSITE_OPTIONS.find((o) => o.id === id) ?? null;
}

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
