// Central source of truth for UpTrend Scaling's pricing. Keep this in sync
// with whatever is actually configured in Stripe once the account is live.
export const MONTHLY_PRICE_CENTS = 7000; // $70 / month per location
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

export function monthlyTotalCents(locations: number): number {
  const safeLocations = Number.isFinite(locations) ? Math.max(1, Math.round(locations)) : 1;
  return MONTHLY_PRICE_CENTS * safeLocations;
}
