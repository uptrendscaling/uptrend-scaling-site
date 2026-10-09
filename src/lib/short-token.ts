// Turns a review link's UUID token into a 22-character code and back, so the
// link in a text message is short enough for the whole text to fit in one
// 160-character SMS (one text costs half as much as two). The database keeps
// the normal UUID; /r/:token accepts either form.

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_RE = /^[0-9A-Za-z]{22}$/;

export function uuidToShort(uuid: string): string {
  if (!UUID_RE.test(uuid)) return uuid;
  let n = BigInt(`0x${uuid.replace(/-/g, "")}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET.charAt(Number(n % 62n)) + out;
    n /= 62n;
  }
  return out.padStart(22, "0");
}

// Returns the UUID for a short code, the input unchanged if it already is a
// UUID, or null if it is neither.
export function tokenToUuid(token: string): string | null {
  if (UUID_RE.test(token)) return token.toLowerCase();
  if (!SHORT_RE.test(token)) return null;
  let n = 0n;
  for (const ch of token) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 62n + BigInt(v);
  }
  if (n >= 1n << 128n) return null;
  const hex = n.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
