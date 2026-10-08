// Provider-agnostic storage/management for a business's connected CRM
// accounts (Jobber, Square, more later). Handles encryption at rest and the
// shared DB operations; provider-specific OAuth/webhook logic lives in
// jobber.server.ts / square.server.ts.
//
// Dormant-safe like the rest of the app: isCrmFrameworkConfigured() folds in
// every prerequisite (db, auth, encryption) so callers only need one check.

import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getSessionBusinessId, isAuthConfigured } from "../auth.server";
import {
  decryptSecret,
  encryptSecret,
  isEncryptionConfigured,
} from "../crypto.server";
import { getDb, isDbConfigured } from "../db/client";
import {
  crmConnections,
  crmWebhookEvents,
  type Business,
  type CrmConnection,
} from "../db/schema";
import { normalizeEmail, normalizeUsPhone } from "../messaging.server";
import {
  createCustomerAndSendReviewRequest,
  hasReviewLink,
} from "../reviews.server";

// The provider lists live in ./providers (shared with browser code).
// crm_webhook_events.provider is a wider list (it also holds "stripe"
// owner-alert markers) and crm_connections.provider also holds "google", so
// the webhook code uses CrmWebhookProvider to stay inside what it handles.
export {
  CONNECTION_PROVIDERS,
  WEBHOOK_PROVIDERS,
  type CrmProvider,
  type CrmWebhookProvider,
} from "./providers";
import {
  CONNECTION_PROVIDERS,
  type CrmProvider,
  type CrmWebhookProvider,
} from "./providers";

export function isCrmFrameworkConfigured(): boolean {
  return isDbConfigured() && isAuthConfigured() && isEncryptionConfigured();
}

export type ConnectionSummary = {
  provider: CrmProvider;
  connectedAt: Date;
  lastErrorMessage: string | null;
  // Last time a webhook was handled (Jobber/Square) or a sync finished
  // (Google). Null if nothing has happened since connecting.
  lastEventAt: Date | null;
  // Google only: the chosen business location, e.g. "Ace Plumbing & Drain".
  externalLocationName: string | null;
};

// GET server fn for the /app loader. Deliberately never returns the
// ciphertext columns to the client.
export const listConnectionsForBusiness = createServerFn({
  method: "GET",
}).handler(async (): Promise<ConnectionSummary[]> => {
  if (!isCrmFrameworkConfigured()) return [];
  const businessId = await getSessionBusinessId();
  if (!businessId) return [];

  const db = getDb();
  const rows = await db
    .select({
      provider: crmConnections.provider,
      connectedAt: crmConnections.connectedAt,
      lastErrorMessage: crmConnections.lastErrorMessage,
      lastEventAt: crmConnections.lastEventAt,
      externalLocationName: crmConnections.externalLocationName,
    })
    .from(crmConnections)
    .where(eq(crmConnections.businessId, businessId));

  return rows;
});

