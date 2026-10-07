// Jobber OAuth connect flow + webhook handling. Jobber is a field-service/
// invoicing tool popular with home-service contractors; see
// developer.getjobber.com. Jobber-specific facts worth remembering (checked
// against Jobber's developer docs):
//   - Access tokens expire after 3600 seconds (60 minutes), refreshed lazily
//     on use. The token response carries access_token, refresh_token,
//     token_type and expires_in.
//   - Refresh tokens ROTATE on every refresh, with no grace period: the old
//     one is dead the moment a new one is issued. A failed persist after a
//     successful refresh call permanently breaks the connection until the
//     business reconnects, and two overlapping refreshes make one of them
//     fail. Jobber's own advice is to re-check the token store before
//     refreshing; getValidJobberAccessToken does that.
//   - The account id comes from the GraphQL `account { id }` query, and is
//     what webhooks carry as accountId.
//   - invoiceStatus is the GraphQL enum InvoiceStatusTypeEnum. Its values are
//     lower case (the changelog shows `voided` being added in 2026-05-12),
//     so "paid" is compared case-insensitively.
//   - Webhooks must be answered within 1 SECOND; Jobber's docs say to
//     acknowledge at once and process in the background. Delivery is at
//     least once, and one user action can fire the same topic more than once
//     (adding a payment fires INVOICE_UPDATE twice). Jobber may disable an
//     app's webhooks if responses are consistently slow or often errors.
//
// Webhook payloads are thin ({topic, accountId, itemId, occurredAt} only,
// wrapped in data.webHookEvent) -- there's no invoice/client data inline, so
// handling a webhook means a follow-up GraphQL call to resolve what actually
// happened.
//
// NOT verifiable from Jobber's public docs (no schema reference page is
// published; confirm in the GraphiQL explorer once a real developer app
// exists): the exact field names `companyName` on Client and `smsAllowed`
// on a phone number. Both are seen in working third-party Jobber queries. If
// Jobber rejects either, the lookup is retried without them (see
// fetchJobberInvoice) so the pipeline keeps working.

import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  createOAuthState,
  getSessionBusinessId,
  verifyOAuthState,
} from "../auth.server";
import { getDb } from "../db/client";
import { businesses } from "../db/schema";
import { normalizeUsPhone } from "../messaging.server";
import { CANONICAL_SITE_URL } from "../site";
import {
  claimWebhookEvent,
  decryptAccessToken,
  decryptRefreshToken,
  deliverPaidInvoiceRequest,
  findConnectionByExternalAccountId,
  getBackgroundScheduler,
  getConnectionById,
  isCrmFrameworkConfigured,
  isWebhookEventDone,
  recordConnectionError,
  recordSkippedWebhookEvent,
  resolveContactName,
  saveConnection,
  updateConnectionTokens,
  webhookJson,
  type CrmWebhookProvider,
  type PaidInvoiceContact,
} from "./connections.server";
import type { CrmConnection } from "../db/schema";

const PROVIDER: CrmWebhookProvider = "jobber";
const AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
// Jobber requires every GraphQL request to declare which API version it
// expects. Jobber supports a version for at least 12 months and removes old
// ones in batches, so re-check developer.getjobber.com/docs/changelog before
// going live and now and then after; this is a point-in-time value.
const JOBBER_API_VERSION = "2025-01-20";
const REDIRECT_URI = `${CANONICAL_SITE_URL}/connect/jobber/callback`;
// Refresh with 5 minutes of headroom before the ~60-minute token actually expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Jobber's documented access token lifetime, used when a token response
// leaves expires_in out. Treating a missing value as "no expiry" would keep a
// dead token in use for ever.
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

function expiryFrom(expiresInSeconds: number | undefined): Date {
  const seconds =
    typeof expiresInSeconds === "number" && expiresInSeconds > 0
      ? expiresInSeconds
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return new Date(Date.now() + seconds * 1000);
}

