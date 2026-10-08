// Zapier connector (and, since it is a plain API, anything else that can send
// an HTTPS request: Make.com, n8n, a business's own systems).
//
// How it works:
//   1. In Settings the owner creates an API key. We keep a SHA-256 hash of it
//      in crm_connections.external_account_id (the lookup) and an encrypted
//      copy in access_token_ciphertext (so Settings can show it again).
//   2. Our Zapier app sends that key in the "X-API-Key" header.
//      GET  /api/v1/me               checks the key (Zapier's connection test)
//      POST /api/v1/review-requests  "Send Review Request": creates or reuses
//                                    the customer and sends the request
//   3. A review request goes through exactly the same path as a paid Square
//      or Jobber invoice (deliverPaidInvoiceRequest), so quiet hours, the
//      review-link guard, paused accounts and the activity log all apply.
//
// Duplicate safety: a Zap can run twice for one job (a re-run, or two Zaps on
// the same trigger). If the request carries reference_id (the invoice or job
// id), that id is the claim key. Without one, the same person is asked at
// most once per day per business.

import { createServerFn } from "@tanstack/react-start";
import { and, count, eq, gte } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { getSessionBusinessId } from "../auth.server";
import { decryptSecret, encryptSecret } from "../crypto.server";
import { getDb } from "../db/client";
import {
  businesses,
  crmConnections,
  crmWebhookEvents,
  type Business,
  type CrmConnection,
} from "../db/schema";
import {
  claimWebhookEvent,
  deliverPaidInvoiceRequest,
  failWebhookEvent,
  isCrmFrameworkConfigured,
  resolveContactName,
  webhookJson,
  type CrmWebhookProvider,
} from "./connections.server";

const PROVIDER: CrmWebhookProvider = "zapier";
const KEY_PREFIX = "upt_live_";
// A runaway Zap (a loop, or a bulk import mapped to the action) must not be
// able to text hundreds of people in an hour.
const MAX_REQUESTS_PER_HOUR = 200;
const MAX_FIELD_LENGTH = 300;

export function isZapierConfigured(): boolean {
  return isCrmFrameworkConfigured();
}

function hashKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function newKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

// ---- Settings (signed-in owner) -------------------------------------------

export type ZapierKeyResult =
  { ok: true; key: string | null } | { ok: false; message: string };

async function loadOwnConnection(
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

// Shows the owner their current key (null when they have none).
export const getZapierKey = createServerFn({ method: "POST" }).handler(
  async (): Promise<ZapierKeyResult> => {
    if (!isZapierConfigured()) {
      return { ok: false, message: "Not available yet." };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };
    const row = await loadOwnConnection(businessId);
    if (!row) return { ok: true, key: null };
    try {
      return { ok: true, key: decryptSecret(row.accessTokenCiphertext) };
    } catch (error) {
      console.error("[zapier] could not decrypt the stored key", error);
      return {
        ok: false,
        message: "We couldn't load your key. Create a new one instead.",
      };
    }
  },
);

// Creates the key, or replaces it. The old key stops working at once.
export const createZapierKey = createServerFn({ method: "POST" }).handler(
  async (): Promise<ZapierKeyResult> => {
    if (!isZapierConfigured()) {
      return { ok: false, message: "Not available yet." };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };

    const key = newKey();
    const db = getDb();
    await db
      .insert(crmConnections)
      .values({
        businessId,
        provider: PROVIDER,
        externalAccountId: hashKey(key),
        accessTokenCiphertext: encryptSecret(key),
        refreshTokenCiphertext: null,
        accessTokenExpiresAt: null,
        scope: "send_review_requests",
      })
      .onConflictDoUpdate({
        target: [crmConnections.businessId, crmConnections.provider],
        set: {
          externalAccountId: hashKey(key),
          accessTokenCiphertext: encryptSecret(key),
          lastErrorMessage: null,
          lastErrorAt: null,
          connectedAt: new Date(),
        },
      });
    return { ok: true, key };
  },
);

// ---- API (called by Zapier with the key) -----------------------------------

type Authed = { business: Business; connection: CrmConnection };

function readKey(request: Request): string | null {
  const header = request.headers.get("x-api-key")?.trim();
  if (header) return header;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  return bearer || null;
}

async function authenticate(
  request: Request,
): Promise<Authed | { error: Response }> {
  if (!isZapierConfigured()) {
    return {
      error: webhookJson(503, {
        ok: false,
        error: "not_configured",
        message: "This service is not available yet.",
      }),
    };
  }
  const key = readKey(request);
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 200) {
    return {
      error: webhookJson(401, {
        ok: false,
        error: "invalid_api_key",
        message:
          "Missing or invalid API key. Copy your key from UpTrend Scaling: Settings, Connections, Zapier.",
      }),
    };
  }

  const db = getDb();
  const [connection] = await db
    .select()
    .from(crmConnections)
    .where(
      and(
        eq(crmConnections.provider, PROVIDER),
        eq(crmConnections.externalAccountId, hashKey(key)),
      ),
    )
    .limit(1);
  if (!connection) {
    return {
      error: webhookJson(401, {
        ok: false,
        error: "invalid_api_key",
        message:
          "That API key is not valid anymore. Copy your current key from UpTrend Scaling: Settings, Connections, Zapier.",
      }),
    };
  }
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, connection.businessId))
    .limit(1);
  if (!business) {
    return {
      error: webhookJson(401, {
        ok: false,
        error: "invalid_api_key",
        message: "This account no longer exists.",
      }),
    };
  }
  return { business, connection };
}

