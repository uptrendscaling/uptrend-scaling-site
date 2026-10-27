// Finds the photos on a business's existing website so a new site can show the
// customer's real work. Two steps, so each server call stays short:
//   scanSitePhotos: reads the home page and a few portfolio pages and lists
//     candidate picture addresses.
//   fetchPhoto: downloads one picture, checks it is a real photo (not a logo or
//     an icon), shrinks it when it is big, and hands back base64 to store.
// No database in here. Only for Colby's admin tools.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Keep stored pictures small: base64 text is about 1.33x the file.
export const MAX_PHOTO_BASE64 = 1_000_000;

// Services that are well known to host customers' own pictures.
const IMAGE_CDNS = [
  "wp.com",
  "wixstatic.com",
  "squarespace-cdn.com",
  "squarespace.com",
  "pixieset.com",
  "smugmug.com",
  "cloudinary.com",
  "imgix.net",
  "shopifycdn.com",
  "cdn.shopify.com",
  "websitebuilderassets.com",
  "godaddysites.com",
  "wsimg.com",
  "weebly.com",
  "editmysite.com",
  "format.com",
  "myportfolio.com",
  "pic-time.com",
  "zenfolio.com",
];

const JUNK_WORDS =
  /(logo|icon|favicon|sprite|avatar|placeholder|spinner|loading|badge|emoji|gravatar|pixel|blank|banner|button|arrow|social|payment|rating|marker|flag|seal|award|cursor|bullet|divider|shadow|overlay|thumb-?play|play-?button|captcha)/i;

export function safePublicUrl(input: string): URL | null {
  let u: URL;
  try {
    u = new URL(
      /^https?:\/\//i.test(input.trim())
        ? input.trim()
        : `https://${input.trim()}`,
    );
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost") ||
    !h.includes(".") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
    h.includes(":") ||
    h.startsWith("[")
  )
    return null;
  return u;
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
        ...headers,
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, 7000, {
    accept: "text/html,application/xhtml+xml",
  });
  if (!res || !res.ok) return null;
  const type = res.headers.get("content-type") ?? "";
  if (!/html|xml/i.test(type)) return null;
  const text = await res.text();
  return text.slice(0, 2_500_000);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&#x2F;/gi, "/");
}

function registrable(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  return parts.slice(-2).join(".");
}

function absolutize(raw: string, base: URL): string | null {
  const cleaned = decodeEntities(raw.trim()).replace(/\\\//g, "/");
  if (!cleaned || cleaned.startsWith("data:")) return null;
  try {
    const u = new URL(cleaned, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Picks the biggest picture out of a srcset ("a.jpg 300w, b.jpg 1200w").
function bestOfSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const m = part.trim().match(/^(\S+)(?:\s+(\d+)w|\s+[\d.]+x)?/);
    if (!m || !m[1]) continue;
    const w = m[2] ? Number(m[2]) : 1;
    if (!best || w > best.w) best = { url: m[1], w };
  }
  return best ? best.url : null;
}

// The same picture often appears as many sizes ("photo-300x200.jpg"). Treat
// them as one and ask for the full size.
function fullSizeOf(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)wp\.com$/i.test(u.hostname)) {
      u.search = "";
    }
    u.pathname = u.pathname
      .replace(/-\d{2,4}x\d{2,4}(\.\w+)$/i, "$1")
      .replace(/-scaled(\.\w+)$/i, "$1");
    return u.toString();
  } catch {
    return url;
  }
}

function dedupeKey(url: string): string {
  try {
    const u = new URL(fullSizeOf(url));
    return `${u.hostname.replace(/^(i\d\.)?(www\.)?/, "")}${u.pathname}`.toLowerCase();
  } catch {
    return url;
  }
}