export function isJobberConfigured(): boolean {
  return (
    Boolean(
      process.env["JOBBER_CLIENT_ID"] && process.env["JOBBER_CLIENT_SECRET"],
    ) && isCrmFrameworkConfigured()
  );
}

// ---- OAuth: connect ------------------------------------------------------

export type AuthorizeUrlResult =
  { ok: true; url: string } | { ok: false; message: string };

export const getJobberAuthorizeUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthorizeUrlResult> => {
    if (!isJobberConfigured()) {
      return {
        ok: false,
        message: "Jobber isn't switched on yet. Check back soon.",
      };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };

    const state = createOAuthState(businessId, PROVIDER);
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set(
      "client_id",
      process.env["JOBBER_CLIENT_ID"] as string,
    );
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);

    return { ok: true, url: url.toString() };
  },
);

type JobberTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

async function exchangeJobberCode(code: string): Promise<JobberTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env["JOBBER_CLIENT_ID"] as string,
      client_secret: process.env["JOBBER_CLIENT_SECRET"] as string,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Jobber token exchange failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as JobberTokenResponse;
}

// GraphQL answers HTTP 200 with an `errors` list when a query is rejected, so
// the list is kept on the error for callers that care what exactly was wrong.
class JobberGraphqlError extends Error {
  messages: string[];
  constructor(errors: unknown) {
    const messages = Array.isArray(errors)
      ? errors.map((e) =>
          typeof (e as { message?: unknown })?.message === "string"
            ? (e as { message: string }).message
            : JSON.stringify(e),
        )
      : [String(errors)];
    super(`Jobber GraphQL returned errors: ${messages.join(" | ")}`);
    this.name = "JobberGraphqlError";
    this.messages = messages;
  }
}

async function jobberGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Jobber GraphQL request failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (body.errors) throw new JobberGraphqlError(body.errors);
  if (!body.data) throw new Error("Jobber GraphQL returned no data.");
  return body.data;
}

const ACCOUNT_QUERY = `query { account { id } }`;

async function resolveJobberAccountId(accessToken: string): Promise<string> {
  const data = await jobberGraphql<{ account: { id: string } }>(
    accessToken,
    ACCOUNT_QUERY,
    {},
  );
  return data.account.id;
}

const completeConnectionSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export type CompleteConnectionResult =
  { ok: true } | { ok: false; message: string };

export const completeJobberConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => completeConnectionSchema.parse(input))
  .handler(async ({ data }): Promise<CompleteConnectionResult> => {
    if (!isJobberConfigured()) {
      return {
        ok: false,
        message: "Jobber isn't switched on yet. Check back soon.",
      };
    }

    const verified = verifyOAuthState(data.state, PROVIDER);
    if (!verified) {
      return {
        ok: false,
        message:
          "That connection link expired or was invalid. Please try again.",
      };
    }
    const sessionBusinessId = await getSessionBusinessId();
    if (!sessionBusinessId || sessionBusinessId !== verified.businessId) {
      return {
        ok: false,
        message: "Please sign in and try connecting Jobber again.",
      };
    }

    try {
      const tokens = await exchangeJobberCode(data.code);
      const accountId = await resolveJobberAccountId(tokens.access_token);

      await saveConnection(verified.businessId, PROVIDER, {
        externalAccountId: accountId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: expiryFrom(tokens.expires_in),
        scope: tokens.scope ?? null,
      });

      return { ok: true };
    } catch (error) {
      console.error("[jobber] failed to complete connection", error);
      return {
        ok: false,
        message: "Couldn't connect to Jobber. Please try again.",
      };
    }
  });


// ---- Token refresh ---------------------------------------------------

async function refreshJobberToken(
  refreshToken: string,
): Promise<JobberTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env["JOBBER_CLIENT_ID"] as string,
      client_secret: process.env["JOBBER_CLIENT_SECRET"] as string,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Jobber token refresh failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as JobberTokenResponse;
}

export type ValidTokenResult =
  { ok: true; accessToken: string } | { ok: false; message: string };

