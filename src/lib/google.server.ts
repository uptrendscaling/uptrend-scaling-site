// Google Business Profile connection: lets a client connect THEIR OWN Google
// account, then documents their real Google rating and review count over time.
// Nothing here ever invents data. Every number comes from the owner's own
// Business Profile through Google's APIs, and is stored as it arrives.
//
// Dormant until two things happen on the owner's side:
//   1. A Google Cloud OAuth client exists and GOOGLE_CLIENT_ID and
//      GOOGLE_CLIENT_SECRET are set in Vercel.
//   2. Google approves this company for Business Profile API access (until
//      then Google answers calls with 403 or with a 429 whose quota is 0).
// Until both are true every entry point degrades to a friendly message.
//
// APIs used (checked against developers.google.com, October 2026):
//   OAuth consent    https://accounts.google.com/o/oauth2/v2/auth
//   Token endpoint   https://oauth2.googleapis.com/token
//   Accounts         GET mybusinessaccountmanagement.googleapis.com/v1/accounts
//   Locations        GET mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
//                    (readMask is required; the location name comes back as
//                    "locations/{id}")
//   Reviews          GET mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews
//                    (the v4 reviews resource is NOT deprecated, but it needs the
//                    long "accounts/{a}/locations/{l}" form, so that is what we
//                    store as external_location_id)
// Scope: https://www.googleapis.com/auth/business.manage
//
// Refresh tokens do not rotate. They stop working when the owner revokes
// access, after six months unused, after the 100 token per account limit, or
// after 7 days if the Google Cloud consent screen is left in "Testing".

import { timingSafeEqual } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  createOAuthState,
  getSessionBusinessId,
  verifyOAuthState,
} from "./auth.server";
import {
  decryptAccessToken,
  decryptRefreshToken,
  findConnectionByExternalAccountId,
  isCrmFrameworkConfigured,
  recordConnectionError,
  saveConnection,
  updateConnectionTokens,
  type CrmProvider,
} from "./crm/connections.server";
import {
  EMPTY_GOOGLE_SUMMARY,
  type GoogleLocationOption,
  type GoogleStatus,
  type GoogleSummary,
} from "./dashboard-types";
import { getDb } from "./db/client";
import {
  businesses,
  crmConnections,
  googleRatingSnapshots,
  googleReviews,
  type CrmConnection,
} from "./db/schema";
import { CANONICAL_SITE_URL } from "./site";

const PROVIDER: CrmProvider = "google";
const REDIRECT_URI = `${CANONICAL_SITE_URL}/connect/google/callback`;
const SCOPE = "https://www.googleapis.com/auth/business.manage";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_URL =
  "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const LOCATIONS_BASE =
  "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";

// Refresh a little before the (usually 1 hour) access token really expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Google documents 50 as the largest page for the reviews list.
const REVIEWS_PAGE_SIZE = 50;
// Hard stop so a runaway pagination loop can never spin (3000 reviews).
const MAX_REVIEW_PAGES = 60;
// Vercel Hobby functions are short lived, so every sync works to a deadline.
const DEFAULT_SYNC_BUDGET_MS = 8000;
const REFRESH_RATE_LIMIT_MS = 10 * 60 * 1000;
const CRON_FRESH_MS = 20 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/Phoenix";

const SETTINGS_DESTINATION = "/app?tab=settings";
const ERROR_DESTINATION = "/app?crmError=google";

// Plain language messages shown to the owner. Written for a non-technical
// reader: what happened, and whether they need to do anything.
export const GOOGLE_MESSAGES = {
  notConfigured: "Google isn't switched on yet. Check back soon.",
  notApproved:
    "Google has not approved UpTrend Scaling for Business Profile access yet. Nothing is wrong on your end. Your rating will start appearing here as soon as Google opens access.",
  noAccess:
    "Google would not share this location's reviews with us. Please check that this Google account still manages the business, then try again.",
  rateLimited:
    "Google asked us to slow down for a bit. We will try again soon.",
  unavailable: "Google is not responding right now. We will try again later.",
  notFound:
    "Google could not find that business location. Please choose it again in settings.",
  // Starts with the marker isReconnectMessage() looks for. This is the only
  // message that means "needs reconnect" in the status.
  reconnect:
    "Please reconnect Google. Your access was removed or expired on Google's side.",
  config: "Google sign in is not working right now. Please try again later.",
  generic: "Something went wrong talking to Google. We will try again later.",
  connectFailed: "Couldn't connect to Google. Please try again.",
  noRefreshToken:
    "Google did not give us long term access. Please try connecting again and approve every step.",
  scopeMissing:
    "Please connect again and tick the box that lets UpTrend Scaling see your Business Profile.",
  noAccounts:
    "We could not find a Google Business Profile on that Google account. Please try again with the Google account that manages your business.",
  accountInUse:
    "That Google account is already connected to a different UpTrend Scaling account.",
  notSignedIn: "Please sign in and try connecting Google again.",
  stateInvalid:
    "That connection link expired or was invalid. Please try again.",
  noConnection: "Connect your Google account first.",
  noLocation: "Choose your business location first.",
} as const;

export function isGoogleConfigured(): boolean {
  return (
    Boolean(
      process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"],
    ) && isCrmFrameworkConfigured()
  );
}

// The needs-reconnect state has no column of its own, so it is carried by the
// message text that recordConnectionError stores.
export function isReconnectMessage(message: string | null): boolean {
  return Boolean(message && message.startsWith("Please reconnect Google"));
}

// ---------------------------------------------------------------- Google HTTP

type GoogleErrorKind =
  | "reconnect" // 401 or invalid_grant: access is gone
  | "not_approved" // API not approved or not enabled, or quota limit of 0
  | "forbidden" // other 403
  | "rate_limited" // 429
  | "not_found"
  | "unavailable" // 5xx, timeouts, network trouble
  | "config" // Google rejected OUR client id or secret
  | "other";