// The webhook-routing lookup: a provider's webhook carries only its own
// account id, never our businessId.
export async function findConnectionByExternalAccountId(
  provider: CrmProvider,
  externalAccountId: string,
): Promise<CrmConnection | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(crmConnections)
    .where(
      and(
        eq(crmConnections.provider, provider),
        eq(crmConnections.externalAccountId, externalAccountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type SaveConnectionInput = {
  externalAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

// Encrypts and upserts on the (businessId, provider) unique index --
// reconnecting a provider overwrites the existing row rather than creating a
// second one, and clears any prior "needs reconnect" error.
export async function saveConnection(
  businessId: string,
  provider: CrmProvider,
  input: SaveConnectionInput,
): Promise<void> {
  const db = getDb();
  const accessTokenCiphertext = encryptSecret(input.accessToken);
  const refreshTokenCiphertext = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : null;

  await db
    .insert(crmConnections)
    .values({
      businessId,
      provider,
      externalAccountId: input.externalAccountId,
      accessTokenCiphertext,
      refreshTokenCiphertext,
      accessTokenExpiresAt: input.expiresAt,
      scope: input.scope,
    })
    .onConflictDoUpdate({
      target: [crmConnections.businessId, crmConnections.provider],
      set: {
        externalAccountId: input.externalAccountId,
        accessTokenCiphertext,
        refreshTokenCiphertext,
        accessTokenExpiresAt: input.expiresAt,
        scope: input.scope,
        lastErrorMessage: null,
        lastErrorAt: null,
        // A reconnect may be a different account entirely (Google), so any
        // previously chosen location no longer applies.
        externalLocationId: null,
        externalLocationName: null,
      },
    });
}

export function decryptAccessToken(connection: CrmConnection): string {
  return decryptSecret(connection.accessTokenCiphertext);
}

export function decryptRefreshToken(connection: CrmConnection): string | null {
  return connection.refreshTokenCiphertext
    ? decryptSecret(connection.refreshTokenCiphertext)
    : null;
}

// Used when a lazy token refresh fails (e.g. the business revoked access on
// the provider's side) -- surfaced in the UI as "needs reconnect" rather than
// silently failing every future webhook.
export async function recordConnectionError(
  connectionId: string,
  message: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(crmConnections)
    .set({ lastErrorMessage: message, lastErrorAt: new Date() })
    .where(eq(crmConnections.id, connectionId));
}

// Persists the rotated tokens after a successful refresh. Kept separate from
// saveConnection (which also resets externalAccountId) since a refresh never
// changes which account is connected.
export async function updateConnectionTokens(
  connectionId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(crmConnections)
    .set({
      accessTokenCiphertext: encryptSecret(accessToken),
      refreshTokenCiphertext: refreshToken
        ? encryptSecret(refreshToken)
        : undefined,
      accessTokenExpiresAt: expiresAt,
      lastErrorMessage: null,
      lastErrorAt: null,
    })
    .where(eq(crmConnections.id, connectionId));
}

const disconnectSchema = z.object({ provider: z.enum(CONNECTION_PROVIDERS) });

export type DisconnectResult = { ok: true } | { ok: false; message: string };

// Deletes the connection row locally regardless of whether a best-effort
// provider-side revoke call succeeds -- a business should never be stuck
// "connected" here just because a revoke request failed on the other end.
export const disconnectConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => disconnectSchema.parse(input))
  .handler(async ({ data }): Promise<DisconnectResult> => {
    if (!isCrmFrameworkConfigured()) {
      return { ok: false, message: "Not configured yet." };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };

    const db = getDb();
    const match = and(
      eq(crmConnections.businessId, businessId),
      eq(crmConnections.provider, data.provider),
    );

    // Intuit asks apps to revoke the tokens when the owner disconnects.
    // Loaded on demand: quickbooks.server imports this module.
    if (data.provider === "quickbooks") {
      const [row] = await db.select().from(crmConnections).where(match).limit(1);
      if (row) {
        const { revokeQuickBooksConnection } = await import(
          "./quickbooks.server"
        );
        await revokeQuickBooksConnection(row);
      }
    }

    await db.delete(crmConnections).where(match);
    return { ok: true };
  });

export async function getConnectionById(
  connectionId: string,
): Promise<CrmConnection | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(crmConnections)
    .where(eq(crmConnections.id, connectionId))
    .limit(1);
  return row ?? null;
}

// Stamps "a paid invoice from this connection was just handled" (sent or
// deliberately skipped). The dashboard shows it as "last invoice 2m ago", so
// it is NOT stamped for the many updates that are not a paid invoice. Never
// throws: a failed timestamp must not turn a message that was already sent
// into a failed webhook.
export async function touchConnectionLastEvent(
  connectionId: string,
): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(crmConnections)
      .set({ lastEventAt: sql`now()` })
      .where(eq(crmConnections.id, connectionId));
  } catch (error) {
    console.error("[crm] could not update last_event_at", error);
  }
}

// ---- Webhook claims (retry safety) ----------------------------------------
// Square and Jobber deliver "at least once": the same event can arrive twice,
// and an event we answered with an error arrives again later. A handler that
// CREATES customers and SENDS texts has to cope with both, without ever
// texting the same person twice for one paid invoice and without losing an
// event because an earlier attempt failed.
//
// The scheme uses one crm_webhook_events row per real-world action (one paid
// invoice), and the row's own columns are the state machine:
//
//   in progress   processed_at null, error_message null, received_at fresh
//   failed        processed_at null, error_message "Failed: ..."
//                 (retryable: the provider's retry takes the claim at once)
//   abandoned     processed_at null, error_message null, received_at older
//                 than STALE_CLAIM_MINUTES (the process died mid-way; a retry
//                 may take the claim over)
//   done          processed_at set. error_message is null when a request was
//                 sent, or holds "Skipped: ..." (nothing sent on purpose, with
//                 the reason) or "Note: ..." (sent, with something to know).
//
// Every transition is a single atomic statement, which also matters because
// the production database driver (Neon over HTTP) has no multi-statement
// transactions.

const STALE_CLAIM_MINUTES = 5;

