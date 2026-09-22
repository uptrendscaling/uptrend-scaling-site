// Square OAuth connect flow + webhook handling. See developer.squareup.com.
// Simpler than Jobber in a few ways worth remembering:
//   - Access tokens last ~30 days and do NOT rotate the refresh token on
//     refresh, so persisting a fresh access token + expiry is enough.
//   - The webhook payload for a paid invoice already embeds the customer's
//     name/phone/email directly (`primary_recipient`) -- no follow-up API
//     call needed in the common case.
//   - SQUARE_ENVIRONMENT ("sandbox" or "production", default "production")
//     switches every URL below, so the whole OAuth+webhook pipeline can be
//     dry-run tested against Square's sandbox before real customer data
//     flows through it.
//
// NOTE: the webhook signature scheme and header name below are based on
// Square's published docs, not a live test against a real webhook delivery
// -- verify against an actual sandbox event in Phase 3 testing before
// relying on this in production. The notification URL used when verifying
// must byte-for-byte match what's registered in Square's Developer Console
// (scheme + trailing slash matter) -- a known gotcha.

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
import { businesses, crmWebhookEvents } from "../db/schema";
import { createCustomerAndSendReviewRequest } from "../reviews.server";
import { CANONICAL_SITE_URL } from "../site";
import {
  decryptAccessToken,
  decryptRefreshToken,
  findConnectionByExternalAccountId,
  isCrmFrameworkConfigured,
  recordConnectionError,
  saveConnection,
  updateConnectionTokens,
  type CrmProvider,
} from "./connections.server";
import type { CrmConnection } from "../db/schema";

const PROVIDER: CrmProvider = "square";
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
        message: "Square isn't switched on yet -- check back soon.",
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
        message: "Square isn't switched on yet -- check back soon.",
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
      "No refresh token on file -- please reconnect.",
    );
    return {
      ok: false,
      message: "No refresh token on file -- please reconnect.",
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
      "Square access expired and couldn't be refreshed -- please reconnect.",
    );
    return { ok: false, message: "Square access expired -- please reconnect." };
  }
}

// ---- Webhook ---------------------------------------------------------

// HMAC-SHA256 over (notification URL + raw body), keyed with the
// per-subscription signature key from Square's Developer Console (distinct
// from the Client Secret).
export function verifySquareWebhookSignature(
  rawBody: string,
  header: string | null,
): boolean {
  if (!header) return false;
  const key = process.env["SQUARE_WEBHOOK_SIGNATURE_KEY"];
  if (!key) return false;

  const expected = createHmac("sha256", key)
    .update(WEBHOOK_NOTIFICATION_URL + rawBody, "utf8")
    .digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");
  const headerBuf = Buffer.from(header, "base64");
  if (expectedBuf.length !== headerBuf.length) return false;
  return timingSafeEqual(expectedBuf, headerBuf);
}

type SquareInvoicePaymentMadeEvent = {
  event_id: string;
  type: string;
  merchant_id: string;
  data: {
    object: {
      invoice: {
        id: string;
        primary_recipient?: {
          customer_id?: string;
          given_name?: string;
          family_name?: string;
          email_address?: string;
          phone_number?: string;
        };
      };
    };
  };
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Entry point for the /webhooks/square server route's POST handler.
export async function handleSquareWebhookRequest(
  request: Request,
): Promise<Response> {
  if (!isSquareWebhookConfigured()) {
    return jsonResponse(200, { ok: false, reason: "not_configured" });
  }

  const signatureHeader = request.headers.get("x-square-hmacsha256-signature");
  const rawBody = await request.text();

  if (!verifySquareWebhookSignature(rawBody, signatureHeader)) {
    return jsonResponse(400, { ok: false, reason: "bad_signature" });
  }

  let event: SquareInvoicePaymentMadeEvent;
  try {
    event = JSON.parse(rawBody) as SquareInvoicePaymentMadeEvent;
  } catch {
    return jsonResponse(400, { ok: false, reason: "bad_payload" });
  }

  // Only the paid-invoice trigger is wired up -- ignore everything else
  // (invoice.created, invoice.published, refunds, ...) without erroring.
  if (event.type !== "invoice.payment_made") {
    return jsonResponse(200, { ok: true, reason: "ignored_type" });
  }

  const db = getDb();

  // Layer 1 dedup: Square supplies a native event_id, used as-is.
  const [eventRow] = await db
    .insert(crmWebhookEvents)
    .values({
      provider: PROVIDER,
      dedupeKey: event.event_id,
      topic: event.type,
    })
    .onConflictDoNothing({
      target: [crmWebhookEvents.provider, crmWebhookEvents.dedupeKey],
    })
    .returning();

  if (!eventRow) {
    return jsonResponse(200, { ok: true, deduped: true });
  }

  try {
    const connection = await findConnectionByExternalAccountId(
      PROVIDER,
      event.merchant_id,
    );
    if (!connection) {
      return jsonResponse(200, { ok: true, reason: "no_connection" });
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, connection.businessId))
      .limit(1);
    if (!business)
      return jsonResponse(200, { ok: true, reason: "no_business" });

    // getValidSquareAccessToken isn't actually needed for this trigger
    // (primary_recipient is embedded in the webhook payload directly), but
    // is still called so a broken connection is detected and recorded even
    // when this particular event didn't need the token itself.
    const tokenResult = await getValidSquareAccessToken(connection);
    if (!tokenResult.ok) {
      return jsonResponse(502, { ok: false, reason: "token_refresh_failed" });
    }

    const recipient = event.data.object.invoice.primary_recipient;
    const name = [recipient?.given_name, recipient?.family_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const phone = recipient?.phone_number ?? null;
    const email = recipient?.email_address ?? null;

    if (!name || (!phone && !email) || !recipient?.customer_id) {
      await db
        .update(crmWebhookEvents)
        .set({
          businessId: business.id,
          processedAt: new Date(),
          errorMessage: "No usable contact info",
        })
        .where(eq(crmWebhookEvents.id, eventRow.id));
      return jsonResponse(200, { ok: true, reason: "no_contact_info" });
    }

    const result = await createCustomerAndSendReviewRequest(business, {
      name,
      phone,
      email,
      source: "square",
      externalId: recipient.customer_id,
    });

    await db
      .update(crmWebhookEvents)
      .set({
        businessId: business.id,
        processedAt: new Date(),
        resultCustomerId: result.ok ? result.customerId : null,
        errorMessage: result.ok ? null : result.message,
      })
      .where(eq(crmWebhookEvents.id, eventRow.id));

    return jsonResponse(200, { ok: result.ok });
  } catch (error) {
    console.error("[square-webhook] failed to process event", error);
    await db
      .update(crmWebhookEvents)
      .set({
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(crmWebhookEvents.id, eventRow.id));
    return jsonResponse(500, { ok: false });
  }
}