// GET /api/v1/me: Zapier's "test connection" call. Also tells Zapier what to
// label the connected account with.
export async function handleApiMeRequest(request: Request): Promise<Response> {
  try {
    const authed = await authenticate(request);
    if ("error" in authed) return authed.error;
    return webhookJson(200, {
      ok: true,
      business_name: authed.business.businessName,
      account_active: !authed.business.accessRevoked,
      review_link_set: Boolean(authed.business.googleReviewUrl?.trim()),
    });
  } catch (error) {
    console.error("[zapier] /me failed", error);
    return webhookJson(500, {
      ok: false,
      error: "server_error",
      message: "Something went wrong on our side. Please try again.",
    });
  }
}

type ReviewRequestBody = {
  customer_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  company_name?: unknown;
  customer_phone?: unknown;
  customer_email?: unknown;
  customer_id?: unknown;
  reference_id?: unknown;
};

function field(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, MAX_FIELD_LENGTH);
}

function badRequest(message: string): Response {
  return webhookJson(400, { ok: false, error: "invalid_request", message });
}

// POST /api/v1/review-requests: the "Send Review Request" action.
export async function handleApiReviewRequest(
  request: Request,
): Promise<Response> {
  let authed: Authed;
  try {
    const result = await authenticate(request);
    if ("error" in result) return result.error;
    authed = result;
  } catch (error) {
    console.error("[zapier] authentication failed", error);
    return webhookJson(500, {
      ok: false,
      error: "server_error",
      message: "Something went wrong on our side. Please try again.",
    });
  }
  const { business, connection } = authed;

  let body: ReviewRequestBody;
  try {
    const text = await request.text();
    if (text.length > 20_000) return badRequest("Request is too large.");
    // Zapier sends JSON. A form-encoded body is accepted too, for tools that
    // can only send forms.
    const type = request.headers.get("content-type") ?? "";
    body = type.includes("application/x-www-form-urlencoded")
      ? (Object.fromEntries(new URLSearchParams(text)) as ReviewRequestBody)
      : (JSON.parse(text) as ReviewRequestBody);
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return badRequest("The request body must be JSON.");
  }

  const fullName = field(body.customer_name);
  const resolved = fullName
    ? resolveContactName({
        firstName: fullName.split(/\s+/)[0],
        lastName: fullName.split(/\s+/).slice(1).join(" "),
      })
    : resolveContactName({
        firstName: field(body.first_name),
        lastName: field(body.last_name),
        companyName: field(body.company_name),
      });
  if (!resolved) {
    return badRequest(
      "Customer name is required (customer_name, or first_name and last_name).",
    );
  }
  const phone = field(body.customer_phone);
  const email = field(body.customer_email);
  if (!phone && !email) {
    return badRequest(
      "Add the customer's phone number or email so we can reach them.",
    );
  }
  const externalId = field(body.customer_id);
  const referenceId = field(body.reference_id);

  try {
    const db = getDb();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recent] = await db
      .select({ n: count() })
      .from(crmWebhookEvents)
      .where(
        and(
          eq(crmWebhookEvents.provider, PROVIDER),
          eq(crmWebhookEvents.businessId, business.id),
          gte(crmWebhookEvents.receivedAt, hourAgo),
        ),
      );
    if ((recent?.n ?? 0) >= MAX_REQUESTS_PER_HOUR) {
      return webhookJson(
        429,
        {
          ok: false,
          error: "rate_limited",
          message: `More than ${MAX_REQUESTS_PER_HOUR} review requests in the last hour. Please slow down and try again later.`,
        },
        { "retry-after": "600" },
      );
    }

    const day = new Date().toISOString().slice(0, 10);
    const dedupeKey = referenceId
      ? `ref:${business.id}:${referenceId}`
      : `auto:${business.id}:${hashKey(
          [
            resolved.name.toLowerCase(),
            phone ?? "",
            (email ?? "").toLowerCase(),
          ].join("|"),
        )}:${day}`;

    const claim = await claimWebhookEvent({
      provider: PROVIDER,
      dedupeKey,
      topic: "review_request.create",
      businessId: business.id,
    });
    if (claim.status === "done") {
      return webhookJson(200, {
        ok: true,
        status: "duplicate",
        message: referenceId
          ? "A review request was already sent for this reference_id, so nothing new was sent."
          : "This customer was already sent a review request today, so nothing new was sent.",
      });
    }
    if (claim.status === "busy") {
      return webhookJson(
        409,
        {
          ok: false,
          error: "in_progress",
          message: "This request is already being sent. Try again in a minute.",
        },
        { "retry-after": "60" },
      );
    }

    const ids = [
      externalId ? `customer ID ${externalId}` : null,
      referenceId ? `reference ${referenceId}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    try {
      const result = await deliverPaidInvoiceRequest({
        claim,
        business,
        connection,
        source: PROVIDER,
        contact: {
          externalId,
          name: resolved.name,
          logName: resolved.logName,
          phone,
          email,
          ids: ids ? `via Zapier, ${ids}` : "via Zapier",
        },
      });

      if (result.kind === "sent") {
        return webhookJson(200, {
          ok: true,
          status: "sent",
          customer_id: result.customerId,
          note: result.note,
        });
      }
      if (result.kind === "skipped") {
        // Something the owner has to fix (no review link, paused account,
        // unusable contact details). An error makes Zapier show it on the Zap.
        return webhookJson(422, {
          ok: false,
          error: "not_sent",
          message: result.reason
            .replace(/^Skipped:\s*/, "")
            .replace(/^./, (c) => c.toUpperCase()),
        });
      }
      return webhookJson(500, {
        ok: false,
        error: "server_error",
        message: "We could not send this review request. Please try again.",
      });
    } catch (error) {
      console.error("[zapier] failed to deliver the request", error);
      await failWebhookEvent(
        claim.eventId,
        error instanceof Error ? error.message : String(error),
      );
      return webhookJson(500, {
        ok: false,
        error: "server_error",
        message: "We could not send this review request. Please try again.",
      });
    }
  } catch (error) {
    console.error("[zapier] review request failed before claiming", error);
    return webhookJson(500, {
      ok: false,
      error: "server_error",
      message: "Something went wrong on our side. Please try again.",
    });
  }
}
