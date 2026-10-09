// Affiliate program numbers and the tiny <head> script that remembers a
// referral link. Kept out of affiliates.server.ts so browser code (the root
// layout and the signup page) can use them without pulling in server code.

// Paid on every payment a referred customer makes, for as long as they stay
// a customer (no end date).
export const AFFILIATE_COMMISSION_RATE = 0.25;
// Commission only becomes payable once the customer has made this many
// monthly payments, so a trial that cancels or refunds right away pays nothing.
export const AFFILIATE_PAYABLE_AFTER_PAYMENTS = 2;
export const AFFILIATE_MIN_PAYOUT_DOLLARS = 25;
export const AFFILIATE_COOKIE_DAYS = 60;
export const REF_COOKIE = "uptrend_ref";

// Runs in <head> on every page: remembers ?ref=CODE for 60 days so the signup
// page can credit the right affiliate even if the visitor browses around or
// comes back later. A newer link replaces an older one (last click wins).
export const REF_CAPTURE_SCRIPT = `try{var r=new URLSearchParams(location.search).get('ref');if(r&&/^[A-Za-z0-9]{2,32}$/.test(r)){document.cookie='${REF_COOKIE}='+r.toLowerCase()+';max-age=${AFFILIATE_COOKIE_DAYS * 86400};path=/;samesite=lax'}}catch(e){}`;

// Reads the remembered referral code in the browser (null on the server).
export function readRefCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${REF_COOKIE}=([a-z0-9]{2,32})`),
  );
  return match ? (match[1] ?? null) : null;
}
