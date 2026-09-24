// Google Ads conversion tracking for the UpTrend Scaling Search campaigns
// test (conversion action created in Google Ads on 2026-09-24). The base
// gtag.js loader tag lives in __root.tsx and runs on every page; this
// file's fireLeadConversion() is called once, client-side, from
// start.success.tsx -- the page a business only reaches after finishing the
// signup form on /start AND completing Stripe checkout, which is the real
// "lead" moment the ad campaigns are being measured against.
export const GOOGLE_ADS_CONVERSION_ID = "AW-18464908958";
const LEAD_CONVERSION_LABEL = "zULzCIe8iYQdEJ7N4ORE";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function fireLeadConversion(): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_CONVERSION_ID}/${LEAD_CONVERSION_LABEL}`,
  });
}
