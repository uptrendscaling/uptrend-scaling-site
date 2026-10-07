// Printable QR codes. A business owner prints one for the counter, a truck or
// an invoice; a customer scans it and lands on the business's Google review
// page, and we count the scan.
//
// The code never points straight at Google. It points at our own
// /q/:token URL (see src/routes/q.$token.tsx) so every scan hits our server
// (that is what lets us count it) and so the destination can change later
// without anyone reprinting anything.
//
// Same shape as the rest of the app: the real logic lives in plain exported
// functions that take a businessId (easy to test), and the createServerFn
// wrappers at the bottom only read the session and call them. Everything is
// dormant-safe: with no database or no session configured, nothing here
// throws to the browser.

import { randomInt } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq, gte, isNull, max, sql } from "drizzle-orm";

import { getSessionBusinessId, isAuthConfigured } from "./auth.server";
import type {
  QrCodeView,
  QrListResult,
  QrMutationResult,
  QrScanActivity,
} from "./dashboard-types";
import { getDb, isDbConfigured } from "./db/client";
import { businesses, qrCodes, qrScans } from "./db/schema";
import type { QrCode } from "./db/schema";
import { CANONICAL_SITE_URL } from "./site";

// ==== Limits ====

export const MAX_ACTIVE_QR_CODES = 25;
export const QR_LABEL_MAX_LENGTH = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

// ==== Tokens and URLs ====

// Letters and digits only, so a token is always safe in a URL path with no
// escaping. 62^10 is about 8 x 10^17 possibilities, far too many to guess,
// and the short length keeps the QR image simple (bigger squares scan more
// reliably when printed small).
const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 10;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// randomInt is crypto-grade and unbiased (no modulo skew toward early
// characters), unlike Math.random().
export function generateQrToken(): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i += 1) {
    token += TOKEN_ALPHABET.charAt(randomInt(TOKEN_ALPHABET.length));
  }
  return token;
}

export function qrScanUrl(token: string): string {
  return `${CANONICAL_SITE_URL}/q/${token}`;
}

// ==== The QR image ====

// Complete <svg> markup for a QR code that encodes `text`. Error correction
// M (about 15% of the image can be damaged or covered and it still scans,
// which matters for a sticker that gets scuffed), a 2 module quiet zone
// (the blank border scanners need), black on a solid white background so it
// still scans when placed on a dark truck door or a coloured flyer. The
// library emits a viewBox and no fixed width/height, so it scales to
// whatever size the page or print layout gives it. The markup contains only
// numbers and path data, never the owner's label, so it is safe to inline.
export async function renderQrSvg(text: string): Promise<string> {
  // Loaded on demand rather than imported at the top of the file. This file
  // is also imported by dashboard pages, and a top-level import would drag
  // the whole QR library into the browser bundle every visitor downloads
  // (the library is not marked as side-effect free, so the bundler keeps it
  // even though the browser never calls it). Here it only ever loads on the
  // server, the first time an image is needed.
  const mod = await import("qrcode");
  // CommonJS package: its functions live on the default export (and, in some
  // setups, directly on the namespace), so accept either.
  const lib = mod.default ?? mod;
  return lib.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

// ==== Building the view the dashboard shows ====

type ScanStats = { total: number; last7: number; last: Date | null };

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function toView(
  row: QrCode,
  stats: ScanStats | undefined,
): Promise<QrCodeView> {
  const scanUrl = qrScanUrl(row.token);
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    archived: row.archivedAt !== null,
    scanCount: stats?.total ?? 0,
    scansLast7Days: stats?.last7 ?? 0,
    lastScannedAt: stats?.last ? stats.last.toISOString() : null,
    scanUrl,
    svg: await renderQrSvg(scanUrl),
  };
}

// ==== Plain functions (take a businessId, easy to test) ====

// The business's active (not archived) codes, newest first, each with its
// scan numbers. The numbers come from ONE grouped query over qr_scans for the
// whole business, not one query per code, so the list stays fast however many
// scans have piled up.
export async function listQrCodesForBusiness(
  businessId: string,
): Promise<QrCodeView[]> {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);

  const [rows, statRows] = await Promise.all([
    db
      .select()
      .from(qrCodes)
      .where(
        and(eq(qrCodes.businessId, businessId), isNull(qrCodes.archivedAt)),
      )
      .orderBy(desc(qrCodes.createdAt), desc(qrCodes.id)),
    db
      .select({
        qrCodeId: qrScans.qrCodeId,
        total: count(),
        last7:
          sql<number>`count(*) filter (where ${gte(qrScans.scannedAt, sevenDaysAgo)})`.mapWith(
            Number,
          ),
        last: max(qrScans.scannedAt),
      })
      .from(qrScans)
      .where(eq(qrScans.businessId, businessId))
      .groupBy(qrScans.qrCodeId),
  ]);

  const statsByCode = new Map<string, ScanStats>(
    statRows.map((s) => [
      s.qrCodeId,
      { total: s.total, last7: s.last7, last: toDate(s.last) },
    ]),
  );

  return Promise.all(rows.map((row) => toView(row, statsByCode.get(row.id))));
}