class GoogleApiError extends Error {
  readonly kind: GoogleErrorKind;
  readonly status: number;
  constructor(kind: GoogleErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// Google's error body is usually {"error":{"code","message","status","details"}}
// from the APIs and {"error":"invalid_grant","error_description":"..."} from
// the token endpoint. Both are handled; anything unreadable is "other".
function classifyHttpError(status: number, bodyText: string): GoogleApiError {
  const summary = `Google answered ${status}: ${bodyText.slice(0, 300)}`;
  if (status === 401) return new GoogleApiError("reconnect", status, summary);
  if (status === 403) {
    // The API switched off for the project, or access not granted.
    const disabled =
      /SERVICE_DISABLED|has not been used in project|API has not been enabled|is disabled/i.test(
        bodyText,
      );
    return new GoogleApiError(
      disabled ? "not_approved" : "forbidden",
      status,
      summary,
    );
  }
  if (status === 429) {
    // Projects without approved access get quota 0, which Google reports as
    // a 429 "Quota exceeded". A quota_limit_value of "0" says so outright.
    const quotaZero = /"quota_limit_value"\s*:\s*"0"/.test(bodyText);
    return new GoogleApiError(
      quotaZero ? "not_approved" : "rate_limited",
      status,
      summary,
    );
  }
  if (status === 404) return new GoogleApiError("not_found", status, summary);
  if (status >= 500) return new GoogleApiError("unavailable", status, summary);
  return new GoogleApiError("other", status, summary);
}

function requestTimeoutMs(deadline: number | undefined): number {
  if (deadline === undefined) return 8000;
  return Math.min(8000, Math.max(1500, deadline - Date.now() + 1000));
}

async function googleRequest(
  url: string,
  init: RequestInit,
  deadline?: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs(deadline)),
    });
  } catch (error) {
    throw new GoogleApiError(
      "unavailable",
      0,
      `Google request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw classifyHttpError(response.status, await response.text());
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GoogleApiError("unavailable", response.status, "Bad JSON");
  }
}

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

// POST form body to the token endpoint. invalid_grant on a refresh means the
// owner revoked access (or the token aged out), so it maps to "reconnect".
async function postToTokenEndpoint(
  params: Record<string, string>,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    throw new GoogleApiError(
      "unavailable",
      0,
      `Google token request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    const text = await response.text();
    let code = "";
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string") code = parsed.error;
    } catch {
      // not JSON, fall through to the status based mapping
    }
    const summary = `Google token endpoint answered ${response.status}: ${text.slice(0, 300)}`;
    if (code === "invalid_grant") {
      throw new GoogleApiError("reconnect", response.status, summary);
    }
    if (
      code === "invalid_client" ||
      code === "unauthorized_client" ||
      code === "invalid_request"
    ) {
      throw new GoogleApiError("config", response.status, summary);
    }
    if (response.status >= 500) {
      throw new GoogleApiError("unavailable", response.status, summary);
    }
    throw new GoogleApiError("other", response.status, summary);
  }
  const body = (await response.json()) as Partial<TokenResponse>;
  if (!body.access_token) {
    throw new GoogleApiError(
      "other",
      200,
      "Token response had no access_token",
    );
  }
  return body as TokenResponse;
}

function tokenExpiry(expiresInSeconds: number | undefined): Date {
  const seconds =
    typeof expiresInSeconds === "number" && expiresInSeconds > 0
      ? expiresInSeconds
      : 3600;
  return new Date(Date.now() + seconds * 1000);
}

// What to tell the owner, and whether to store it on the connection.
type FailureInfo = {
  message: string;
  persist: boolean;
  reason: GoogleFailureReason;
};

function describeFailure(
  error: GoogleApiError,
  everSynced: boolean,
): FailureInfo {
  switch (error.kind) {
    case "reconnect":
      return {
        message: GOOGLE_MESSAGES.reconnect,
        persist: true,
        reason: "needs_reconnect",
      };
    case "not_approved":
      return {
        message: GOOGLE_MESSAGES.notApproved,
        persist: true,
        reason: "not_approved",
      };
    case "forbidden":
      // Before the first good sync a 403 almost always means Google has not
      // switched the API on for us yet. After one it is a permission change.
      return everSynced
        ? { message: GOOGLE_MESSAGES.noAccess, persist: true, reason: "error" }
        : {
            message: GOOGLE_MESSAGES.notApproved,
            persist: true,
            reason: "not_approved",
          };
    case "rate_limited":
      // A project without approval is told "quota exceeded" (limit 0), so a
      // 429 before any successful sync is treated as "not approved yet".
      return everSynced
        ? {
            message: GOOGLE_MESSAGES.rateLimited,
            persist: false,
            reason: "rate_limited",
          }
        : {
            message: GOOGLE_MESSAGES.notApproved,
            persist: true,
            reason: "not_approved",
          };
    case "not_found":
      return {
        message: GOOGLE_MESSAGES.notFound,
        persist: true,
        reason: "error",
      };
    case "config":
      return {
        message: GOOGLE_MESSAGES.config,
        persist: true,
        reason: "error",
      };
    case "unavailable":
      return {
        message: GOOGLE_MESSAGES.unavailable,
        persist: false,
        reason: "error",
      };
    default:
      return {
        message: GOOGLE_MESSAGES.generic,
        persist: false,
        reason: "error",
      };
  }
}

async function failFromError(
  connection: CrmConnection,
  error: GoogleApiError,
): Promise<GoogleSyncFailure> {
  console.error(`[google] ${error.kind}: ${error.message}`);
  const info = describeFailure(error, connection.lastEventAt !== null);
  if (info.persist) {
    await recordConnectionError(connection.id, info.message);
  }
  return { ok: false, reason: info.reason, message: info.message };
}

// ------------------------------------------------------------ authorize URL

export type GoogleAuthorizeUrlResult =
  { ok: true; url: string } | { ok: false; message: string };

// access_type=offline is what makes Google return a refresh token, and
// prompt=consent makes it return one every time (without it a repeat
// authorization comes back with no refresh token). select_account lets an
// owner with several Google logins pick the one that manages the business.
export function buildGoogleAuthorizeUrl(businessId: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", process.env["GOOGLE_CLIENT_ID"] as string);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", createOAuthState(businessId, PROVIDER));
  return url.toString();
}

export const getGoogleAuthorizeUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoogleAuthorizeUrlResult> => {
    if (!isGoogleConfigured()) {
      return { ok: false, message: GOOGLE_MESSAGES.notConfigured };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };
    return { ok: true, url: buildGoogleAuthorizeUrl(businessId) };
  },
);

// ----------------------------------------------- accounts and locations

type GoogleAccount = {
  name: string; // "accounts/123..."
  accountName: string | null;
  type: string | null; // PERSONAL, ORGANIZATION, LOCATION_GROUP, USER_GROUP
};

type JsonGetter = (url: string) => Promise<unknown>;