function looksLikePhoto(url: string, site: URL): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (
    !/\.(jpe?g|png|webp)(\?|$)/i.test(u.pathname + u.search) &&
    !/\.(jpe?g|png|webp)$/i.test(u.pathname)
  )
    return false;
  const file = decodeURIComponent(u.pathname.split("/").slice(-1)[0] ?? "");
  if (JUNK_WORDS.test(file)) return false;
  if (/\/wp-content\/(plugins|themes)\/|\/wp-includes\//i.test(u.pathname))
    return false;
  const host = u.hostname.toLowerCase();
  const sameSite =
    registrable(host) === registrable(site.hostname) ||
    u.pathname
      .toLowerCase()
      .includes(`/${site.hostname.replace(/^www\./, "")}/`) ||
    u.pathname.toLowerCase().includes(`/${site.hostname}/`);
  const cdn = IMAGE_CDNS.some((d) => host === d || host.endsWith(`.${d}`));
  return sameSite || cdn;
}

function imagesFromHtml(html: string, base: URL): string[] {
  const found: string[] = [];
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const abs = absolutize(raw, base);
    if (abs) found.push(abs);
  };
  const source = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");

  // Pictures named in attributes, including the lazy-loading ones.
  const attr =
    /\b(?:src|data-src|data-lazy-src|data-original|data-orig-file|data-large-file|data-full-url|data-full|data-image|data-bg|data-background|href|content)\s*=\s*["']([^"']+?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(source))) {
    if (/\.(jpe?g|png|webp)(\?|#|$)/i.test(m[1] ?? "")) push(m[1]);
  }
  const srcset =
    /\b(?:srcset|data-srcset|data-lazy-srcset)\s*=\s*["']([^"']+?)["']/gi;
  while ((m = srcset.exec(source))) push(bestOfSrcset(m[1] ?? ""));
  // Background pictures in inline styles.
  const bg = /url\(\s*["']?([^"')]+?\.(?:jpe?g|png|webp)[^"')]*?)["']?\s*\)/gi;
  while ((m = bg.exec(source))) push(m[1]);
  // Anything else that is plainly a full picture address (page builders keep
  // their galleries in script data).
  const loose =
    /https?:\/\/[^\s"'<>()\\]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>()\\]*)?/gi;
  while ((m = loose.exec(source))) push(m[0]);
  return found;
}

function portfolioLinks(html: string, base: URL): string[] {
  const scored: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>();
  const link = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = link.exec(html))) {
    const abs = absolutize(m[1] ?? "", base);
    if (!abs) continue;
    let u: URL;
    try {
      u = new URL(abs);
    } catch {
      continue;
    }
    if (registrable(u.hostname) !== registrable(base.hostname)) continue;
    if (/\.(jpe?g|png|webp|gif|pdf|zip|css|js)$/i.test(u.pathname)) continue;
    u.hash = "";
    const key = u.origin + u.pathname.replace(/\/$/, "");
    if (seen.has(key) || key === base.origin + base.pathname.replace(/\/$/, ""))
      continue;
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
    const target = `${u.pathname.toLowerCase()} ${text}`;
    if (
      /(blog|privacy|terms|contact|cart|checkout|login|account|policy|faq|about|review|price|pricing|package|tag\/|category\/|author|feed|wp-json|wp-admin)/.test(
        target,
      ) &&
      !/(portfolio|gallery)/.test(target)
    )
      continue;
    let score = 0;
    if (
      /(portfolio|gallery|galleries|our-work|work|showcase|lookbook|projects)/.test(
        target,
      )
    )
      score += 5;
    if (
      /(photograph|photos?|session|wedding|engagement|portrait|maternity|family|newborn|senior|graduation|sport|fashion|editorial|event|quince|elopement|brand|headshot|boudoir)/.test(
        target,
      )
    )
      score += 3;
    if (score === 0) continue;
    seen.add(key);
    scored.push({ url: u.toString(), score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 7)
    .map((x) => x.url);
}

export async function scanSitePhotos(
  startUrl: string,
): Promise<{ candidates: string[]; pages: number; error?: string }> {
  const start = safePublicUrl(startUrl);
  if (!start)
    return {
      candidates: [],
      pages: 0,
      error: "That does not look like a website address.",
    };
  const home = await fetchHtml(start.toString());
  if (!home)
    return {
      candidates: [],
      pages: 0,
      error:
        "Could not open that website from here. Some sites block automatic visitors. You can still upload photos by hand.",
    };
  const base = new URL(start.toString());
  const pages: Array<{ url: URL; html: string }> = [{ url: base, html: home }];
  const links = portfolioLinks(home, base);
  const extra = await Promise.all(
    links.map(async (l) => {
      const html = await fetchHtml(l);
      return html ? { url: new URL(l), html } : null;
    }),
  );
  for (const e of extra) if (e) pages.push(e);

  // Interleave pages so one busy page does not crowd out the rest.
  const perPage = pages.map((p) => {
    const list: string[] = [];
    const seen = new Set<string>();
    for (const img of imagesFromHtml(p.html, p.url)) {
      if (!looksLikePhoto(img, start)) continue;
      const key = dedupeKey(img);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(fullSizeOf(img));
    }
    return list;
  });
  const out: string[] = [];
  const used = new Set<string>();
  for (let i = 0; out.length < 80; i++) {
    let any = false;
    for (const list of perPage) {
      const item = list[i];
      if (!item) continue;
      any = true;
      const key = dedupeKey(item);
      if (used.has(key)) continue;
      used.add(key);
      out.push(item);
    }
    if (!any) break;
  }
  return { candidates: out, pages: pages.length };
}

// ---- Downloading one picture ------------------------------------------------------

function sizeOf(buf: Buffer): { w: number; h: number } | null {
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1] ?? 0;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP
  if (
    buf.length > 30 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8 ")
      return {
        w: buf.readUInt16LE(26) & 0x3fff,
        h: buf.readUInt16LE(28) & 0x3fff,
      };
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function mimeOf(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

async function downloadBytes(
  url: string,
  referer: string,
): Promise<Buffer | null> {
  const res = await fetchWithTimeout(url, 9000, {
    accept: "image/avif,image/webp,image/*,*/*;q=0.8",
    referer,
  });
  if (!res || !res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 14_000_000) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 14_000_000 ? null : buf;
}

// A picture shrunk to about 1800 pixels. Uses a free public image resizer, since
// the server has no image library of its own. The result is stored in our own
// database, so the finished site never depends on it.
async function shrink(
  url: string,
  width: number,
  quality: number,
): Promise<Buffer | null> {
  const proxy = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&h=${width}&fit=inside&we=1&q=${quality}&output=jpg`;
  const res = await fetchWithTimeout(proxy, 12000, {
    accept: "image/jpeg,image/*",
  });
  if (!res || !res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return mimeOf(buf) === "image/jpeg" ? buf : null;
}

export type PhotoResult =
  | {
      ok: true;
      mime: "image/jpeg" | "image/png" | "image/webp";
      data: string;
      w: number;
      h: number;
    }
  | { ok: false; reason: string };

export async function fetchPhoto(
  url: string,
  siteUrl: string,
): Promise<PhotoResult> {
  const u = safePublicUrl(url);
  if (!u) return { ok: false, reason: "bad address" };
  const referer = new URL(siteUrl).origin + "/";
  let buf = await downloadBytes(u.toString(), referer);
  if (!buf) return { ok: false, reason: "could not download" };
  let mime = mimeOf(buf);
  let size = sizeOf(buf);
  if (!mime || !size) return { ok: false, reason: "not a picture" };
  const long = Math.max(size.w, size.h);
  const short = Math.min(size.w, size.h);
  const ratio = size.w / size.h;
  if (long < 900 || short < 480) return { ok: false, reason: "too small" };
  if (ratio < 0.4 || ratio > 3.2) return { ok: false, reason: "odd shape" };

  const tooBig = buf.length * 1.34 > MAX_PHOTO_BASE64 || long > 2000;
  if (tooBig) {
    let shrunk = await shrink(u.toString(), 1800, 80);
    if (!shrunk || shrunk.length * 1.34 > MAX_PHOTO_BASE64)
      shrunk = await shrink(u.toString(), 1500, 68);
    if (!shrunk || shrunk.length * 1.34 > MAX_PHOTO_BASE64)
      shrunk = await shrink(u.toString(), 1200, 60);
    if (!shrunk || shrunk.length * 1.34 > MAX_PHOTO_BASE64)
      return { ok: false, reason: "could not shrink" };
    buf = shrunk;
    mime = "image/jpeg";
    size = sizeOf(buf) ?? size;
  }
  return {
    ok: true,
    mime: mime ?? "image/jpeg",
    data: buf.toString("base64"),
    w: size.w,
    h: size.h,
  };
}