// Friendly, plain-language validation. Whitespace runs (including stray line
// breaks pasted in) collapse to a single space, then the name must be 1 to 60
// characters. Length is counted in characters people see, so an emoji is one.
export function normalizeQrLabel(
  input: unknown,
): { ok: true; label: string } | { ok: false; message: string } {
  const label =
    typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  if (label.length === 0) {
    return {
      ok: false,
      message:
        "Give this QR code a name so you can tell it apart later, like Front counter or Truck 2.",
    };
  }
  if (Array.from(label).length > QR_LABEL_MAX_LENGTH) {
    return {
      ok: false,
      message: `Please keep the name to ${QR_LABEL_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, label };
}

// `makeToken` is only a seam so a test can force a collision and prove the
// retry works; production always uses the default.
export async function createQrCodeForBusiness(
  businessId: string,
  label: string,
  makeToken: () => string = generateQrToken,
): Promise<QrMutationResult> {
  const checked = normalizeQrLabel(label);
  if (!checked.ok) return checked;

  const db = getDb();

  const [{ active } = { active: 0 }] = await db
    .select({ active: count() })
    .from(qrCodes)
    .where(and(eq(qrCodes.businessId, businessId), isNull(qrCodes.archivedAt)));
  if (active >= MAX_ACTIVE_QR_CODES) {
    return {
      ok: false,
      message: `You have ${MAX_ACTIVE_QR_CODES} active QR codes, which is the most we allow. Archive one you no longer use to make room for a new one.`,
    };
  }

  // The token column is unique. If a random token ever collides with an
  // existing one the insert is skipped (not an error) and we simply roll a
  // new token. Five misses in a row would mean something is badly wrong.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [row] = await db
      .insert(qrCodes)
      .values({ businessId, token: makeToken(), label: checked.label })
      .onConflictDoNothing({ target: qrCodes.token })
      .returning();
    if (row) {
      return { ok: true, code: await toView(row, undefined) };
    }
  }
  return {
    ok: false,
    message: "We couldn't make that QR code just now. Please try again.",
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Soft delete: the row stays (archived_at is set) so a printed code keeps
// redirecting and its scan history is kept. The business id is part of the
// WHERE clause, so one business can never archive another's code. Archiving
// something already archived is fine and changes nothing.
export async function archiveQrCodeForBusiness(
  businessId: string,
  id: string,
): Promise<QrMutationResult> {
  const notFound: QrMutationResult = {
    ok: false,
    message: "We couldn't find that QR code.",
  };
  // Postgres throws on a malformed uuid, so check the shape first.
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return notFound;

  const db = getDb();
  const archived = await db
    .update(qrCodes)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(qrCodes.id, id),
        eq(qrCodes.businessId, businessId),
        isNull(qrCodes.archivedAt),
      ),
    )
    .returning({ id: qrCodes.id });
  if (archived.length > 0) return { ok: true };

  const [existing] = await db
    .select({ id: qrCodes.id })
    .from(qrCodes)
    .where(and(eq(qrCodes.id, id), eq(qrCodes.businessId, businessId)))
    .limit(1);
  return existing ? { ok: true } : notFound;
}

// Newest scans first, for the dashboard's activity feed. Scans of archived
// codes still show up (the printed code kept working, so the activity is real).
// Dormant-safe: the dashboard calls this next to other queries, so a database
// hiccup returns an empty feed instead of breaking the whole page.
export async function getRecentQrScans(
  businessId: string,
  limit: number,
): Promise<QrScanActivity[]> {
  if (!isDbConfigured()) return [];
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 100)
    : 10;
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: qrScans.id,
        scannedAt: qrScans.scannedAt,
        label: qrCodes.label,
        city: qrScans.city,
      })
      .from(qrScans)
      .innerJoin(qrCodes, eq(qrCodes.id, qrScans.qrCodeId))
      .where(eq(qrScans.businessId, businessId))
      .orderBy(desc(qrScans.scannedAt), desc(qrScans.id))
      .limit(safeLimit);
    return rows;
  } catch (error) {
    console.error("[qr] failed to load recent scans", error);
    return [];
  }
}

// How many scans happened at or after `since`. Same dormant-safe rule.
export async function countQrScansSince(
  businessId: string,
  since: Date,
): Promise<number> {
  if (!isDbConfigured()) return 0;
  try {
    const db = getDb();
    const [row] = await db
      .select({ total: count() })
      .from(qrScans)
      .where(
        and(eq(qrScans.businessId, businessId), gte(qrScans.scannedAt, since)),
      );
    return row?.total ?? 0;
  } catch (error) {
    console.error("[qr] failed to count scans", error);
    return 0;
  }
}

// ==== The public scan redirect (/q/:token) ====

// Where a scan goes when there is nothing better: the site home page. Used
// for an unknown token, for a business with no review link saved yet, and
// whenever the database can't be reached. A relative path, so a preview
// deployment stays on its own host.
const HOME_FALLBACK = "/";

// Don't let a slow database hold up the customer. The scan insert gets this
// long to finish; after that we redirect anyway.
const SCAN_RECORD_TIMEOUT_MS = 2000;

// Anything that is clearly a program, not a person holding a phone: search
// and social crawlers, the link previewers chat apps run when a link is
// pasted, uptime and speed checkers, and plain HTTP libraries. "cubot" is a
// real phone brand whose name contains "bot", so it is removed first.
// An empty User-Agent is also not a person's browser.
const BOT_PATTERN = new RegExp(
  [
    "bot",
    "crawl",
    "spider",
    "slurp",
    "preview",
    "facebookexternalhit",
    "whatsapp",
    "embedly",
    "vkshare",
    "feedfetcher",
    "pagerenderer",
    "headless",
    "lighthouse",
    "pagespeed",
    "gtmetrix",
    "pingdom",
    "uptime",
    "monitor",
    "ia_archiver",
    "vercel-",
    "curl/",
    "wget/",
    "python-",
    "aiohttp",
    "go-http-client",
    "java/",
    "libwww",
    "node-fetch",
    "undici",
    "axios/",
  ].join("|"),
  "i",
);

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").replace(/cubot/gi, "").trim();
  return ua.length === 0 || BOT_PATTERN.test(ua);
}

// Only ever http or https. The stored link is what we redirect to and nothing
// the visitor sends can change it, but this also refuses things like
// "javascript:" if one were ever saved. Returns the fully normalised URL,
// which also guarantees it is safe to put in a Location header.
export function safeReviewUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

// Invisible control characters (line breaks, tabs, null bytes) have no place
// in a city name.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

// Vercel adds these headers to every request from its own IP lookup. The
// visitor's IP address itself is never read or stored. City arrives
// percent-encoded ("Phoenix", "Los%20Angeles"), so it is decoded back; a
// malformed value is dropped rather than crashing the redirect. Capped in
// length because these values end up on the owner's dashboard.
function cleanGeo(raw: string | null, decode: boolean): string | null {
  if (!raw) return null;
  let value = raw;
  if (decode) {
    try {
      value = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }

  value = value.replace(CONTROL_CHARACTERS, "").trim().slice(0, 100);
  return value.length > 0 ? value : null;
}

export type QrScanRequestInfo = {
  userAgent: string | null;
  method: string;
  // Set when the browser says this is a background prefetch, not a visit.
  prefetch: boolean;
  city: string | null;
  region: string | null;
};

export function describeScanRequest(request: Request): QrScanRequestInfo {
  const headers = request.headers;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-moz") ?? ""}`;
  return {
    userAgent: headers.get("user-agent"),
    method: request.method.toUpperCase(),
    prefetch: /prefetch|prerender/i.test(purpose),
    city: cleanGeo(headers.get("x-vercel-ip-city"), true),
    region: cleanGeo(headers.get("x-vercel-ip-country-region"), false),
  };
}

async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type QrScanResolution = {
  url: string;
  // True when a qr_scans row was written for this request.
  counted: boolean;
};

// Looks the token up, records the scan (unless it is a bot, a link previewer
// or a HEAD request), and says where to send the visitor. Never throws: a
// customer standing at a counter must always end up somewhere sensible.
export async function resolveQrScan(
  token: string,
  info: QrScanRequestInfo,
): Promise<QrScanResolution> {
  const home: QrScanResolution = { url: HOME_FALLBACK, counted: false };
  if (!isDbConfigured() || !TOKEN_PATTERN.test(token)) return home;

  let code: { id: string; businessId: string; reviewUrl: string | null };
  try {
    const db = getDb();
    // One query for both the code and its business's review link.
    const [row] = await db
      .select({
        id: qrCodes.id,
        businessId: qrCodes.businessId,
        reviewUrl: businesses.googleReviewUrl,
      })
      .from(qrCodes)
      .innerJoin(businesses, eq(businesses.id, qrCodes.businessId))
      .where(eq(qrCodes.token, token))
      .limit(1);
    if (!row) return home;
    code = row;
  } catch (error) {
    console.error("[qr] failed to look up scan token", error);
    return home;
  }

  // Archived codes are deliberately not filtered out above: a code someone
  // already printed keeps working after the owner tidies their list.

  let counted = false;
  const isPerson =
    info.method !== "HEAD" && !info.prefetch && !isLikelyBot(info.userAgent);
  if (isPerson) {
    // Recorded even when the business has no review link yet, so the owner
    // can see people are scanning and fix the missing link.
    const insert = getDb()
      .insert(qrScans)
      .values({
        qrCodeId: code.id,
        businessId: code.businessId,
        city: info.city,
        region: info.region,
      })
      .then(() => {
        counted = true;
      })
      .catch((error: unknown) => {
        // Losing one tally must never cost the customer their redirect.
        console.error("[qr] failed to record scan", error);
      });
    await withTimeout(insert, SCAN_RECORD_TIMEOUT_MS);
  }

  return { url: safeReviewUrl(code.reviewUrl) ?? HOME_FALLBACK, counted };
}

// The whole /q/:token response, as a plain Request in, Response out function
// so the route stays one line and the behaviour can be tested directly.
// 302 (a plain temporary redirect) with no-store so browsers, phones and
// Vercel's cache never remember it: every scan has to reach our server to be
// counted, and the owner can change the destination later.
export async function handleQrScanRequest(
  request: Request,
  token: string,
): Promise<Response> {
  const { url } = await resolveQrScan(token, describeScanRequest(request));
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

// ==== Server functions (thin wrappers that read the session) ====

const NOT_CONFIGURED =
  "QR codes aren't switched on yet. Please check back soon.";
const SIGN_IN_AGAIN = "Please sign in again to manage your QR codes.";

async function sessionBusinessId(): Promise<string | null> {
  try {
    return await getSessionBusinessId();
  } catch (error) {
    console.error("[qr] could not read the session", error);
    return null;
  }
}

export const listQrCodes = createServerFn({ method: "GET" }).handler(
  async (): Promise<QrListResult> => {
    if (!isDbConfigured() || !isAuthConfigured()) {
      return { ok: true, codes: [] };
    }
    const businessId = await sessionBusinessId();
    if (!businessId) {
      return {
        ok: false,
        message: "Please sign in again to see your QR codes.",
      };
    }
    try {
      return { ok: true, codes: await listQrCodesForBusiness(businessId) };
    } catch (error) {
      console.error("[qr] failed to list QR codes", error);
      return {
        ok: false,
        message:
          "We couldn't load your QR codes just now. Please refresh and try again.",
      };
    }
  },
);

// The validator only shapes the input (it never throws), so a bad or missing
// label reaches the handler and comes back as a friendly {ok: false} message
// instead of an error page.
export const createQrCode = createServerFn({ method: "POST" })
  .validator((input: unknown): { label: string } => {
    const label = (input as { label?: unknown } | null | undefined)?.label;
    return { label: typeof label === "string" ? label : "" };
  })
  .handler(async ({ data }): Promise<QrMutationResult> => {
    if (!isDbConfigured() || !isAuthConfigured()) {
      return { ok: false, message: NOT_CONFIGURED };
    }
    const businessId = await sessionBusinessId();
    if (!businessId) return { ok: false, message: SIGN_IN_AGAIN };
    try {
      return await createQrCodeForBusiness(businessId, data.label);
    } catch (error) {
      console.error("[qr] failed to create QR code", error);
      return {
        ok: false,
        message: "We couldn't make that QR code just now. Please try again.",
      };
    }
  });

export const archiveQrCode = createServerFn({ method: "POST" })
  .validator((input: unknown): { id: string } => {
    const id = (input as { id?: unknown } | null | undefined)?.id;
    return { id: typeof id === "string" ? id : "" };
  })
  .handler(async ({ data }): Promise<QrMutationResult> => {
    if (!isDbConfigured() || !isAuthConfigured()) {
      return { ok: false, message: NOT_CONFIGURED };
    }
    const businessId = await sessionBusinessId();
    if (!businessId) return { ok: false, message: SIGN_IN_AGAIN };
    try {
      return await archiveQrCodeForBusiness(businessId, data.id);
    } catch (error) {
      console.error("[qr] failed to archive QR code", error);
      return {
        ok: false,
        message: "We couldn't archive that QR code just now. Please try again.",
      };
    }
  });