const ACCOUNT_NAME_PATTERN = /^accounts\/[A-Za-z0-9_-]+$/;
const LOCATION_NAME_PATTERN = /^locations\/[A-Za-z0-9_-]+$/;
// The long form the v4 reviews API needs.
const FULL_LOCATION_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/;
const PENDING_ACCOUNT_PREFIX = "pending:";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function listAccounts(get: JsonGetter): Promise<GoogleAccount[]> {
  const accounts: GoogleAccount[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL(ACCOUNTS_URL);
    url.searchParams.set("pageSize", "20"); // documented default and maximum
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = asRecord(await get(url.toString()));
    const rows = Array.isArray(body["accounts"]) ? body["accounts"] : [];
    for (const row of rows) {
      const record = asRecord(row);
      const name = asString(record["name"]);
      if (!name || !ACCOUNT_NAME_PATTERN.test(name)) continue;
      accounts.push({
        name,
        accountName: asString(record["accountName"]),
        type: asString(record["type"]),
      });
    }
    pageToken = asString(body["nextPageToken"]);
    if (!pageToken) break;
  }
  return accounts;
}

// Google documents that the user's personal account is always first.
function pickPrimaryAccount(accounts: GoogleAccount[]): GoogleAccount | null {
  return accounts.find((a) => a.type === "PERSONAL") ?? accounts[0] ?? null;
}

// One line, e.g. "123 Main St, Phoenix, AZ 85001". Service area businesses
// have no storefront address, which is fine (null).
function formatAddress(storefront: unknown): string | null {
  const a = asRecord(storefront);
  const lines = Array.isArray(a["addressLines"])
    ? a["addressLines"].filter(
        (l): l is string => typeof l === "string" && l.trim().length > 0,
      )
    : [];
  const stateZip = [
    asString(a["administrativeArea"]),
    asString(a["postalCode"]),
  ]
    .filter(Boolean)
    .join(" ");
  const cityState = [asString(a["locality"]), stateZip]
    .filter((p) => p && p.length > 0)
    .join(", ");
  const full = [lines.join(", "), cityState]
    .filter((p) => p.length > 0)
    .join(", ");
  return full.length > 0 ? full : null;
}

// The part that identifies a location regardless of which account it was
// found under ("locations/456"). Used to de-duplicate and to compare.
function locationKey(fullName: string): string {
  const index = fullName.indexOf("/locations/");
  return index === -1 ? fullName : fullName.slice(index + 1);
}

// Lists the locations of every account the owner can reach. The same
// location can show up under both a personal and a group account, so results
// are de-duplicated (the first account found wins, personal comes first).
async function listLocationsForAccounts(
  get: JsonGetter,
  accounts: GoogleAccount[],
): Promise<GoogleLocationOption[]> {
  const found = new Map<string, GoogleLocationOption>();
  let firstTolerableError: GoogleApiError | null = null;
  let succeeded = 0;

  for (const account of accounts) {
    // User groups only organize staff and never own locations.
    if (account.type === "USER_GROUP") continue;
    try {
      let pageToken: string | null = null;
      for (let page = 0; page < 5; page++) {
        const url = new URL(`${LOCATIONS_BASE}/${account.name}/locations`);
        // readMask is required by the API.
        url.searchParams.set("readMask", "name,title,storefrontAddress");
        url.searchParams.set("pageSize", "100"); // documented maximum
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const body = asRecord(await get(url.toString()));
        const rows = Array.isArray(body["locations"]) ? body["locations"] : [];
        for (const row of rows) {
          const record = asRecord(row);
          const name = asString(record["name"]);
          if (!name || !LOCATION_NAME_PATTERN.test(name)) continue;
          const key = name;
          if (found.has(key)) continue;
          found.set(key, {
            id: `${account.name}/${name}`,
            name: asString(record["title"]) ?? "Unnamed location",
            address: formatAddress(record["storefrontAddress"]),
          });
        }
        pageToken = asString(body["nextPageToken"]);
        if (!pageToken) break;
      }
      succeeded++;
    } catch (error) {
      // One account the owner cannot read should not hide the others.
      if (
        error instanceof GoogleApiError &&
        (error.kind === "forbidden" || error.kind === "not_found")
      ) {
        firstTolerableError ??= error;
        continue;
      }
      throw error;
    }
  }
  if (succeeded === 0 && firstTolerableError) throw firstTolerableError;
  return [...found.values()];
}

// ----------------------------------------------------------- connection rows

