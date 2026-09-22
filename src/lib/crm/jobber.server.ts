// Jobber OAuth connect flow + webhook handling. Jobber is a field-service/
// invoicing tool popular with home-service contractors; see
// developer.getjobber.com. Two Jobber-specific quirks worth remembering:
//   - Access tokens expire in ~60 minutes, refreshed lazily on use.
//   - Refresh tokens ROTATE on every refresh -- the old one is dead the
//     moment a new one is issued, so a failed persist after a successful
//     refresh call permanently breaks the connection until the business
//     reconnects. Never swallow that failure.
//
// Webhook payloads are thin ({topic, accountId, itemId, occurredAt} only) --
// there's no invoice/client data inline, so handling a webhook means a
// follow-up GraphQL call to resolve what actually happened.
//
// NOTE: the exact GraphQL field/enum names below (client fields, the
// "paid" invoice status) are based on Jobber's published docs, not a live
// schema introspection -- verify against Jobber's GraphiQL explorer once a
// real developer app exists, before relying on this in production.

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

const PROVIDER: CrmProvider = "jobber";
const AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
// Jobber requires every GraphQL request to declare which API version it
// expects. Check developer.getjobber.com for the current supported version
// before going live -- this is a point-in-time value, not a constant Jobber
// guarantees forever.
const JOBBER_API_VERSION = "2025-01-20";
const REDIRECT_URI = `${CANONICAL_SITE_URL}/connect/jobber/callback`;
// Refresh with 5 minutes of headroom before the ~60-minute token actually expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

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
        message: "Jobber isn't switched on yet -- check back soon.",
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
  });
  if (!response.ok) {
    throw new Error(
      `Jobber GraphQL request failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (body.errors) {
    throw new Error(
      `Jobber GraphQL returned errors: ${JSON.stringify(body.errors)}`,
    );
  }
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
        message: "Jobber isn't switched on yet -- check back soon.",
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
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
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

// Lazy refresh: only refreshes when the token is actually about to be used
// and is near expiry, rather than on a schedule.
export async function getValidJobberAccessToken(
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
    const tokens = await refreshJobberToken(refreshToken);
    // Jobber ROTATES the refresh token on every use -- persisting the new
    // one is not optional, the old one is already dead.
    await updateConnectionTokens(
      connection.id,
      tokens.access_token,
      tokens.refresh_token ?? refreshToken,
      tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
    );
    return { ok: true, accessToken: tokens.access_token };
  } catch (error) {
    console.error("[jobber] token refresh failed", error);
    await recordConnectionError(
      connection.id,
      "Jobber access expired and couldn't be refreshed -- please reconnect.",
    );
    return { ok: false, message: "Jobber access expired -- please reconnect." };
  }
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

type JobberWebhookPayload = {
  data: {
    webHookEvent: {
      topic: string;
      appId: string;
      accountId: string;
      itemId: string;
      occurredAt: string;
    };
  };
};

// Topics that mean "an invoice's status may have changed" -- the only ones
// worth a follow-up query. Jobber has no dedicated INVOICE_PAID topic per
// the docs reviewed; paid-ness is read off the invoice itself after an
// INVOICE_UPDATE.
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
        phones { number primary }
        emails { address primary }
      }
    }
  }
`;

type JobberInvoiceQueryResult = {
  invoice: {
    id: string;
    invoiceStatus: string;
    client: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      phones: Array<{ number: string; primary: boolean }>;
      emails: Array<{ address: string; primary: boolean }>;
    };
  } | null;
};

type ResolvedJobberCustomer = {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
};

// Returns null when this event isn't (or isn't yet) an actually-paid
// invoice -- the caller should ack 200 without creating a customer or
// sending anything, since retrying would never change that outcome.
async function resolveJobberWebhookCustomer(
  accessToken: string,
  topic: string,
  itemId: string,
): Promise<ResolvedJobberCustomer | null> {
  if (!INVOICE_TOPICS.has(topic)) return null;

  const data = await jobberGraphql<JobberInvoiceQueryResult>(
    accessToken,
    INVOICE_QUERY,
    {
      id: itemId,
    },
  );
  const invoice = data.invoice;
  if (!invoice) return null;

  // TODO(verify): confirm "PAID" is the exact enum value Jobber returns for
  // invoiceStatus once a live account is available -- inferred from docs,
  // not confirmed via schema introspection.
  if (invoice.invoiceStatus !== "PAID") return null;

  const client = invoice.client;
  const name = [client.firstName, client.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!name) return null;

  const phone =
    client.phones.find((p) => p.primary)?.number ??
    client.phones[0]?.number ??
    null;
  const email =
    client.emails.find((e) => e.primary)?.address ??
    client.emails[0]?.address ??
    null;
  if (!phone && !email) return null;

  return { externalId: client.id, name, phone, email };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Entry point for the /webhooks/jobber server route's POST handler.
export async function handleJobberWebhookRequest(
  request: Request,
): Promise<Response> {
  if (!isJobberWebhookConfigured()) {
    // Ack 200 so Jobber doesn't flag this endpoint as failing before it's
    // wired up.
    return jsonResponse(200, { ok: false, reason: "not_configured" });
  }

  const signatureHeader = request.headers.get("x-jobber-hmac-sha256");
  const rawBody = await request.text();

  if (!verifyJobberWebhookSignature(rawBody, signatureHeader)) {
    return jsonResponse(400, { ok: false, reason: "bad_signature" });
  }

  let payload: JobberWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as JobberWebhookPayload;
  } catch {
    return jsonResponse(400, { ok: false, reason: "bad_payload" });
  }

  const event = payload.data?.webHookEvent;
  if (!event) return jsonResponse(400, { ok: false, reason: "bad_payload" });

  const dedupeKey = `${event.topic}:${event.itemId}:${event.occurredAt}`;
  const db = getDb();

  // Layer 1 dedup: has this exact webhook delivery already been processed?
  const [eventRow] = await db
    .insert(crmWebhookEvents)
    .values({ provider: PROVIDER, dedupeKey, topic: event.topic })
    .onConflictDoNothing({
      target: [crmWebhookEvents.provider, crmWebhookEvents.dedupeKey],
    })
    .returning();

  if (!eventRow) {
    // Already handled -- ack immediately, do nothing else.
    return jsonResponse(200, { ok: true, deduped: true });
  }

  try {
    const connection = await findConnectionByExternalAccountId(
      PROVIDER,
      event.accountId,
    );
    if (!connection) {
      // No business has this Jobber account connected (any more) -- nothing
      // to do, and retrying won't change that.
      return jsonResponse(200, { ok: true, reason: "no_connection" });
    }

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, connection.businessId))
      .limit(1);
    if (!business)
      return jsonResponse(200, { ok: true, reason: "no_business" });

    const tokenResult = await getValidJobberAccessToken(connection);
    if (!tokenResult.ok) {
      // A broken/revoked token is retryable -- Jobber's own retry gives a
      // window for the business to notice "needs reconnect" and fix it.
      return jsonResponse(502, { ok: false, reason: "token_refresh_failed" });
    }

    const customer = await resolveJobberWebhookCustomer(
      tokenResult.accessToken,
      event.topic,
      event.itemId,
    );
    if (!customer) {
      return jsonResponse(200, { ok: true, reason: "ignored" });
    }

    const result = await createCustomerAndSendReviewRequest(business, {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      source: "jobber",
      externalId: customer.externalId,
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
    console.error("[jobber-webhook] failed to process event", error);
    await db
      .update(crmWebhookEvents)
      .set({
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(crmWebhookEvents.id, eventRow.id));
    // Unexpected failure -- retryable, so Jobber tries again later.
    return jsonResponse(500, { ok: false });
  }
}
