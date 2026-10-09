// The comparison pages (/compare/...), listed in one place so the affiliate
// page, the partner kit and the customer referral panel all show the same set.
// Adding ?ref=CODE to any of them credits the partner, same as their main link.
import { CANONICAL_SITE_URL } from "./site";

export const COMPARISON_PAGES = [
  { slug: "nicejob", name: "NiceJob" },
  { slug: "podium", name: "Podium" },
  { slug: "birdeye", name: "Birdeye" },
] as const;

export function comparisonLink(slug: string, code?: string | null): string {
  return `${CANONICAL_SITE_URL}/compare/${slug}${code ? `?ref=${code}` : ""}`;
}