function needsRefresh(connection: CrmConnection): boolean {
  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? 0;
  return expiresAt - Date.now() < REFRESH_MARGIN_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Saves the rotated tokens, trying a few times: the refresh token Jobber just
// issued exists nowhere else, so losing it to one database hiccup would break
// the connection for good. Returns false only if every attempt failed.
async function persistRotatedTokens(
  connectionId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await updateConnectionTokens(
        connectionId,
        accessToken,
        refreshToken,
        expiresAt,
      );
      return true;
    } catch (error) {
      console.error(
        `[jobber] could not save the rotated tokens (attempt ${attempt} of 3)`,
        error,
      );
      if (attempt < 3) await sleep(250 * attempt);
    }
  }
  return false;
}

// Lazy refresh: only refreshes when the token is actually about to be used
// and is near expiry, rather than on a schedule.
//
// Two webhooks often arrive together (Jobber fires INVOICE_UPDATE twice for a
// payment), and both can find the same token expired. Because each refresh
// kills the previous refresh token, whichever calls Jobber second would be
// told its token is dead and wrongly flag the connection as broken. So:
//   1. Before refreshing, read the row again. If another request already
//      stored a fresh token, use that and do not refresh at all.
//   2. If the refresh call fails, look at the row once more (the winner may
//      be a moment from saving) before concluding the connection is broken.
export async function getValidJobberAccessToken(
  connection: CrmConnection,
): Promise<ValidTokenResult> {
  if (!needsRefresh(connection)) {
    return { ok: true, accessToken: decryptAccessToken(connection) };
  }

  const latest = (await getConnectionById(connection.id)) ?? connection;
  if (
    latest.accessTokenCiphertext !== connection.accessTokenCiphertext &&
    !needsRefresh(latest)
  ) {
    return { ok: true, accessToken: decryptAccessToken(latest) };
  }

  // From here on use the freshest row: its refresh token is the live one.
  const refreshToken = decryptRefreshToken(latest);
  if (!refreshToken) {
    await recordConnectionError(
      connection.id,
      "No refresh token on file. Please reconnect.",
    );
    return {
      ok: false,
      message: "No refresh token on file. Please reconnect.",
    };
  }

  let tokens: JobberTokenResponse;
  try {
    tokens = await refreshJobberToken(refreshToken);
  } catch (error) {
    console.error("[jobber] token refresh failed", error);

    // Did a concurrent request win the race and burn our refresh token?
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(400);
      const again = await getConnectionById(connection.id);
      if (
        again &&
        again.accessTokenCiphertext !== latest.accessTokenCiphertext &&
        !needsRefresh(again)
      ) {
        return { ok: true, accessToken: decryptAccessToken(again) };
      }
    }

    await recordConnectionError(
      connection.id,
      "Jobber access expired and couldn't be refreshed. Please reconnect.",
    );
    return {
      ok: false,
      message: "Jobber access expired. Please reconnect.",
    };
  }

  // Jobber ROTATES the refresh token on every use -- persisting the new one
  // is not optional, the old one is already dead. (If rotation were ever off
  // the response has no refresh_token and the old one stays valid.)
  const saved = await persistRotatedTokens(
    connection.id,
    tokens.access_token,
    tokens.refresh_token ?? refreshToken,
    expiryFrom(tokens.expires_in),
  );
  if (!saved) {
    await recordConnectionError(
      connection.id,
      "Jobber access could not be saved. Please reconnect.",
    );
  }
  // The new access token is still good for this request either way.
  return { ok: true, accessToken: tokens.access_token };
}

// ---- Webhook ---------------------------------------------------------

export function isJobberWebhookConfigured(): boolean {
  return isJobberConfigured();
}