async function loadConnection(
  businessId: string,
): Promise<CrmConnection | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(crmConnections)
    .where(
      and(
        eq(crmConnections.businessId, businessId),
        eq(crmConnections.provider, PROVIDER),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Returns a usable access token, refreshing first when it is (nearly)
// expired. Throws GoogleApiError; callers turn that into a friendly result.
async function getAccessToken(
  connection: CrmConnection,
  force = false,
): Promise<string> {
  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? 0;
  if (!force && expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return decryptAccessToken(connection);
  }
  const refreshToken = decryptRefreshToken(connection);
  if (!refreshToken) {
    throw new GoogleApiError("reconnect", 0, "No refresh token on file");
  }
  const tokens = await postToTokenEndpoint({
    client_id: process.env["GOOGLE_CLIENT_ID"] as string,
    client_secret: process.env["GOOGLE_CLIENT_SECRET"] as string,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  // Google does not rotate refresh tokens, so only the access token changes.
  await updateConnectionTokens(
    connection.id,
    tokens.access_token,
    null,
    tokenExpiry(tokens.expires_in),
  );
  return tokens.access_token;
}

// A GET that survives one revoked-looking access token: on a 401 it forces a
// refresh and retries once. A second 401, or invalid_grant, bubbles up as
// "reconnect".
function makeAuthedGetter(
  // Null during the connect handshake: a 401 on a brand new token means the
  // handshake itself failed, so there is nothing to refresh.
  connection: CrmConnection | null,
  initialToken: string,
  deadline?: number,
): JsonGetter {
  let token = initialToken;
  let refreshedAfter401 = false;
  const call = (url: string) =>
    googleRequest(
      url,
      { method: "GET", headers: { authorization: `Bearer ${token}` } },
      deadline,
    );
  return async (url) => {
    try {
      return await call(url);
    } catch (error) {
      if (
        error instanceof GoogleApiError &&
        error.kind === "reconnect" &&
        connection !== null &&
        !refreshedAfter401
      ) {
        refreshedAfter401 = true;
        token = await getAccessToken(connection, true);
        return await call(url);
      }
      throw error;
    }
  };
}

async function purgeGoogleHistory(businessId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(googleReviews)
    .where(eq(googleReviews.businessId, businessId));
  await db
    .delete(googleRatingSnapshots)
    .where(eq(googleRatingSnapshots.businessId, businessId));
}

async function setChosenLocation(
  connectionId: string,
  location: GoogleLocationOption,
  resetSyncClock: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(crmConnections)
    .set({
      externalLocationId: location.id,
      externalLocationName: location.name,
      lastErrorMessage: null,
      lastErrorAt: null,
      ...(resetSyncClock ? { lastEventAt: null } : {}),
    })
    .where(eq(crmConnections.id, connectionId));
}

// A connection saved while Google would not answer the accounts call (API
// access not approved yet) has a placeholder account id. Once Google answers,
// swap in the real account name. Returns an error message when that real
// account already belongs to a different UpTrend business.
async function resolvePendingAccount(
  connection: CrmConnection,
  accounts: GoogleAccount[],
): Promise<string | null> {
  if (!connection.externalAccountId.startsWith(PENDING_ACCOUNT_PREFIX)) {
    return null;
  }
  const primary = pickPrimaryAccount(accounts);
  if (!primary) return GOOGLE_MESSAGES.noAccounts;
  const existing = await findConnectionByExternalAccountId(
    PROVIDER,
    primary.name,
  );
  if (existing && existing.businessId !== connection.businessId) {
    return GOOGLE_MESSAGES.accountInUse;
  }
  await getDb()
    .update(crmConnections)
    .set({ externalAccountId: primary.name })
    .where(eq(crmConnections.id, connection.id));
  return null;
}

// -------------------------------------------------------- connect: callback

export type CompleteGoogleConnectionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string; redirectTo: string };

function failConnect(message: string): CompleteGoogleConnectionResult {
  return { ok: false, message, redirectTo: ERROR_DESTINATION };
}

function isUniqueViolation(error: unknown): boolean {
  const record = error as { code?: unknown; cause?: { code?: unknown } };
  return record?.code === "23505" || record?.cause?.code === "23505";
}

// The whole code-for-tokens handshake as a plain function so it can be tested
// without the framework. The server fn below only adds the session lookup.
export async function finishGoogleConnection(input: {
  code: string;
  state: string;
  sessionBusinessId: string | null;
}): Promise<CompleteGoogleConnectionResult> {
  if (!isGoogleConfigured()) return failConnect(GOOGLE_MESSAGES.notConfigured);

  const verified = verifyOAuthState(input.state, PROVIDER);
  if (!verified) return failConnect(GOOGLE_MESSAGES.stateInvalid);
  if (
    !input.sessionBusinessId ||
    input.sessionBusinessId !== verified.businessId
  ) {
    return failConnect(GOOGLE_MESSAGES.notSignedIn);
  }
  const businessId = verified.businessId;

  try {
    const tokens = await postToTokenEndpoint({
      code: input.code,
      client_id: process.env["GOOGLE_CLIENT_ID"] as string,
      client_secret: process.env["GOOGLE_CLIENT_SECRET"] as string,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    });
    // Owners can untick permissions on Google's consent screen.
    if (tokens.scope && !tokens.scope.split(" ").includes(SCOPE)) {
      return failConnect(GOOGLE_MESSAGES.scopeMissing);
    }
    // Without a refresh token the connection would die within the hour.
    if (!tokens.refresh_token)
      return failConnect(GOOGLE_MESSAGES.noRefreshToken);

    const previous = await loadConnection(businessId);
    const previousLocationId = previous?.externalLocationId ?? null;

    const get = makeAuthedGetter(null, tokens.access_token);

    let accounts: GoogleAccount[] = [];
    let notApprovedYet = false;
    try {
      accounts = await listAccounts(get);
    } catch (error) {
      if (!(error instanceof GoogleApiError)) throw error;
      const info = describeFailure(error, false);
      if (info.reason !== "not_approved") throw error;
      notApprovedYet = true;
    }

    let externalAccountId: string;
    if (notApprovedYet) {
      // The owner did the hard part (consent). Keep their authorization with a
      // placeholder account id; it is swapped for the real one as soon as
      // Google starts answering. One per business so it never collides.
      externalAccountId = `${PENDING_ACCOUNT_PREFIX}${businessId}`;
    } else {
      const primary = pickPrimaryAccount(accounts);
      if (!primary) return failConnect(GOOGLE_MESSAGES.noAccounts);
      externalAccountId = primary.name;
      const holder = await findConnectionByExternalAccountId(
        PROVIDER,
        externalAccountId,
      );
      if (holder && holder.businessId !== businessId) {
        return failConnect(GOOGLE_MESSAGES.accountInUse);
      }
    }

    try {
      await saveConnection(businessId, PROVIDER, {
        externalAccountId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokenExpiry(tokens.expires_in),
        scope: tokens.scope ?? SCOPE,
      });
    } catch (error) {
      // Lost a race with another business claiming the same Google account.
      if (isUniqueViolation(error))
        return failConnect(GOOGLE_MESSAGES.accountInUse);
      throw error;
    }

    const connection = await loadConnection(businessId);
    if (!connection) return failConnect(GOOGLE_MESSAGES.connectFailed);

    if (notApprovedYet) {
      await recordConnectionError(connection.id, GOOGLE_MESSAGES.notApproved);
      return { ok: true, redirectTo: SETTINGS_DESTINATION };
    }

    // Locations: restore the previous choice on a reconnect of the same
    // business, auto pick when there is exactly one, otherwise leave the
    // choice to the owner. Failures here never fail the connection itself.
    try {
      const locations = await listLocationsForAccounts(get, accounts);
      const restored = previousLocationId
        ? locations.find(
            (l) => locationKey(l.id) === locationKey(previousLocationId),
          )
        : undefined;
      if (restored) {
        // Same place as before: keep the documented history as it is.
        await setChosenLocation(connection.id, restored, false);
        await syncGoogleForBusiness(businessId);
      } else {
        if (previousLocationId) {
          // The new Google account does not manage the old location, so the
          // stored numbers describe a different business place.
          await purgeGoogleHistory(businessId);
        }
        const only = locations.length === 1 ? locations[0] : undefined;
        if (only) {
          await setChosenLocation(connection.id, only, true);
          await syncGoogleForBusiness(businessId);
        }
      }
    } catch (error) {
      if (error instanceof GoogleApiError) {
        await failFromError(connection, error);
      } else {
        console.error("[google] location step after connect failed", error);
      }
    }

    return { ok: true, redirectTo: SETTINGS_DESTINATION };
  } catch (error) {
    console.error("[google] failed to complete connection", error);
    return failConnect(GOOGLE_MESSAGES.connectFailed);
  }
}

const completeConnectionSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export const completeGoogleConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => completeConnectionSchema.parse(input))
  .handler(async ({ data }): Promise<CompleteGoogleConnectionResult> => {
    const sessionBusinessId = await getSessionBusinessId();
    return finishGoogleConnection({
      code: data.code,
      state: data.state,
      sessionBusinessId,
    });
  });

// ------------------------------------------------------------- locations

export type GoogleLocationsResult =
  | { ok: true; locations: GoogleLocationOption[] }
  | { ok: false; message: string };

// Shared by the listing and choosing paths: token, accounts, locations, with
// persistent failures recorded on the connection for the status to show.
async function fetchLocationsForConnection(
  connection: CrmConnection,
): Promise<
  | { ok: true; locations: GoogleLocationOption[] }
  | { ok: false; message: string }
> {
  try {
    const token = await getAccessToken(connection);
    const get = makeAuthedGetter(connection, token);
    const accounts = await listAccounts(get);
    const pendingProblem = await resolvePendingAccount(connection, accounts);
    if (pendingProblem) return { ok: false, message: pendingProblem };
    return {
      ok: true,
      locations: await listLocationsForAccounts(get, accounts),
    };
  } catch (error) {
    if (error instanceof GoogleApiError) {
      const failure = await failFromError(connection, error);
      return { ok: false, message: failure.message };
    }
    console.error("[google] listing locations failed", error);
    return { ok: false, message: GOOGLE_MESSAGES.generic };
  }
}

export async function listGoogleLocationsForBusiness(
  businessId: string,
): Promise<GoogleLocationsResult> {
  if (!isGoogleConfigured()) {
    return { ok: false, message: GOOGLE_MESSAGES.notConfigured };
  }
  const connection = await loadConnection(businessId);
  if (!connection) return { ok: false, message: GOOGLE_MESSAGES.noConnection };
  if (isReconnectMessage(connection.lastErrorMessage)) {
    return { ok: false, message: GOOGLE_MESSAGES.reconnect };
  }
  return fetchLocationsForConnection(connection);
}

export const listGoogleLocations = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoogleLocationsResult> => {
    if (!isGoogleConfigured()) {
      return { ok: false, message: GOOGLE_MESSAGES.notConfigured };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };
    return listGoogleLocationsForBusiness(businessId);
  },
);

export async function chooseGoogleLocationForBusiness(
  businessId: string,
  locationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isGoogleConfigured()) {
    return { ok: false, message: GOOGLE_MESSAGES.notConfigured };
  }
  if (!FULL_LOCATION_PATTERN.test(locationId)) {
    return {
      ok: false,
      message: "That location is not valid. Please pick one from the list.",
    };
  }
  const connection = await loadConnection(businessId);
  if (!connection) return { ok: false, message: GOOGLE_MESSAGES.noConnection };
  if (isReconnectMessage(connection.lastErrorMessage)) {
    return { ok: false, message: GOOGLE_MESSAGES.reconnect };
  }

  // Never trust the id from the browser: it must be one of the locations
  // Google itself lists for this owner. That also gives us Google's own title.
  const listed = await fetchLocationsForConnection(connection);
  if (!listed.ok) return listed;
  const match = listed.locations.find((l) => l.id === locationId);
  if (!match) {
    return {
      ok: false,
      message:
        "That location is not on your Google account. Please pick one from the list.",
    };
  }

  const previousLocationId = connection.externalLocationId;
  const switched =
    previousLocationId !== null &&
    locationKey(previousLocationId) !== locationKey(match.id);
  // Switching to a different place: the old reviews and rating history
  // describe another location, so they must not be mixed into the new one.
  if (switched) await purgeGoogleHistory(businessId);
  await setChosenLocation(connection.id, match, switched);

  // First sync right away so the dashboard has real numbers. Whatever Google
  // says is shown through the status, so the choice itself still succeeded.
  await syncGoogleForBusiness(businessId);
  return { ok: true };
}

