export const CANONICAL_SITE_URL = "https://www.uptrendscaling.com";

// Only ever redirect back to, or build links pointing at, a domain we control.
const ALLOWED_ORIGIN_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)*uptrendscaling\.com$|^https:\/\/[a-z0-9-]+\.vercel\.app$|^http:\/\/localhost:\d+$/i;

export function resolveOrigin(origin: string | undefined): string {
  if (origin && ALLOWED_ORIGIN_PATTERN.test(origin)) return origin;
  return CANONICAL_SITE_URL;
}