export type WebhookClaim = {
  eventId: string;
  dedupeKey: string;
  // True when this claim took over an earlier attempt that failed or died.
  retry: boolean;
  // When that earlier attempt started, so a retry can find out which message
  // channels it already got to and not send those again.
  previousAttemptAt: Date | null;
};

export type ClaimResult =
  | ({ status: "claimed" } & WebhookClaim)
  // Already handled to the end. Safe to acknowledge and do nothing.
  | { status: "done" }
  // Another delivery is working on it right now. Ask the provider to try
  // again later (it will then see "done", or take over if that attempt failed).
  | { status: "busy" };

export async function claimWebhookEvent(input: {
  provider: CrmWebhookProvider;
  dedupeKey: string;
  topic: string;
  businessId: string | null;
}): Promise<ClaimResult> {
  const db = getDb();
  const same = and(
    eq(crmWebhookEvents.provider, input.provider),
    eq(crmWebhookEvents.dedupeKey, input.dedupeKey),
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    const [inserted] = await db
      .insert(crmWebhookEvents)
      .values({
        provider: input.provider,
        dedupeKey: input.dedupeKey,
        topic: input.topic,
        businessId: input.businessId,
      })
      .onConflictDoNothing({
        target: [crmWebhookEvents.provider, crmWebhookEvents.dedupeKey],
      })
      .returning({ id: crmWebhookEvents.id });
    if (inserted) {
      return {
        status: "claimed",
        eventId: inserted.id,
        dedupeKey: input.dedupeKey,
        retry: false,
        previousAttemptAt: null,
      };
    }

    const [existing] = await db
      .select()
      .from(crmWebhookEvents)
      .where(same)
      .limit(1);
    // The row vanished between our two statements (someone cleaned it up).
    // Go round again and claim it fresh.
    if (!existing) continue;
    if (existing.processedAt) return { status: "done" };

    // Try to take over a failed or abandoned claim. The WHERE clause is the
    // lock: when two retries race, Postgres re-checks it after the first one
    // commits, and the second finds the claim fresh again and gets no row.
    const [taken] = await db
      .update(crmWebhookEvents)
      .set({
        receivedAt: sql`now()`,
        errorMessage: null,
        topic: input.topic,
        businessId: input.businessId,
      })
      .where(
        and(
          eq(crmWebhookEvents.id, existing.id),
          isNull(crmWebhookEvents.processedAt),
          or(
            isNotNull(crmWebhookEvents.errorMessage),
            lt(
              crmWebhookEvents.receivedAt,
              // A constant number, never user input, so building the SQL
              // text from it is safe.
              sql.raw(`now() - interval '${STALE_CLAIM_MINUTES} minutes'`),
            ),
          ),
        ),
      )
      .returning({ id: crmWebhookEvents.id });
    if (taken) {
      return {
        status: "claimed",
        eventId: existing.id,
        dedupeKey: input.dedupeKey,
        retry: true,
        previousAttemptAt: existing.receivedAt,
      };
    }

    // Not ours to take. Maybe it finished while we were looking.
    const [latest] = await db
      .select({ processedAt: crmWebhookEvents.processedAt })
      .from(crmWebhookEvents)
      .where(same)
      .limit(1);
    return latest?.processedAt ? { status: "done" } : { status: "busy" };
  }
  return { status: "busy" };
}

export async function completeWebhookEvent(
  eventId: string,
  fields: {
    businessId: string;
    resultCustomerId?: string | null;
    // "Skipped: ..." or "Note: ..." text for the owner. Leave out when the
    // request went out cleanly.
    note?: string | null;
  },
): Promise<void> {
  const db = getDb();
  await db
    .update(crmWebhookEvents)
    .set({
      businessId: fields.businessId,
      resultCustomerId: fields.resultCustomerId ?? null,
      errorMessage: fields.note ?? null,
      processedAt: sql`now()`,
    })
    .where(eq(crmWebhookEvents.id, eventId));
}

// Hands the claim back: the row stays (so the failure is visible) but any
// retry can take it over straight away.
export async function failWebhookEvent(
  eventId: string,
  message: string,
): Promise<void> {
  try {
    const db = getDb();
    await db
      .update(crmWebhookEvents)
      .set({ errorMessage: `Failed: ${message}`.slice(0, 500) })
      .where(
        and(
          eq(crmWebhookEvents.id, eventId),
          isNull(crmWebhookEvents.processedAt),
        ),
      );
  } catch (error) {
    // The claim then simply goes stale and is retaken after the timeout.
    console.error("[crm] could not mark a webhook event as failed", error);
  }
}