export const chooseGoogleLocation = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ locationId: z.string().trim().min(1).max(300) }).parse(input),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true } | { ok: false; message: string }> => {
      const businessId = await getSessionBusinessId();
      if (!businessId) return { ok: false, message: "Not signed in." };
      return chooseGoogleLocationForBusiness(businessId, data.locationId);
    },
  );

// -------------------------------------------------------------------- sync

export type GoogleFailureReason =
  | "not_configured"
  | "not_connected"
  | "no_location"
  | "needs_reconnect"
  | "not_approved"
  | "rate_limited"
  | "error";

type GoogleSyncFailure = {
  ok: false;
  reason: GoogleFailureReason;
  message: string;
};

export type GoogleSyncResult =
  | {
      ok: true;
      newReviews: number;
      snapshot: "inserted" | "updated" | "none";
      // True when time or a Google hiccup stopped the paging early.
      partial: boolean;
    }
  | GoogleSyncFailure;

const STAR_VALUES: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

type MappedReview = {
  externalReviewId: string;
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  reviewedAt: Date;
};

// starRating arrives as an enum word (ONE to FIVE). Reviews that cannot be
// placed (unknown rating, no id, no usable date) are skipped, never guessed.
function mapGoogleReview(raw: unknown): MappedReview | null {
  const r = asRecord(raw);
  const star = STAR_VALUES[String(r["starRating"])];
  if (!star) return null;
  let id = asString(r["reviewId"]);
  if (!id) {
    const name = asString(r["name"]);
    id = name ? (name.split("/").pop() ?? null) : null;
  }
  if (!id) return null;
  const when = new Date(String(r["createTime"] ?? r["updateTime"] ?? ""));
  if (Number.isNaN(when.getTime())) return null;
  const reviewer = asRecord(r["reviewer"]);
  const anonymous = reviewer["isAnonymous"] === true;
  return {
    externalReviewId: id,
    reviewerName: anonymous ? null : asString(reviewer["displayName"]),
    starRating: star,
    comment: asString(r["comment"]),
    reviewedAt: when,
  };
}

// ---- time zone helpers (Intl only, no dependency) ----

