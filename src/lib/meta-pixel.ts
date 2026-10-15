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

// "Started signup": fired from /start the moment someone fills in the form
// and submits it, before they are sent on to Stripe's payment page. Finishing
// checkout (fireSignupEvent above) is rare while ads are small, so Meta gets
// this earlier, more frequent signal to learn from and aim the ads at people
// who actually begin a trial. Only the plan name is sent, never personal
// details.
export function fireStartedSignupEvent(plan: string): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", "Lead", { content_name: plan });
}

// "Purchase": fired once from the checkout success page when money was really
// charged (for example the $299 website build), with the dollar value so Meta
// can optimize ads toward actual sales. A free trial start charges $0 and is
// not sent as a purchase. The Stripe session id doubles as Meta's event id and
// as a once-per-browser guard so refreshing the page cannot count it twice.
export function firePurchaseEvent(
  sessionId: string,
  amountCents: number,
  currency: string | null,
  contentName: string,
): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  if (!(amountCents > 0)) return;
  const guardKey = `meta-purchase-${sessionId}`;
  try {
    if (window.localStorage.getItem(guardKey)) return;
    window.localStorage.setItem(guardKey, "1");
  } catch {
    // Storage blocked: still send the event, Meta de-duplicates on eventID.
  }
  window.fbq(
    "track",
    "Purchase",
    {
      value: Math.round(amountCents) / 100,
      currency: (currency ?? "usd").toUpperCase(),
      content_name: contentName,
    },
    { eventID: sessionId },
  );
}