// Jobber has no separate webhook signing secret -- the app's own Client
// Secret is the HMAC key (per Jobber's webhook docs).
export function verifyJobberWebhookSignature(
  rawBody: string,
  header: string | null,
): boolean {
  if (!header) return false;
  const secret = process.env["JOBBER_CLIENT_SECRET"];
  if (!secret) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");
  const headerBuf = Buffer.from(header, "base64");
  if (expectedBuf.length !== headerBuf.length) return false;
  return timingSafeEqual(expectedBuf, headerBuf);
}

type JobberWebhookEvent = {
  topic: string;
  appId?: string;
  accountId: string;
  itemId: string;
  occurredAt: string;
};

type JobberWebhookPayload = {
  data?: { webHookEvent?: Partial<JobberWebhookEvent> };
};

// Topics that mean "an invoice's status may have changed" -- the only ones
// worth a follow-up query. Jobber has no dedicated INVOICE_PAID topic;
// paid-ness is read off the invoice itself after an INVOICE_UPDATE (which
// fires on every edit, and twice when a payment is added).
const INVOICE_TOPICS = new Set(["INVOICE_UPDATE"]);

const INVOICE_QUERY = `
  query GetInvoice($id: EncodedId!) {
    invoice(id: $id) {
      id
      invoiceStatus
      client {
        id
        firstName
        lastName
        companyName
        phones { number primary smsAllowed }
        emails { address primary }
      }
    }
  }
`;

// Same query without the two fields that could not be verified against
// Jobber's public docs (the company name and the text-consent flag), used only
// if Jobber rejects one of them (see the header note).
const INVOICE_QUERY_MINIMAL = INVOICE_QUERY.replace(
  "phones { number primary smsAllowed }",
  "phones { number primary }",
).replace("        companyName\n", "");

type JobberPhone = {
  number: string;
  primary: boolean;
  // Jobber's per-number "this client agreed to receive texts" flag. Absent
  // when the fallback query had to be used; absent counts as allowed.
  smsAllowed?: boolean | null;
};

type JobberClient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  phones: JobberPhone[];
  emails: Array<{ address: string; primary: boolean }>;
};

type JobberInvoiceQueryResult = {
  invoice: {
    id: string;
    invoiceStatus: string;
    client: JobberClient | null;
  } | null;
};

async function fetchJobberInvoice(
  accessToken: string,
  invoiceId: string,
): Promise<JobberInvoiceQueryResult["invoice"]> {
  try {
    const data = await jobberGraphql<JobberInvoiceQueryResult>(
      accessToken,
      INVOICE_QUERY,
      { id: invoiceId },
    );
    return data.invoice;
  } catch (error) {
    if (
      error instanceof JobberGraphqlError &&
      error.messages.some(
        (message) =>
          message.includes("smsAllowed") || message.includes("companyName"),
      )
    ) {
      console.error(
        "[jobber-webhook] Jobber rejected the smsAllowed or companyName field; continuing without text-consent checks and company-name fallback. Verify the field names in Jobber's GraphiQL explorer.",
      );
      const data = await jobberGraphql<JobberInvoiceQueryResult>(
        accessToken,
        INVOICE_QUERY_MINIMAL,
        { id: invoiceId },
      );
      return data.invoice;
    }
    throw error;
  }
}

// Jobber invoiceStatus values are lower case (paid, awaiting_payment,
// past_due, draft, bad_debt, voided); compare case-insensitively so a change
// of casing can never silently turn the whole pipeline off.
function isPaidStatus(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "paid";
}

// Picks which number to text, respecting Jobber's SMS consent flag where it
// is available: a number the client has not agreed to be texted on is never
// used, and the event row says why.
function pickJobberPhone(phones: JobberPhone[]): {
  phone: string | null;
  note: string | null;
} {
  const ordered = [...phones].sort(
    (a, b) => Number(b.primary) - Number(a.primary),
  );
  const consenting = ordered.filter((p) => p.smsAllowed !== false);
  if (ordered.length > 0 && consenting.length === 0) {
    return {
      phone: null,
      note: "Jobber shows this client has not agreed to text messages, so no text was sent",
    };
  }
  // Prefer a number that will actually pass validation; if none will, hand
  // over the first so the event row can report the invalid number.
  const usable = consenting.find((p) => normalizeUsPhone(p.number));
  return { phone: (usable ?? consenting[0])?.number ?? null, note: null };
}