function safeTimeZone(timeZone: string | null | undefined): string {
  const candidate =
    timeZone && timeZone.length > 0 ? timeZone : DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

type Civil = { y: number; m: number; d: number };

// The calendar date this instant falls on in the given zone.
function civilDate(instant: Date, timeZone: string): Civil {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
    formatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const pick = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: pick("year"), m: pick("month"), d: pick("day") };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const dateKey = (c: Civil): string => `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;
const monthKey = (c: Civil): string => `${c.y}-${pad2(c.m)}`;

function addDays(c: Civil, days: number): Civil {
  const t = new Date(Date.UTC(c.y, c.m - 1, c.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Weeks start on Monday.
function mondayOf(c: Civil): Civil {
  const weekday = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay(); // 0 = Sunday
  return addDays(c, -((weekday + 6) % 7));
}

// ---- snapshots ----

// At most one snapshot row per local day. A second sync on the same day does
// not add a row; it refreshes that day's row so the dashboard never shows a
// total that is older than the reviews listed beside it.
async function recordDailySnapshot(
  businessId: string,
  timeZone: string,
  rating: number,
  totalReviews: number,
  now: Date,
): Promise<"inserted" | "updated"> {
  const db = getDb();
  const today = dateKey(civilDate(now, timeZone));
  // 48 hours always covers "today" in any zone.
  const recent = await db
    .select()
    .from(googleRatingSnapshots)
    .where(
      and(
        eq(googleRatingSnapshots.businessId, businessId),
        gte(
          googleRatingSnapshots.takenAt,
          new Date(now.getTime() - 2 * DAY_MS),
        ),
      ),
    )
    .orderBy(desc(googleRatingSnapshots.takenAt));
  const existing = recent.find(
    (s) => dateKey(civilDate(s.takenAt, timeZone)) === today,
  );
  if (existing) {
    if (existing.rating !== rating || existing.totalReviews !== totalReviews) {
      await db
        .update(googleRatingSnapshots)
        .set({ rating, totalReviews })
        .where(eq(googleRatingSnapshots.id, existing.id));
    }
    return "updated";
  }
  await db
    .insert(googleRatingSnapshots)
    .values({ businessId, takenAt: now, rating, totalReviews });
  return "inserted";
}

async function countStoredReviews(businessId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(googleReviews)
    .where(eq(googleReviews.businessId, businessId));
  return row?.n ?? 0;
}

// Pulls the owner's real reviews and rating and stores them. Never throws:
// every outcome comes back as a result the caller can show or ignore.
export async function syncGoogleForBusiness(
  businessId: string,
  options: { deadline?: number } = {},
): Promise<GoogleSyncResult> {
  try {
    return await runSync(
      businessId,
      options.deadline ?? Date.now() + DEFAULT_SYNC_BUDGET_MS,
    );
  } catch (error) {
    console.error("[google] sync crashed", error);
    return { ok: false, reason: "error", message: GOOGLE_MESSAGES.generic };
  }
}

async function runSync(
  businessId: string,
  deadline: number,
): Promise<GoogleSyncResult> {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: GOOGLE_MESSAGES.notConfigured,
    };
  }
  const connection = await loadConnection(businessId);
  if (!connection) {
    return {
      ok: false,
      reason: "not_connected",
      message: GOOGLE_MESSAGES.noConnection,
    };
  }
  const locationId = connection.externalLocationId;
  if (!locationId || !FULL_LOCATION_PATTERN.test(locationId)) {
    return {
      ok: false,
      reason: "no_location",
      message: GOOGLE_MESSAGES.noLocation,
    };
  }
  // A dead refresh token stays dead until the owner reconnects, so do not keep
  // asking Google.
  if (isReconnectMessage(connection.lastErrorMessage)) {
    return {
      ok: false,
      reason: "needs_reconnect",
      message: GOOGLE_MESSAGES.reconnect,
    };
  }

  const db = getDb();
  const [businessRow] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const timeZone = safeTimeZone(businessRow?.timezone);

  // First sync: the whole back catalogue arrives at once. Those reviews were
  // posted long ago, so first_seen_at is their own posted date, which keeps
  // "new since yesterday" from counting years of history as new. A sync that
  // never finished (lastEventAt still empty) counts as first, so the rest of
  // the back catalogue is backdated the same way.
  const isFirstSync =
    (await countStoredReviews(businessId)) === 0 ||
    connection.lastEventAt === null;

  let averageRating: number | null = null;
  let totalReviewCount: number | null = null;
  let newReviews = 0;
  let partial = false;

  try {
    const token = await getAccessToken(connection);
    const get = makeAuthedGetter(connection, token, deadline);

    let pageToken: string | null = null;
    for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
      if (page > 0 && Date.now() > deadline - 500) {
        partial = true;
        break;
      }
      const url = new URL(`${REVIEWS_BASE}/${locationId}/reviews`);
      url.searchParams.set("pageSize", String(REVIEWS_PAGE_SIZE));
      url.searchParams.set("orderBy", "updateTime desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      let body: Record<string, unknown>;
      try {
        body = asRecord(await get(url.toString()));
      } catch (error) {
        // The first page failing is a real failure. Later pages failing just
        // means we keep what we already have and try again next time.
        if (page === 0) throw error;
        console.error("[google] later reviews page failed", error);
        partial = true;
        break;
      }

      if (page === 0) {
        const average = Number(body["averageRating"]);
        const total = Number(body["totalReviewCount"]);
        averageRating =
          body["averageRating"] !== undefined &&
          Number.isFinite(average) &&
          average >= 1 &&
          average <= 5
            ? average
            : null;
        totalReviewCount =
          body["totalReviewCount"] !== undefined &&
          Number.isInteger(total) &&
          total >= 0
            ? total
            : null;
      }

      const now = new Date();
      const rows = (Array.isArray(body["reviews"]) ? body["reviews"] : [])
        .map(mapGoogleReview)
        .filter((r): r is MappedReview => r !== null)
        .map((r) => ({
          businessId,
          externalReviewId: r.externalReviewId,
          reviewerName: r.reviewerName,
          starRating: r.starRating,
          comment: r.comment,
          reviewedAt: r.reviewedAt,
          firstSeenAt: isFirstSync && r.reviewedAt <= now ? r.reviewedAt : now,
        }));
      if (rows.length > 0) {
        const inserted = await db
          .insert(googleReviews)
          .values(rows)
          .onConflictDoNothing({
            target: [googleReviews.businessId, googleReviews.externalReviewId],
          })
          .returning({ id: googleReviews.id });
        newReviews += inserted.length;
      }

      pageToken = asString(body["nextPageToken"]);
      if (!pageToken) break;
      // New reviews always sit at the top (newest update first). Once we hold
      // at least as many reviews as Google says exist, the rest is known.
      if (
        totalReviewCount !== null &&
        (await countStoredReviews(businessId)) >= totalReviewCount
      ) {
        break;
      }
    }
  } catch (error) {
    if (error instanceof GoogleApiError)
      return failFromError(connection, error);
    throw error;
  }

  const now = new Date();
  let snapshot: "inserted" | "updated" | "none" = "none";
  if (averageRating !== null && totalReviewCount !== null) {
    snapshot = await recordDailySnapshot(
      businessId,
      timeZone,
      averageRating,
      totalReviewCount,
      now,
    );
  }

  // A first sync that ran out of time stays "unfinished" (no lastEventAt), so
  // the next run keeps backdating the rest of the catalogue instead of calling
  // it new.
  const finished = !(isFirstSync && partial);
  await db
    .update(crmConnections)
    .set({
      lastErrorMessage: null,
      lastErrorAt: null,
      ...(finished ? { lastEventAt: now } : {}),
    })
    .where(eq(crmConnections.id, connection.id));

  return { ok: true, newReviews, snapshot, partial };
}

// ------------------------------------------------------------ refresh now

export async function refreshGoogleForBusiness(
  businessId: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isGoogleConfigured()) {
    return { ok: false, message: GOOGLE_MESSAGES.notConfigured };
  }
  const connection = await loadConnection(businessId);
  if (!connection) return { ok: false, message: GOOGLE_MESSAGES.noConnection };
  if (!connection.externalLocationId) {
    return { ok: false, message: GOOGLE_MESSAGES.noLocation };
  }
  if (isReconnectMessage(connection.lastErrorMessage)) {
    return { ok: false, message: GOOGLE_MESSAGES.reconnect };
  }

  // Once per 10 minutes, counting failed tries too so a broken connection is
  // not hammered by repeated presses.
  const lastTouch = Math.max(
    connection.lastEventAt?.getTime() ?? 0,
    connection.lastErrorAt?.getTime() ?? 0,
  );
  const sinceMs = now.getTime() - lastTouch;
  if (lastTouch > 0 && sinceMs < REFRESH_RATE_LIMIT_MS) {
    if (
      connection.lastErrorMessage &&
      (connection.lastErrorAt?.getTime() ?? 0) >=
        (connection.lastEventAt?.getTime() ?? 0)
    ) {
      return { ok: false, message: connection.lastErrorMessage };
    }
    const minutes = Math.max(
      1,
      Math.ceil((REFRESH_RATE_LIMIT_MS - sinceMs) / 60000),
    );
    return {
      ok: false,
      message: `Your Google numbers were just refreshed. Please try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    };
  }

  const result = await syncGoogleForBusiness(businessId);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export const refreshGoogleNow = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!isGoogleConfigured()) {
      return { ok: false, message: GOOGLE_MESSAGES.notConfigured };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };
    return refreshGoogleForBusiness(businessId);
  },
);

