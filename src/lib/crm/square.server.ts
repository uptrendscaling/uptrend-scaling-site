// Square OAuth connect flow + webhook handling. See developer.squareup.com.
// Simpler than Jobber in a few ways worth remembering:
//   - Access tokens last ~30 days and do NOT rotate the refresh token on
//     refresh, so persisting a fresh access token + expiry is enough.
//   - The webhook payload for a paid invoice already embeds the customer's
//     name/phone/email directly (`primary_recipient`), so in the normal case
//     no API call (and no token refresh) is needed. The Customers API is only
//     used as a fallback when the payload lacks the contact details.
//   - SQUARE_ENVIRONMENT ("sandbox" or "production", default "production")
//     switches every URL below, so the whole OAuth+webhook pipeline can be
//     dry-run tested against Square's sandbox before real customer data
//     flows through it.
//
// Webhook delivery facts (developer.squareup.com/docs/webhooks/overview):
//   - Only a 2xx counts as received. Anything else is retried with
//     exponential backoff for up to 24 hours. We answer 5xx for failures
//     worth retrying and 2xx for everything final.
//   - Delivery is at least once, and one invoice produces several events
//     (one invoice.payment_made per payment, so a deposit plus a final
//     payment is two events). Our dedupe is therefore per INVOICE, not per
//     event id: see handleSquareWebhookRequest.
//
// NOTE: the notification URL used when verifying a signature must byte-for-byte
// match what's registered in Square's Developer Console (scheme, www and
// trailing slash all matter), a known gotcha. verifySquareWebhookSignature
// also tries the URL the request actually arrived on, so a console URL that
// differs only by host still verifies.

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
import { CANONICAL_SITE_URL } from "../site";
import {
  claimWebhookEvent,
  decryptAccessToken,
  decryptRefreshToken,
  deliverPaidInvoiceRequest,
  failWebhookEvent,
  findConnectionByExternalAccountId,
  isCrmFrameworkConfigured,
  recordConnectionError,
  resolveContactName,
  saveConnection,
  updateConnectionTokens,
  webhookJson,
  type CrmWebhookProvider,
  type PaidInvoiceContact,
} from "./connections.server";
import type { CrmConnection } from "../db/schema";

const PROVIDER: CrmWebhookProvider = "square";
const REDIRECT_URI = `${CANONICAL_SITE_URL}/connect/square/callback`;
const WEBHOOK_NOTIFICATION_URL = `${CANONICAL_SITE_URL}/webhooks/square`;
// Refresh with 3 days of headroom before the ~30-day token actually expires.
const REFRESH_MARGIN_MS = 3 * 24 * 60 * 60 * 1000;
const SCOPES = ["INVOICES_READ", "CUSTOMERS_READ", "MERCHANT_PROFILE_READ"];

function isSandbox(): boolean {
  return process.env["SQUARE_ENVIRONMENT"] === "sandbox";
}

function baseUrl(): string {
  return isSandbox()
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

export function isSquareConfigured(): boolean {
  return (
    Boolean(
      process.env["SQUARE_CLIENT_ID"] && process.env["SQUARE_CLIENT_SECRET"],
    ) && isCrmFrameworkConfigured()
  );
}

export function isSquareWebhookConfigured(): boolean {
  return (
    isSquareConfigured() && Boolean(process.env["SQUARE_WEBHOOK_SIGNATURE_KEY"])
  );
}

// ---- OAuth: connect ------------------------------------------------------

export type AuthorizeUrlResult =
  { ok: true; url: string } | { ok: false; message: string };

export const getSquareAuthorizeUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthorizeUrlResult> => {
    if (!isSquareConfigured()) {
      return {
        ok: false,
        message: "Square isn't switched on yet. Check back soon.",
      };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };

    const state = createOAuthState(businessId, PROVIDER);
    const url = new URL(`${baseUrl()}/oauth2/authorize`);
    url.searchParams.set(
      "client_id",
      process.env["SQUARE_CLIENT_ID"] as string,
    );
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("session", "false");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", REDIRECT_URI);

    return { ok: true, url: url.toString() };
  },
);

type SquareTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_at?: string; // ISO 8601, not seconds-from-now
  merchant_id: string;
};

async function exchangeSquareCode(code: string): Promise<SquareTokenResponse> {
  const response = await fetch(`${baseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["SQUARE_CLIENT_ID"],
      client_secret: process.env["SQUARE_CLIENT_SECRET"],
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Square token exchange failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as SquareTokenResponse;
}

const completeConnectionSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export type CompleteConnectionResult =
  { ok: true } | { ok: false; message: string };

export const completeSquareConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => completeConnectionSchema.parse(input))
  .handler(async ({ data }): Promise<CompleteConnectionResult> => {
    if (!isSquareConfigured()) {
      return {
        ok: false,
        message: "Square isn't switched on yet. Check back soon.",
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
        message: "Please sign in and try connecting Square again.",
      };
    }

    try {
      const tokens = await exchangeSquareCode(data.code);

      await saveConnection(verified.businessId, PROVIDER, {
        externalAccountId: tokens.merchant_id,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: tokens.expires_at ? new Date(tokens.expires_at) : null,
        scope: SCOPES.join(" "),
      });

      return { ok: true };
    } catch (error) {
      console.error("[square] failed to complete connection", error);
      return {
        ok: false,
        message: "Couldn't connect to Square. Please try again.",
      };
    }
  });

// ---- Token refresh ---------------------------------------------------

async function refreshSquareToken(
  refreshToken: string,
): Promise<SquareTokenResponse> {
  const response = await fetch(`${baseUrl()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["SQUARE_CLIENT_ID"],
      client_secret: process.env["SQUARE_CLIENT_SECRET"],
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Square token refresh failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as SquareTokenResponse;
}

export type ValidTokenResult =
  { ok: true; accessToken: string } | { ok: false; message: string };

export async function getValidSquareAccessToken(
  connection: CrmConnection,
): Promise<ValidTokenResult> {
  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? 0;
  const needsRefresh = expiresAt - Date.now() < REFRESH_MARGIN_MS;

  if (!needsRefresh) {
    return { ok: true, accessToken: decryptAccessToken(connection) };
  }

  const refreshToken = decryptRefreshToken(connection);
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

  try {
    const tokens = await refreshSquareToken(refreshToken);
    // Square does not rotate the refresh token on the standard flow -- keep
    // using the same one unless a new one is explicitly returned.
    await updateConnectionTokens(
      connection.id,
      tokens.access_token,
      tokens.refresh_token ?? refreshToken,
      tokens.expires_at ? new Date(tokens.expires_at) : null,
    );
    return { ok: true, accessToken: tokens.access_token };
  } catch (error) {
    console.error("[square] token refresh failed", error);
    await recordConnectionError(
      connection.id,
      "Square access expired and couldn't be refreshed. Please reconnect.",
    );
    return { ok: false, message: "Square access expired. Please reconnect." };
  }
}

// ---- Webhook ---------------------------------------------------------

// HMAC-SHA256 over (notification URL + raw body), keyed with the
// per-subscription signature key from Square's Developer Console (distinct
// from the Client Secret). `requestUrl` is the URL this request actually
// arrived on; it is tried as well as the canonical one, because an exact URL
// mismatch with what was typed into the Developer Console (www or not) is the
// classic reason every Square signature check fails. Trying more URLs cannot
// let a forgery through: without the key nobody can produce a matching HMAC
// for any URL.
export function verifySquareWebhookSignature(
  rawBody: string,
  header: string | null,
  requestUrl?: string,
): boolean {
  if (!header) return false;
  const key = process.env["SQUARE_WEBHOOK_SIGNATURE_KEY"];
  if (!key) return false;

  const urls = [WEBHOOK_NOTIFICATION_URL];
  if (requestUrl) {
    try {
      const parsed = new URL(requestUrl);
      // Behind a proxy the server can see http:// for a request that Square
      // addressed as https://, so the https form is tried as well.
      for (const origin of [parsed.origin, parsed.origin.replace(/^http:/, "https:")]) {
        const arrivedOn = `${origin}${parsed.pathname}`;
        if (!urls.includes(arrivedOn)) urls.push(arrivedOn);
      }
    } catch {
      // A malformed request URL just means we only try the canonical one.
    }
  }

  const headerBuf = Buffer.from(header, "base64");
  return urls.some((url) => {
    const expected = createHmac("sha256", key)
      .update(url + rawBody, "utf8")
      .digest();
    return expected.length === headerBuf.length &&
      timingSafeEqual(expected, headerBuf);
  });
}

type SquareRecipient = {
  customer_id?: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
};

type SquareInvoice = {
  id?: string;
  // DRAFT, UNPAID, SCHEDULED, PARTIALLY_PAID, PAID, PARTIALLY_REFUNDED,
  // REFUNDED, CANCELED, FAILED, PAYMENT_PENDING.
  status?: string;
  primary_recipient?: SquareRecipient;
};

type SquareInvoiceEvent = {
  event_id?: string;
  type?: string;
  merchant_id?: string;
  data?: { object?: { invoice?: SquareInvoice } };
};

// GET /v2/customers/{id}. Only used when the invoice payload came without
// contact details, which is the one case that needs a token.
async function fetchSquareCustomer(
  accessToken: string,
  customerId: string,
): Promise<SquareRecipient | null> {
  const response = await fetch(
    `${baseUrl()}/v2/customers/${encodeURIComponent(customerId)}`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Square customer lookup failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    customer?: {
      given_name?: string;
      family_name?: string;
      company_name?: string;
      email_address?: string;
      phone_number?: string;
    };
  };
  return body.customer ?? null;
}

type RecipientResult =
  | { ok: true; contact: PaidInvoiceContact }
  | { ok: false; message: string };

// Turns the invoice's recipient into who to contact. Uses what the payload
// carries; only if that has no phone and no email (or no name at all) does it
// ask Square's Customers API, which is the only time a token is needed.
async function resolveSquareContact(
  connection: CrmConnection,
  invoice: SquareInvoice,
): Promise<RecipientResult> {
  const recipient = invoice.primary_recipient ?? {};
  let phone = recipient.phone_number?.trim() || null;
  let email = recipient.email_address?.trim() || null;
  let nameParts = {
    firstName: recipient.given_name,
    lastName: recipient.family_name,
    companyName: recipient.company_name,
  };

  const missingContact = !phone && !email;
  const missingName = !resolveContactName(nameParts);
  if (recipient.customer_id && (missingContact || missingName)) {
    const token = await getValidSquareAccessToken(connection);
    if (!token.ok) return { ok: false, message: token.message };

    const customer = await fetchSquareCustomer(
      token.accessToken,
      recipient.customer_id,
    );
    if (customer) {
      phone = phone ?? (customer.phone_number?.trim() || null);
      email = email ?? (customer.email_address?.trim() || null);
      if (missingName) {
        nameParts = {
          firstName: customer.given_name,
          lastName: customer.family_name,
          companyName: customer.company_name,
        };
      }
    }
  }

  const resolved = resolveContactName(nameParts);
  return {
    ok: true,
    contact: {
      externalId: recipient.customer_id ?? null,
      name: resolved?.name ?? "",
      logName: resolved?.logName ?? "",
      phone,
      email,
      ids: `Square customer ID ${recipient.customer_id ?? "unknown"}, invoice ${invoice.id ?? "unknown"}`,
    },
  };
}

// Entry point for the /webhooks/square server route's POST handler.
//
// Retry safety (see "Webhook claims" in connections.server.ts):
//   - One claim per paid INVOICE, key `invoice-paid:<merchant>:<invoice>`.
//     Square's event_id alone would not stop two different events about the
//     same invoice from each sending a request.
//   - A failure that a retry could fix (database down, Square token or
//     Customers API trouble) frees the claim and answers 5xx, so Square's own
//     retries (up to 24 hours) reprocess it. Final outcomes, including the
//     deliberate skips, answer 200.
//   - Each paid invoice sends once, but a NEW paid invoice from the same
//     person sends again (owner decision), to the same customer row.
export async function handleSquareWebhookRequest(
  request: Request,
): Promise<Response> {
  // Without the signature key we cannot tell a real Square event from a fake
  // one. 503 (not 200) so Square keeps retrying and the problem is visible in
  // Square's own delivery log, instead of events vanishing silently.
  if (!isSquareWebhookConfigured()) {
    return webhookJson(503, { ok: false, reason: "not_configured" });
  }

  const signatureHeader = request.headers.get("x-square-hmacsha256-signature");
  const rawBody = await request.text();

  if (!verifySquareWebhookSignature(rawBody, signatureHeader, request.url)) {
    console.error(
      `[square-webhook] signature did not match. Check that the notification URL in the Square Developer Console is exactly ${WEBHOOK_NOTIFICATION_URL} and that SQUARE_WEBHOOK_SIGNATURE_KEY is that subscription's key.`,
    );
    return webhookJson(400, { ok: false, reason: "bad_signature" });
  }

  let event: SquareInvoiceEvent;
  try {
    event = JSON.parse(rawBody) as SquareInvoiceEvent;
  } catch {
    return webhookJson(400, { ok: false, reason: "bad_payload" });
  }

  // Only the paid-invoice trigger is wired up -- ignore everything else
  // (invoice.created, invoice.published, refunds, ...) without erroring.
  if (event.type !== "invoice.payment_made") {
    return webhookJson(200, { ok: true, reason: "ignored_type" });
  }

  const invoice = event.data?.object?.invoice;
  if (!invoice?.id || !event.merchant_id) {
    return webhookJson(400, { ok: false, reason: "bad_payload" });
  }

  const db = getDb();
  let connection: CrmConnection | null = null;
  try {
    connection = await findConnectionByExternalAccountId(
      PROVIDER,
      event.merchant_id,
    );
    if (!connection) {
      return webhookJson(200, { ok: true, reason: "no_connection" });
    }

    // invoice.payment_made fires for EVERY payment, including a deposit or
    // the first of several instalments. Only a fully paid invoice earns a
    // review request.
    if (invoice.status !== "PAID") {
      return webhookJson(200, {
        ok: true,
        reason: "not_fully_paid",
        status: invoice.status ?? null,
      });
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, connection.businessId))
      .limit(1);
    if (!business) return webhookJson(200, { ok: true, reason: "no_business" });

    const claim = await claimWebhookEvent({
      provider: PROVIDER,
      dedupeKey: `invoice-paid:${event.merchant_id}:${invoice.id}`,
      topic: event.type,
      businessId: business.id,
    });
    if (claim.status === "done") {
      return webhookJson(200, { ok: true, deduped: true });
    }
    if (claim.status === "busy") {
      // Another delivery of this invoice is mid-way. Not an error, but not
      // final either, so ask Square to come back rather than say "done".
      return webhookJson(
        503,
        { ok: false, reason: "busy" },
        { "retry-after": "60" },
      );
    }

    // From here the claim is ours. Anything that throws must hand it back.
    try {
      const resolved = await resolveSquareContact(connection, invoice);
      if (!resolved.ok) {
        await failWebhookEvent(claim.eventId, resolved.message);
        return webhookJson(502, { ok: false, reason: "token_refresh_failed" });
      }

      const result = await deliverPaidInvoiceRequest({
        claim,
        business,
        connection,
        source: PROVIDER,
        contact: resolved.contact,
      });
      if (result.kind === "failed") {
        return webhookJson(500, { ok: false, reason: "failed" });
      }
      return webhookJson(200, {
        ok: true,
        reason: result.kind === "skipped" ? "skipped" : "sent",
      });
    } catch (error) {
      console.error("[square-webhook] failed to process event", error);
      await failWebhookEvent(
        claim.eventId,
        error instanceof Error ? error.message : String(error),
      );
      return webhookJson(500, { ok: false, reason: "failed" });
    }
  } catch (error) {
    // Before any claim existed (database trouble while looking things up).
    // Nothing to hand back; 5xx so Square tries again.
    console.error("[square-webhook] failed before claiming the event", error);
    return webhookJson(500, { ok: false, reason: "failed" });
  }
}