function pickJobberEmail(client: JobberClient): string | null {
  return (
    (client.emails ?? []).find((e) => e.primary)?.address ??
    client.emails?.[0]?.address ??
    null
  );
}

type WebhookOutcome = { status: number; body: Record<string, unknown> };

function outcome(
  status: number,
  body: Record<string, unknown>,
): WebhookOutcome {
  return { status, body };
}

// Everything after "the signature is good and this is an invoice update".
// Never throws; returns what to tell Jobber (used when answering after the
// work, and only logged when the answer already went out).
//
// Order is chosen to be cheap first and to claim only once we know there is
// something to claim: connection, account status, "already handled?" read,
// token, invoice lookup, and only then the per-invoice claim. Updates for
// invoices that are not paid yet (the vast majority) never write to the
// events table.
async function processJobberInvoiceUpdate(
  event: JobberWebhookEvent,
): Promise<WebhookOutcome> {
  try {
    const db = getDb();

    const connection = await findConnectionByExternalAccountId(
      PROVIDER,
      event.accountId,
    );
    if (!connection) {
      // No business has this Jobber account connected (any more) -- nothing
      // to do, and retrying won't change that.
      return outcome(200, { ok: true, reason: "no_connection" });
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, connection.businessId))
      .limit(1);
    if (!business) return outcome(200, { ok: true, reason: "no_business" });

    // A canceled client must not message anyone. Checked before spending a
    // Jobber API call; the row records why nothing happened.
    if (business.accessRevoked) {
      await recordSkippedWebhookEvent({
        provider: PROVIDER,
        dedupeKey: `skipped-inactive:${event.topic}:${event.itemId}:${event.occurredAt}`,
        topic: event.topic,
        businessId: business.id,
        reason:
          "Skipped: account not active, so no review request was sent.",
      });
      return outcome(200, { ok: true, reason: "account_inactive" });
    }

    // One review request per paid invoice, ever. INVOICE_UPDATE fires on
    // every edit of an invoice, so the key is the invoice, never the event
    // (occurredAt differs every time). A NEW invoice for the same client has
    // a different id and so sends again, to the same customer row.
    const dedupeKey = `invoice-paid:${event.accountId}:${event.itemId}`;
    if (await isWebhookEventDone(PROVIDER, dedupeKey)) {
      return outcome(200, { ok: true, deduped: true });
    }

    const tokenResult = await getValidJobberAccessToken(connection);
    if (!tokenResult.ok) {
      // A broken/revoked token is retryable -- Jobber's own retry gives a
      // window for the business to notice "needs reconnect" and fix it.
      return outcome(502, { ok: false, reason: "token_refresh_failed" });
    }

    const invoice = await fetchJobberInvoice(
      tokenResult.accessToken,
      event.itemId,
    );
    if (!invoice) {
      return outcome(200, { ok: true, reason: "invoice_not_found" });
    }
    if (!isPaidStatus(invoice.invoiceStatus)) {
      return outcome(200, {
        ok: true,
        reason: "not_paid",
        status: invoice.invoiceStatus,
      });
    }

    const claim = await claimWebhookEvent({
      provider: PROVIDER,
      dedupeKey,
      topic: event.topic,
      businessId: business.id,
    });
    if (claim.status === "done") {
      return outcome(200, { ok: true, deduped: true });
    }
    if (claim.status === "busy") {
      return outcome(503, { ok: false, reason: "busy" });
    }

    const client = invoice.client;
    const name = resolveContactName({
      firstName: client?.firstName,
      lastName: client?.lastName,
      companyName: client?.companyName,
    });
    const picked = pickJobberPhone(client?.phones ?? []);
    const contact: PaidInvoiceContact = {
      externalId: client?.id ?? null,
      name: name?.name ?? "",
      logName: name?.logName ?? "",
      phone: picked.phone,
      email: client ? pickJobberEmail(client) : null,
      ids: `Jobber client ID ${client?.id ?? "unknown"}, invoice ${event.itemId}`,
      note: picked.note,
    };

    const result = await deliverPaidInvoiceRequest({
      claim,
      business,
      connection,
      source: PROVIDER,
      contact,
    });
    if (result.kind === "failed") {
      return outcome(500, { ok: false, reason: "failed" });
    }
    return outcome(200, {
      ok: true,
      reason: result.kind === "skipped" ? "skipped" : "sent",
    });
  } catch (error) {
    // Nothing was sent yet when this is thrown (the send step never throws),
    // and no claim is left half-open that a retry could not take over.
    console.error("[jobber-webhook] failed to process event", error);
    return outcome(500, { ok: false, reason: "failed" });
  }
}