// -------------------------------------------------------------------- cron

// Copied from reviews.server.ts (which another engineer owns): Vercel signs
// scheduled requests with CRON_SECRET as a Bearer token.
export function isGoogleCronAuthorized(
  authorizationHeader: string | undefined,
): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected || !authorizationHeader) return false;
  const given = Buffer.from(authorizationHeader);
  const wanted = Buffer.from(`Bearer ${expected}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export type GoogleCronSummary = {
  ok: true;
  synced: number;
  skipped: number;
  failed: number;
  // Connections that were due but did not fit in this run's time budget (or
  // were held back by a Google rate limit). Oldest-synced go first, so they
  // lead the queue next time.
  deferred: number;
  dormant?: true;
};

// Syncs every connection that has a chosen location, oldest-synced first,
// skipping ones synced in the last 20 hours, inside a time budget because
// Vercel Hobby functions are short lived.
export async function runGoogleSyncBatch(
  options: { budgetMs?: number; freshMs?: number } = {},
): Promise<GoogleCronSummary> {
  const budgetMs = options.budgetMs ?? DEFAULT_SYNC_BUDGET_MS;
  const freshMs = options.freshMs ?? CRON_FRESH_MS;
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const summary: GoogleCronSummary = {
    ok: true,
    synced: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
  if (!isGoogleConfigured()) return { ...summary, dormant: true };

  const rows = await getDb()
    .select({
      businessId: crmConnections.businessId,
      lastEventAt: crmConnections.lastEventAt,
      lastErrorMessage: crmConnections.lastErrorMessage,
    })
    .from(crmConnections)
    .innerJoin(businesses, eq(businesses.id, crmConnections.businessId))
    .where(
      and(
        eq(crmConnections.provider, PROVIDER),
        isNotNull(crmConnections.externalLocationId),
        // A cancelled client should not keep using Google quota.
        eq(businesses.accessRevoked, false),
      ),
    )
    // Postgres sorts nulls last by default; never-synced ones go first.
    .orderBy(sql`${crmConnections.lastEventAt} asc nulls first`);

  let stop = false;
  for (const row of rows) {
    if (isReconnectMessage(row.lastErrorMessage)) {
      summary.skipped++;
      continue;
    }
    if (row.lastEventAt && startedAt - row.lastEventAt.getTime() < freshMs) {
      summary.skipped++;
      continue;
    }
    // Not enough time left to start another one safely.
    if (stop || deadline - Date.now() < 1500) {
      summary.deferred++;
      continue;
    }
    const result = await syncGoogleForBusiness(row.businessId, { deadline });
    if (result.ok) {
      summary.synced++;
    } else {
      summary.failed++;
      // Google's limit is per project, so more calls would only be refused.
      if (result.reason === "rate_limited") stop = true;
    }
  }
  return summary;
}

export type GoogleCronResult =
  GoogleCronSummary | { ok: false; reason: "unauthorized" };

// Entry point for the /cron/google-sync route's loader. A server fn so the
// request header and status helpers stay out of the client bundle.
export const runGoogleSyncCron = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoogleCronResult> => {
    if (!isGoogleCronAuthorized(getRequestHeader("authorization"))) {
      setResponseStatus(401);
      return { ok: false, reason: "unauthorized" };
    }
    const summary = await runGoogleSyncBatch();
    setResponseStatus(200);
    return summary;
  },
);

// ------------------------------------------------------------------ status

export async function getGoogleStatusForBusiness(
  businessId: string,
): Promise<GoogleStatus> {
  const status: GoogleStatus = {
    configured: isGoogleConfigured(),
    connected: false,
    needsReconnect: false,
    awaitingLocation: false,
    locationName: null,
    lastSyncedAt: null,
    errorMessage: null,
  };
  if (!isCrmFrameworkConfigured()) return status;
  const connection = await loadConnection(businessId);
  if (!connection) return status;
  return {
    ...status,
    connected: true,
    needsReconnect: isReconnectMessage(connection.lastErrorMessage),
    awaitingLocation: !connection.externalLocationId,
    locationName: connection.externalLocationName,
    lastSyncedAt: connection.lastEventAt
      ? connection.lastEventAt.toISOString()
      : null,
    errorMessage: connection.lastErrorMessage,
  };
}

export const getGoogleStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoogleStatus> => {
    const businessId = isCrmFrameworkConfigured()
      ? await getSessionBusinessId()
      : null;
    if (!businessId) {
      return {
        configured: isGoogleConfigured(),
        connected: false,
        needsReconnect: false,
        awaitingLocation: false,
        locationName: null,
        lastSyncedAt: null,
        errorMessage: null,
      };
    }
    return getGoogleStatusForBusiness(businessId);
  },
);

// ----------------------------------------------------------------- summary

// Real stored Google data for the dashboard, computed only from rows our own
// syncs saved, in the BUSINESS's time zone. Returns EMPTY_GOOGLE_SUMMARY when
// nothing is connected or nothing has been stored yet.
export async function getGoogleSummary(
  businessId: string,
  now: Date = new Date(),
): Promise<GoogleSummary> {
  const db = getDb();
  const connection = await loadConnection(businessId);
  if (!connection || !connection.externalLocationId)
    return EMPTY_GOOGLE_SUMMARY;

  const [businessRow] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const timeZone = safeTimeZone(businessRow?.timezone);

  const yearAgo = new Date(now.getTime() - 380 * DAY_MS);
  const [snapshots, yearReviews, recent, newRows] = await Promise.all([
    db
      .select({
        takenAt: googleRatingSnapshots.takenAt,
        rating: googleRatingSnapshots.rating,
        totalReviews: googleRatingSnapshots.totalReviews,
      })
      .from(googleRatingSnapshots)
      .where(eq(googleRatingSnapshots.businessId, businessId))
      .orderBy(googleRatingSnapshots.takenAt),
    db
      .select({ reviewedAt: googleReviews.reviewedAt })
      .from(googleReviews)
      .where(
        and(
          eq(googleReviews.businessId, businessId),
          gte(googleReviews.reviewedAt, yearAgo),
        ),
      ),
    db
      .select()
      .from(googleReviews)
      .where(eq(googleReviews.businessId, businessId))
      .orderBy(desc(googleReviews.reviewedAt))
      .limit(10),
    db
      .select({ n: count() })
      .from(googleReviews)
      .where(
        and(
          eq(googleReviews.businessId, businessId),
          gte(googleReviews.firstSeenAt, new Date(now.getTime() - DAY_MS)),
        ),
      ),
  ]);

  // Connected only once a sync really stored something.
  if (snapshots.length === 0 && recent.length === 0)
    return EMPTY_GOOGLE_SUMMARY;

  const latest = snapshots[snapshots.length - 1];
  const oldest = snapshots[0];

  // Rating change over about 90 days: needs a history of at least 30 days.
  let ratingChange90d: number | null = null;
  if (
    latest &&
    oldest &&
    now.getTime() - oldest.takenAt.getTime() >= 30 * DAY_MS
  ) {
    const target = now.getTime() - 90 * DAY_MS;
    let nearest = oldest;
    for (const s of snapshots) {
      if (
        Math.abs(s.takenAt.getTime() - target) <
        Math.abs(nearest.takenAt.getTime() - target)
      ) {
        nearest = s;
      }
    }
    // If the closest reading is the latest one itself there is nothing older
    // to compare against.
    if (nearest !== latest) {
      ratingChange90d =
        Math.round((latest.rating - nearest.rating) * 100) / 100;
    }
  }

  // One point per local date (the last reading of that day), last 90 days.
  const historyByDate = new Map<string, number>();
  const historyFrom = now.getTime() - 90 * DAY_MS;
  for (const s of snapshots) {
    if (s.takenAt.getTime() < historyFrom) continue;
    historyByDate.set(dateKey(civilDate(s.takenAt, timeZone)), s.rating);
  }
  const ratingHistory = [...historyByDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, rating]) => ({ date, rating }));

  // Month and week buckets, by the date the reviewer posted, in the
  // business's own time zone.
  const today = civilDate(now, timeZone);
  const thisMonth = monthKey(today);
  const lastMonth = monthKey(
    today.m === 1
      ? { y: today.y - 1, m: 12, d: 1 }
      : { y: today.y, m: today.m - 1, d: 1 },
  );
  const currentMonday = mondayOf(today);
  const weekCounts = new Map<string, number>();
  for (let i = 51; i >= 0; i--) {
    weekCounts.set(dateKey(addDays(currentMonday, -7 * i)), 0);
  }
  let reviewsThisMonth = 0;
  let reviewsLastMonth = 0;
  for (const r of yearReviews) {
    const local = civilDate(r.reviewedAt, timeZone);
    const m = monthKey(local);
    if (m === thisMonth) reviewsThisMonth++;
    else if (m === lastMonth) reviewsLastMonth++;
    const weekKey = dateKey(mondayOf(local));
    const existing = weekCounts.get(weekKey);
    if (existing !== undefined) weekCounts.set(weekKey, existing + 1);
  }

  return {
    connected: true,
    rating: latest ? latest.rating : null,
    totalReviews: latest ? latest.totalReviews : null,
    ratingChange90d,
    reviewsThisMonth,
    reviewsLastMonth,
    newSinceYesterday: newRows[0]?.n ?? 0,
    weeklyCounts: [...weekCounts.entries()].map(([weekStart, c]) => ({
      weekStart,
      count: c,
    })),
    ratingHistory,
    lastSyncedAt: connection.lastEventAt,
    recentReviews: recent.map((r) => ({
      id: r.id,
      reviewerName: r.reviewerName,
      starRating: r.starRating,
      comment: r.comment,
      reviewedAt: r.reviewedAt,
    })),
  };
}
