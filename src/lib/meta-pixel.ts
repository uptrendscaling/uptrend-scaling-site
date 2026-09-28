// Meta Pixel for the UpTrend Scaling Facebook/Instagram ads (pixel created in
// Events Manager on 2026-09-27, ahead of the first Meta ads campaign). The
// base pixel script loads sitewide from __root.tsx, same pattern as
// GOOGLE_ADS_CONVERSION_ID in google-ads.ts; this file's fireSignupEvent() is
// called once, client-side, from start_.success.tsx -- the page a business
// only reaches after finishing the signup form on /start AND completing
// Stripe checkout, which is the real "lead" moment the ad campaigns are
// measured against (mirrors fireLeadConversion() in google-ads.ts).
export const META_PIXEL_ID = "1092107636739256";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function fireSignupEvent(): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", "CompleteRegistration");
}