// Entry point for the /webhooks/jobber server route's POST handler.
//
// Jobber wants an answer within 1 second, which a real run (token check,
// GraphQL lookup, a text, an email) cannot meet. So after the cheap checks
// (secret configured, signature, payload shape) the handler answers 200 at
// once and finishes in the background when the host offers a way to keep the
// function alive (getBackgroundScheduler). Without one it does the work
// before answering, which is slower but still correct: a Jobber retry after
// its timeout lands on the per-invoice claim and is answered "busy" or
// "deduped", never processed twice.
//
// The catch with answering first: if the background run then fails, Jobber
// has already been told "ok" and will not retry that delivery. Two things
// soften it: a failed run leaves its claim marked failed (or no claim at all,
// if it failed before reaching one), so the next update for that invoice
// takes over at once; and Jobber sends INVOICE_UPDATE at least twice for a
// payment, and again on any later edit, so there is normally a next update.
export async function handleJobberWebhookRequest(
  request: Request,
): Promise<Response> {
  // Without the client secret we cannot verify anything. 503 (not 200) so
  // Jobber retries and the problem is visible instead of events vanishing.
  if (!isJobberWebhookConfigured()) {
    return webhookJson(503, { ok: false, reason: "not_configured" });
  }

  const signatureHeader = request.headers.get("x-jobber-hmac-sha256");
  const rawBody = await request.text();

  if (!verifyJobberWebhookSignature(rawBody, signatureHeader)) {
    return webhookJson(400, { ok: false, reason: "bad_signature" });
  }

  let payload: JobberWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as JobberWebhookPayload;
  } catch {
    return webhookJson(400, { ok: false, reason: "bad_payload" });
  }

  const raw = payload.data?.webHookEvent;
  if (!raw?.topic || !raw.accountId || !raw.itemId) {
    return webhookJson(400, { ok: false, reason: "bad_payload" });
  }
  const event: JobberWebhookEvent = {
    topic: raw.topic,
    accountId: raw.accountId,
    itemId: raw.itemId,
    occurredAt: raw.occurredAt ?? "",
    ...(raw.appId ? { appId: raw.appId } : {}),
  };

  if (!INVOICE_TOPICS.has(event.topic)) {
    return webhookJson(200, { ok: true, reason: "ignored_topic" });
  }

  // Starts now either way; the question is only whether we wait for it.
  const work = processJobberInvoiceUpdate(event);

  const schedule = getBackgroundScheduler(request);
  if (schedule) {
    schedule(
      work.then(
        (result) => {
          console.log(
            `[jobber-webhook] background run finished with ${result.status}: ${JSON.stringify(result.body)}`,
          );
        },
        (error) => {
          console.error("[jobber-webhook] background run crashed", error);
        },
      ),
    );
    return webhookJson(200, { ok: true, accepted: true, mode: "background" });
  }

  console.warn(
    "[jobber-webhook] no background hook on this host, answering after the work (may exceed Jobber's 1 second limit)",
  );
  const result = await work;
  return webhookJson(result.status, { ...result.body, mode: "inline" });
}