// True when this paid invoice (or other claimed action) has already been
// handled to the end. A cheap read, used to skip pointless work when the same
// event key shows up again.
export async function isWebhookEventDone(
  provider: CrmWebhookProvider,
  dedupeKey: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ processedAt: crmWebhookEvents.processedAt })
    .from(crmWebhookEvents)
    .where(
      and(
        eq(crmWebhookEvents.provider, provider),
        eq(crmWebhookEvents.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);
  return Boolean(row?.processedAt);
}

// For events that are skipped before there is a per-invoice claim to take
// (for example every update from a canceled client's Jobber account): writes
// one finished row so the reason is visible. A redelivery is a no-op.
export async function recordSkippedWebhookEvent(input: {
  provider: CrmWebhookProvider;
  dedupeKey: string;
  topic: string;
  businessId: string;
  reason: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(crmWebhookEvents)
    .values({
      provider: input.provider,
      dedupeKey: input.dedupeKey,
      topic: input.topic,
      businessId: input.businessId,
      errorMessage: input.reason,
      processedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [crmWebhookEvents.provider, crmWebhookEvents.dedupeKey],
    });
}

// ---- Responding before the work is done ------------------------------------

export type BackgroundScheduler = (work: Promise<unknown>) => void;

// Finds the platform's "keep the function alive until this promise settles"
// hook, so a handler can answer the provider right away and finish after.
// Looked for in two places, because which one exists depends on how the site
// is hosted:
//   1. request.waitUntil, set by the server framework underneath TanStack
//      Start (nitro's Vercel entry assigns Vercel's own waitUntil to it;
//      its Cloudflare entry does the same).
//   2. Vercel's request-context global, the same lookup the official
//      @vercel/functions package does for its waitUntil().
// Returns null when neither is there (local runs, other hosts). The caller
// must then do the work before answering, never fire and forget: a serverless
// function that has answered may be frozen at once, mid-send.
export function getBackgroundScheduler(
  request: Request,
): BackgroundScheduler | null {
  const fromRequest = (request as { waitUntil?: unknown }).waitUntil;
  if (typeof fromRequest === "function") {
    return (work) => {
      (fromRequest as (p: Promise<unknown>) => void).call(request, work);
    };
  }

  const vercelContext = (
    globalThis as unknown as Record<
      symbol,
      | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined }
      | undefined
    >
  )[Symbol.for("@vercel/request-context")]?.get?.();
  const fromVercel = vercelContext?.waitUntil;
  if (typeof fromVercel === "function") {
    return (work) => fromVercel.call(vercelContext, work);
  }
  return null;
}

export function webhookJson(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// ---- Shared "a customer paid an invoice" handling -------------------------

// What a provider's webhook hands over once it has worked out who paid.
export type PaidInvoiceContact = {
  // The provider's id for this person (Square customer id, Jobber client id).
  // One customer row is kept per id, however many invoices they pay.
  externalId: string | null;
  // Name to greet them by: their own name, else their company's.
  name: string;
  // Short form for the owner-facing event log ("Maria G.").
  logName: string;
  // Raw values as the CRM has them. Phone is already filtered for text
  // consent where the CRM exposes it. Cleaning up happens below.
  phone: string | null;
  email: string | null;
  // Identifiers shown in the event log when contact info is missing, e.g.
  // "Square customer ID ABC, invoice INV".
  ids: string;
  // Provider-specific remark to keep on the event row, e.g. "the client has
  // not agreed to text messages".
  note?: string | null;
};

export type PaidInvoiceResult =
  | { kind: "sent"; customerId: string; note: string | null }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; message: string };

// Splits a person's name into what to greet them with and the short form
// shown in the owner's event log. Falls back to the company name, because
// many invoices are for a business and have no personal name at all.
export function resolveContactName(parts: {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  companyName?: string | null | undefined;
}): { name: string; logName: string } | null {
  const first = parts.firstName?.trim() ?? "";
  const last = parts.lastName?.trim() ?? "";
  const company = parts.companyName?.trim() ?? "";

  const person = [first, last].filter(Boolean).join(" ");
  if (person) {
    const logName =
      first && last ? `${first} ${last.charAt(0).toUpperCase()}.` : person;
    return { name: person, logName };
  }
  if (company) return { name: company, logName: company };
  return null;
}

function shorten(value: string, max = 40): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// Everything that happens AFTER a paid invoice has been claimed: the guards
// (canceled account, no review link, no way to reach the person), then the
// customer row and the messages, then closing the claim with the result.
// Shared by the Square and Jobber handlers so the rules cannot drift apart.
//
// Never throws. A failure before anything was sent marks the claim failed
// (so the provider's retry reprocesses it) and returns kind "failed". The
// send step itself never throws, so a failure can only come before or after
// the messages went out; after, the retry sees which channels were already
// used and does not repeat them.
export async function deliverPaidInvoiceRequest(args: {
  claim: WebhookClaim;
  business: Business;
  connection: CrmConnection;
  source: CrmWebhookProvider;
  contact: PaidInvoiceContact;
}): Promise<PaidInvoiceResult> {
  const { claim, business, connection, source, contact } = args;

  const skip = async (reason: string): Promise<PaidInvoiceResult> => {
    await completeWebhookEvent(claim.eventId, {
      businessId: business.id,
      note: reason,
    });
    await touchConnectionLastEvent(connection.id);
    return { kind: "skipped", reason };
  };

  const who = contact.logName || "no name on file";
  // "Maria G." already ends in a period, so end the sentence without doubling it.
  const whoEnd = who.endsWith(".") ? who : `${who}.`;

  try {
    if (business.accessRevoked) {
      return await skip(
        `Skipped: account not active, so no review request was sent. Customer: ${whoEnd}`,
      );
    }
    if (!hasReviewLink(business)) {
      return await skip(`Skipped: no Google review link set. Customer: ${whoEnd}`);
    }
    // A paid invoice with no name anywhere is skipped with a reason rather
    // than texted "Hi , thanks for choosing...".
    if (!contact.name.trim()) {
      return await skip(
        `Skipped: paid invoice has no customer name on file (${contact.ids}).`,
      );
    }

    const phone = normalizeUsPhone(contact.phone);
    const email = normalizeEmail(contact.email);
    const notes: string[] = [];
    if (contact.note) notes.push(contact.note);
    if (contact.phone && !phone) {
      notes.push(
        `the phone number "${shorten(contact.phone)}" is not a valid US number, so no text was sent`,
      );
    }
    if (contact.email && !email) {
      notes.push(
        `the email address "${shorten(contact.email)}" is not valid, so no email was sent`,
      );
    }

    if (!phone && !email) {
      // The owner's dashboard shows only the first ~90 characters of this, so
      // the reason and the customer's name come first and the ids after.
      const what = notes.length > 0 ? "no usable phone or email" : "no phone or email";
      const why =
        notes.length > 0
          ? ` ${notes.join("; ").replace(/^./, (c) => c.toUpperCase())}.`
          : "";
      return await skip(
        `Skipped: ${what} on file. Customer: ${who} (${contact.ids}).${why}`,
      );
    }

    const result = await createCustomerAndSendReviewRequest(
      business,
      {
        name: contact.name,
        phone,
        email,
        source,
        externalId: contact.externalId,
      },
      {
        // Same key for every attempt at this invoice: Resend then refuses to
        // email twice even if we crash right after it accepts the message.
        sendKey: claim.dedupeKey,
        alreadyAttemptedSince: claim.retry
          ? (claim.previousAttemptAt ?? undefined)
          : undefined,
      },
    );

    if (!result.ok) {
      if (result.reason === "no_review_link") {
        return await skip(
          `Skipped: no Google review link set. Customer: ${whoEnd}`,
        );
      }
      await failWebhookEvent(claim.eventId, result.message);
      return { kind: "failed", message: result.message };
    }

    if (result.smsError) {
      notes.push(`the text message failed (${shorten(result.smsError, 120)})`);
    }
    if (result.emailError) {
      notes.push(`the email failed (${shorten(result.emailError, 120)})`);
    }
    if (result.smsHeld) {
      notes.push(
        "the text is waiting for daytime (texts only go out 10am to 7pm local time) and will send automatically",
      );
    }
    if (
      result.smsSent === null &&
      result.emailSent === null &&
      !result.smsHeld
    ) {
      notes.push(
        "nothing was sent because text and email sending are not switched on yet",
      );
    }
    const note = notes.length > 0 ? `Note: ${notes.join("; ")}.` : null;

    await completeWebhookEvent(claim.eventId, {
      businessId: business.id,
      resultCustomerId: result.customerId,
      note,
    });
    await touchConnectionLastEvent(connection.id);
    return { kind: "sent", customerId: result.customerId, note };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${source}-webhook] could not deliver the request`, error);
    await failWebhookEvent(claim.eventId, message);
    return { kind: "failed", message };
  }
}
