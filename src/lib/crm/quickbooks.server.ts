// QuickBooks Online OAuth connect flow + webhook handling. QuickBooks is the
// most used invoicing tool among our competitors' customers, so a paid
// QuickBooks invoice (or a sales receipt, which is paid on the spot) sends a
// review request exactly like a paid Jobber or Square invoice.
//
// QuickBooks facts worth remembering (checked against Intuit's developer docs,
// October 2026; developer.intuit.com is a JavaScript app, the same pages are
// readable at static.developer.intuit.com/output_html/<path>.html):
//   - OAuth: the authorize redirect returns code, state AND realmId. The realmId
//     is the QuickBooks company id; webhooks carry only that, so it is what we
//     store as the connection's external account id.
//   - Access tokens last 1 hour. Refresh tokens last 100 days from last use
//     and ROTATE (a new value about once a day; the old one then dies), so the
//     newest refresh_token from every refresh response must be saved. Two
//     overlapping refreshes make one fail with invalid_grant, so
//     getValidQuickBooksAccessToken re-reads the row before and after
//     refreshing, the same way the Jobber connector does. There is also a
//     5-year hard cap on a connection, after which the owner reconnects.
//   - The token endpoint wants HTTP Basic auth (client id : secret) and a
//     form-encoded body.
//   - Webhooks: CloudEvents format, a JSON ARRAY of events, each with
//     type "qbo.<entity>.<event>.v1", intuitentityid (the record id) and
//     intuitaccountid (the realmId). The old format
//     ({eventNotifications:[{realmId, dataChangeEvent:{entities:[...]}}]}) was
//     retired on July 31, 2026; it is still parsed below in case an app on the
//     old setting sends it. Signed with header intuit-signature: base64
//     HMAC-SHA256 of the raw body, keyed with the Verifier Token from the
//     developer portal's Webhooks page (Development and Production differ).
//   - Webhooks must be answered with HTTP 200 within 3 SECONDS, and Intuit may
//     hold back later events until one is acknowledged. Events can arrive out
//     of order and more than once. Retries: 10s, 20s, 30s, 5m, 20m, 2h, 4h, 6h.
//   - The payload is thin (no amounts, no customer), so handling an event
//     means reading the record through the Accounting API.
//   - QUICKBOOKS_ENVIRONMENT ("sandbox" or "production", default "production")
//     picks the API host. Development keys only work against sandbox
//     companies, so sandbox mode is also limited to admin accounts (see
//     isQuickBooksOfferedTo).
//
// What counts as "paid":
//   - An Invoice whose Balance is 0 with a TotalAmt above 0. Reached from a
//     Payment event (the payment's lines link to the invoices it paid) and
//     from an Invoice event (in case the payment event was missed).
//   - A SalesReceipt with a TotalAmt above 0 (paid at the time of sale).
// One review request per paid invoice or receipt, ever (dedupe key per
// document). A payment that settles several invoices for the same customer
// sends once, not once per invoice.

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
import { businesses, type Business, type CrmConnection } from "../db/schema";
import { normalizeUsPhone } from "../messaging.server";
import { CANONICAL_SITE_URL } from "../site";
import {
  claimWebhookEvent,
  decryptAccessToken,
  decryptRefreshToken,
  deliverPaidInvoiceRequest,
  failWebhookEvent,
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

const PROVIDER: CrmWebhookProvider = "quickbooks";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
// Versions 1 to 74 were retired in August 2025; 75 is the floor.
const MINOR_VERSION = "75";
const REDIRECT_URI = `${CANONICAL_SITE_URL}/connect/quickbooks/callback`;
// Refresh with 5 minutes of headroom before the 1-hour token expires.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

export function isQuickBooksSandbox(): boolean {
  return process.env["QUICKBOOKS_ENVIRONMENT"] === "sandbox";
}

function apiBase(): string {
  return isQuickBooksSandbox()
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export function isQuickBooksConfigured(): boolean {
  return (
    Boolean(
      process.env["QUICKBOOKS_CLIENT_ID"] &&
        process.env["QUICKBOOKS_CLIENT_SECRET"],
    ) && isCrmFrameworkConfigured()
  );
}

export function isQuickBooksWebhookConfigured(): boolean {
  return (
    isQuickBooksConfigured() &&
    Boolean(process.env["QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN"])
  );
}

// Whether to show the Connect QuickBooks button to this business. With
// development keys (sandbox mode) only a sandbox company can connect, so the
// button is shown to admin accounts only; real customers see it once the
// production keys are in.
export function isQuickBooksOfferedTo(
  business: Pick<Business, "isAdmin">,
): boolean {
  if (!isQuickBooksConfigured()) return false;
  return !isQuickBooksSandbox() || business.isAdmin;
}

function expiryFrom(expiresInSeconds: number | undefined): Date {
  const seconds =
    typeof expiresInSeconds === "number" && expiresInSeconds > 0
      ? expiresInSeconds
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return new Date(Date.now() + seconds * 1000);
}

function basicAuthHeader(): string {
  const id = process.env["QUICKBOOKS_CLIENT_ID"] as string;
  const secret = process.env["QUICKBOOKS_CLIENT_SECRET"] as string;
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- OAuth: connect ------------------------------------------------------

export type AuthorizeUrlResult =
  { ok: true; url: string } | { ok: false; message: string };

const NOT_ON = "QuickBooks isn't switched on yet. Check back soon.";

async function loadBusiness(businessId: string): Promise<Business | null> {
  const [row] = await getDb()
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return row ?? null;
}

export const getQuickBooksAuthorizeUrl = createServerFn({
  method: "GET",
}).handler(async (): Promise<AuthorizeUrlResult> => {
  if (!isQuickBooksConfigured()) return { ok: false, message: NOT_ON };
  const businessId = await getSessionBusinessId();
  if (!businessId) return { ok: false, message: "Not signed in." };
  const business = await loadBusiness(businessId);
  if (!business || !isQuickBooksOfferedTo(business)) {
    return { ok: false, message: NOT_ON };
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set(
    "client_id",
    process.env["QUICKBOOKS_CLIENT_ID"] as string,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", createOAuthState(businessId, PROVIDER));
  return { ok: true, url: url.toString() };
});

type QuickBooksTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
};

async function tokenRequest(
  body: Record<string, string>,
  what: string,
): Promise<QuickBooksTokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(),
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `QuickBooks ${what} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as QuickBooksTokenResponse;
}

const completeConnectionSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
  realmId: z.string().trim().min(1),
});

export type CompleteConnectionResult =
  { ok: true } | { ok: false; message: string };

export const completeQuickBooksConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => completeConnectionSchema.parse(input))
  .handler(async ({ data }): Promise<CompleteConnectionResult> => {
    if (!isQuickBooksConfigured()) return { ok: false, message: NOT_ON };

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
        message: "Please sign in and try connecting QuickBooks again.",
      };
    }

    try {
      const tokens = await tokenRequest(
        {
          grant_type: "authorization_code",
          code: data.code,
          redirect_uri: REDIRECT_URI,
        },
        "token exchange",
      );
      await saveConnection(verified.businessId, PROVIDER, {
        externalAccountId: data.realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt: expiryFrom(tokens.expires_in),
        scope: SCOPE,
      });
      return { ok: true };
    } catch (error) {
      // The unique index on (provider, external account) also lands here when
      // this QuickBooks company is already connected to another business.
      console.error("[quickbooks] failed to complete connection", error);
      return {
        ok: false,
        message: "Couldn't connect to QuickBooks. Please try again.",
      };
    }
  });

// Best effort: tells Intuit to cancel the connection's tokens when the owner
// disconnects from our side. Never throws; the row is deleted either way.
export async function revokeQuickBooksConnection(
  connection: CrmConnection,
): Promise<void> {
  if (!isQuickBooksConfigured()) return;
  try {
    const token = decryptRefreshToken(connection) ?? decryptAccessToken(connection);
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        authorization: basicAuthHeader(),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error(
        `[quickbooks] revoke answered ${response.status} ${await response.text()}`,
      );
    }
  } catch (error) {
    console.error("[quickbooks] revoke failed", error);
  }
}

// ---- Token refresh ---------------------------------------------------

export type ValidTokenResult =
  { ok: true; accessToken: string } | { ok: false; message: string };

function needsRefresh(connection: CrmConnection): boolean {
  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? 0;
  return expiresAt - Date.now() < REFRESH_MARGIN_MS;
}

// The refresh token Intuit just issued may exist nowhere else, so saving it
// is retried a few times before giving up.
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
        `[quickbooks] could not save the new tokens (attempt ${attempt} of 3)`,
        error,
      );
      if (attempt < 3) await sleep(250 * attempt);
    }
  }
  return false;
}

// Lazy refresh, guarded against two webhooks refreshing at once (see the
// header note): re-read the row before refreshing, and if the refresh call
// fails, look again in case another request just saved a new token.
export async function getValidQuickBooksAccessToken(
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

  const refreshToken = decryptRefreshToken(latest);
  if (!refreshToken) {
    await recordConnectionError(
      connection.id,
      "No refresh token on file. Please reconnect.",
    );
    return { ok: false, message: "No refresh token on file. Please reconnect." };
  }

  let tokens: QuickBooksTokenResponse;
  try {
    tokens = await tokenRequest(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      "token refresh",
    );
  } catch (error) {
    console.error("[quickbooks] token refresh failed", error);
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
      "QuickBooks access expired and couldn't be refreshed. Please reconnect.",
    );
    return { ok: false, message: "QuickBooks access expired. Please reconnect." };
  }

  const saved = await persistRotatedTokens(
    connection.id,
    tokens.access_token,
    tokens.refresh_token ?? refreshToken,
    expiryFrom(tokens.expires_in),
  );
  if (!saved) {
    await recordConnectionError(
      connection.id,
      "QuickBooks access could not be saved. Please reconnect.",
    );
  }
  return { ok: true, accessToken: tokens.access_token };
}

// ---- Accounting API reads ------------------------------------------------

type Ref = { value?: string; name?: string };

type QboLinkedTxn = { TxnId?: string; TxnType?: string };

type QboPayment = {
  Id?: string;
  CustomerRef?: Ref;
  Line?: Array<{ LinkedTxn?: QboLinkedTxn[] }>;
};

type QboInvoice = {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: Ref;
  BillEmail?: { Address?: string };
};

type QboSalesReceipt = {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  CustomerRef?: Ref;
  BillEmail?: { Address?: string };
};

type QboCustomer = {
  Id?: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  DisplayName?: string;
  Job?: boolean;
  ParentRef?: Ref;
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
  PrimaryEmailAddr?: { Address?: string };
};

const ENTITY_KEYS = {
  payment: "Payment",
  invoice: "Invoice",
  salesreceipt: "SalesReceipt",
  customer: "Customer",
} as const;

type EntityPath = keyof typeof ENTITY_KEYS;

// GET /v3/company/{realm}/{entity}/{id}. Null for a record that no longer
// exists (deleted between the event and our read).
async function readEntity<T>(
  accessToken: string,
  realmId: string,
  entity: EntityPath,
  id: string,
): Promise<T | null> {
  const url = `${apiBase()}/v3/company/${encodeURIComponent(realmId)}/${entity}/${encodeURIComponent(id)}?minorversion=${MINOR_VERSION}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    // A deleted record comes back as 400 with "Object Not Found" (code 610).
    if (response.status === 400 && /Object Not Found|"code":"610"/i.test(text)) {
      return null;
    }
    throw new Error(
      `QuickBooks ${entity} ${id} read failed: ${response.status} ${text}`,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  return (body[ENTITY_KEYS[entity]] as T | undefined) ?? null;
}

// ---- Webhook ---------------------------------------------------------

export function verifyQuickBooksWebhookSignature(
  rawBody: string,
  header: string | null,
): boolean {
  if (!header) return false;
  const key = process.env["QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN"];
  if (!key) return false;
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.trim(), "base64");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// One record that changed, whichever payload format it came in.
export type QuickBooksChange = {
  realmId: string;
  entity: string; // lower case: "payment", "invoice", "salesreceipt", ...
  operation: string; // lower case past tense: "created", "updated", ...
  id: string;
};

const LEGACY_OPERATIONS: Record<string, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  merge: "merged",
  void: "voided",
  emailed: "emailed",
};

// Reads both the CloudEvents array and the retired eventNotifications shape.
// Entries it cannot make sense of are dropped, never thrown on.
export function parseQuickBooksWebhook(payload: unknown): QuickBooksChange[] {
  const changes: QuickBooksChange[] = [];

  if (Array.isArray(payload)) {
    for (const raw of payload) {
      const event = raw as {
        type?: unknown;
        intuitentityid?: unknown;
        intuitaccountid?: unknown;
      };
      if (typeof event?.type !== "string") continue;
      const parts = event.type.toLowerCase().split(".");
      // qbo.<entity>.<event>.v1
      if (parts.length < 3 || parts[0] !== "qbo") continue;
      const realmId = event.intuitaccountid;
      const id = event.intuitentityid;
      if (
        (typeof realmId !== "string" && typeof realmId !== "number") ||
        (typeof id !== "string" && typeof id !== "number")
      ) {
        continue;
      }
      changes.push({
        realmId: String(realmId),
        entity: parts[1] as string,
        operation: parts[2] as string,
        id: String(id),
      });
    }
    return changes;
  }

  const legacy = payload as {
    eventNotifications?: Array<{
      realmId?: unknown;
      dataChangeEvent?: {
        entities?: Array<{ name?: unknown; id?: unknown; operation?: unknown }>;
      };
    }>;
  };
  for (const notification of legacy?.eventNotifications ?? []) {
    const realmId = notification?.realmId;
    if (typeof realmId !== "string" && typeof realmId !== "number") continue;
    for (const entity of notification.dataChangeEvent?.entities ?? []) {
      if (typeof entity?.name !== "string") continue;
      if (typeof entity.id !== "string" && typeof entity.id !== "number") {
        continue;
      }
      const op = String(entity.operation ?? "").toLowerCase();
      changes.push({
        realmId: String(realmId),
        entity: entity.name.toLowerCase(),
        operation: LEGACY_OPERATIONS[op] ?? op,
        id: String(entity.id),
      });
    }
  }
  return changes;
}

const RELEVANT_ENTITIES = new Set(["payment", "invoice", "salesreceipt"]);
const RELEVANT_OPERATIONS = new Set(["created", "updated"]);

export function isRelevantChange(change: QuickBooksChange): boolean {
  return (
    RELEVANT_ENTITIES.has(change.entity) &&
    RELEVANT_OPERATIONS.has(change.operation)
  );
}

function money(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isInvoicePaid(invoice: QboInvoice): boolean {
  return money(invoice.TotalAmt) > 0 && Math.abs(money(invoice.Balance)) < 0.005;
}

function pickPhone(customer: QboCustomer | null): string | null {
  const numbers = [
    customer?.Mobile?.FreeFormNumber,
    customer?.PrimaryPhone?.FreeFormNumber,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  // Prefer a number that will pass validation (a mobile first); if none will,
  // hand over the first so the event row can report the invalid number.
  return numbers.find((n) => normalizeUsPhone(n)) ?? numbers[0] ?? null;
}

// A QuickBooks "customer" can be a sub-customer (a job, e.g. "Smith:Kitchen
// remodel") whose name and phone live on the parent. Reads the parent when
// the job itself has no way to reach anyone.
async function resolveQuickBooksContact(
  accessToken: string,
  realmId: string,
  customerId: string,
  billEmail: string | null,
  documentLabel: string,
): Promise<PaidInvoiceContact> {
  let customer = await readEntity<QboCustomer>(
    accessToken,
    realmId,
    "customer",
    customerId,
  );
  let person = customer;
  if (customer?.Job && customer.ParentRef?.value) {
    const parent = await readEntity<QboCustomer>(
      accessToken,
      realmId,
      "customer",
      customer.ParentRef.value,
    );
    if (parent) {
      if (!pickPhone(customer) && !customer.PrimaryEmailAddr?.Address) {
        customer = parent;
      }
      person = parent;
    }
  }

  const name = resolveContactName({
    firstName: person?.GivenName,
    lastName: person?.FamilyName,
    companyName: person?.CompanyName || person?.DisplayName,
  });
  return {
    externalId: customerId,
    name: name?.name ?? "",
    logName: name?.logName ?? "",
    phone: pickPhone(customer),
    email: customer?.PrimaryEmailAddr?.Address?.trim() || billEmail,
    ids: `QuickBooks customer ID ${customerId}, ${documentLabel}`,
  };
}

type WebhookOutcome = { status: number; body: Record<string, unknown> };

function outcome(status: number, body: Record<string, unknown>): WebhookOutcome {
  return { status, body };
}

// A document (invoice or sales receipt) that is paid and should get one
// review request.
type PaidDocument = {
  dedupeKey: string;
  topic: string;
  customerId: string | null;
  billEmail: string | null;
  label: string; // "invoice 1042" / "sales receipt 88"
};

async function deliverForDocument(
  context: {
    connection: CrmConnection;
    business: Business;
    accessToken: string;
    realmId: string;
  },
  doc: PaidDocument,
): Promise<WebhookOutcome> {
  const claim = await claimWebhookEvent({
    provider: PROVIDER,
    dedupeKey: doc.dedupeKey,
    topic: doc.topic,
    businessId: context.business.id,
  });
  if (claim.status === "done") return outcome(200, { ok: true, deduped: true });
  if (claim.status === "busy") return outcome(503, { ok: false, reason: "busy" });

  // From here the claim is ours; a failure must hand it back so a retry (or
  // the next event for this document) can take over at once.
  let contact: PaidInvoiceContact;
  if (doc.customerId) {
    try {
      contact = await resolveQuickBooksContact(
        context.accessToken,
        context.realmId,
        doc.customerId,
        doc.billEmail,
        doc.label,
      );
    } catch (error) {
      console.error("[quickbooks-webhook] customer lookup failed", error);
      await failWebhookEvent(
        claim.eventId,
        error instanceof Error ? error.message : String(error),
      );
      return outcome(500, { ok: false, reason: "failed" });
    }
  } else {
    // A sales receipt rung up without a customer (a walk-in): nothing to
    // greet anyone by, which deliverPaidInvoiceRequest skips with a reason.
    contact = {
      externalId: null,
      name: "",
      logName: "",
      phone: null,
      email: doc.billEmail,
      ids: `no QuickBooks customer, ${doc.label}`,
    };
  }

  const result = await deliverPaidInvoiceRequest({
    claim,
    business: context.business,
    connection: context.connection,
    source: PROVIDER,
    contact,
  });
  if (result.kind === "failed") return outcome(500, { ok: false, reason: "failed" });
  return outcome(200, {
    ok: true,
    reason: result.kind === "skipped" ? "skipped" : "sent",
  });
}

function invoiceDocument(realmId: string, invoice: QboInvoice, topic: string): PaidDocument {
  return {
    dedupeKey: `invoice-paid:${realmId}:${invoice.Id}`,
    topic,
    customerId: invoice.CustomerRef?.value ?? null,
    billEmail: invoice.BillEmail?.Address?.trim() || null,
    label: `invoice ${invoice.DocNumber || invoice.Id}`,
  };
}

// Handles one changed record. Never throws; returns what to tell Intuit
// (used when answering after the work, logged otherwise).
export async function processQuickBooksChange(
  change: QuickBooksChange,
): Promise<WebhookOutcome> {
  try {
    const connection = await findConnectionByExternalAccountId(
      PROVIDER,
      change.realmId,
    );
    if (!connection) return outcome(200, { ok: true, reason: "no_connection" });

    const [business] = await getDb()
      .select()
      .from(businesses)
      .where(eq(businesses.id, connection.businessId))
      .limit(1);
    if (!business) return outcome(200, { ok: true, reason: "no_business" });

    const topic = `qbo.${change.entity}.${change.operation}`;

    if (business.accessRevoked) {
      await recordSkippedWebhookEvent({
        provider: PROVIDER,
        dedupeKey: `skipped-inactive:${change.entity}:${change.realmId}:${change.id}`,
        topic,
        businessId: business.id,
        reason: "Skipped: account not active, so no review request was sent.",
      });
      return outcome(200, { ok: true, reason: "account_inactive" });
    }

    // Cheap "already handled?" checks before spending API calls.
    if (
      change.entity === "invoice" &&
      (await isWebhookEventDone(
        PROVIDER,
        `invoice-paid:${change.realmId}:${change.id}`,
      ))
    ) {
      return outcome(200, { ok: true, deduped: true });
    }
    if (
      change.entity === "salesreceipt" &&
      (await isWebhookEventDone(
        PROVIDER,
        `salesreceipt-paid:${change.realmId}:${change.id}`,
      ))
    ) {
      return outcome(200, { ok: true, deduped: true });
    }

    const token = await getValidQuickBooksAccessToken(connection);
    if (!token.ok) return outcome(502, { ok: false, reason: "token_refresh_failed" });

    const context = {
      connection,
      business,
      accessToken: token.accessToken,
      realmId: change.realmId,
    };

    if (change.entity === "salesreceipt") {
      const receipt = await readEntity<QboSalesReceipt>(
        token.accessToken,
        change.realmId,
        "salesreceipt",
        change.id,
      );
      if (!receipt?.Id) return outcome(200, { ok: true, reason: "not_found" });
      if (money(receipt.TotalAmt) <= 0) {
        return outcome(200, { ok: true, reason: "zero_amount" });
      }
      return await deliverForDocument(context, {
        dedupeKey: `salesreceipt-paid:${change.realmId}:${receipt.Id}`,
        topic,
        customerId: receipt.CustomerRef?.value ?? null,
        billEmail: receipt.BillEmail?.Address?.trim() || null,
        label: `sales receipt ${receipt.DocNumber || receipt.Id}`,
      });
    }

    if (change.entity === "invoice") {
      const invoice = await readEntity<QboInvoice>(
        token.accessToken,
        change.realmId,
        "invoice",
        change.id,
      );
      if (!invoice?.Id) return outcome(200, { ok: true, reason: "not_found" });
      if (!isInvoicePaid(invoice)) {
        return outcome(200, { ok: true, reason: "not_paid" });
      }
      return await deliverForDocument(
        context,
        invoiceDocument(change.realmId, invoice, topic),
      );
    }

    // Payment: find the invoices it settled, keep the fully paid ones.
    const payment = await readEntity<QboPayment>(
      token.accessToken,
      change.realmId,
      "payment",
      change.id,
    );
    if (!payment?.Id) return outcome(200, { ok: true, reason: "not_found" });

    const invoiceIds = [
      ...new Set(
        (payment.Line ?? [])
          .flatMap((line) => line.LinkedTxn ?? [])
          .filter((txn) => txn.TxnType === "Invoice" && txn.TxnId)
          .map((txn) => txn.TxnId as string),
      ),
    ];
    if (invoiceIds.length === 0) {
      return outcome(200, { ok: true, reason: "no_linked_invoice" });
    }

    const paid: QboInvoice[] = [];
    for (const invoiceId of invoiceIds) {
      if (
        await isWebhookEventDone(
          PROVIDER,
          `invoice-paid:${change.realmId}:${invoiceId}`,
        )
      ) {
        continue;
      }
      const invoice = await readEntity<QboInvoice>(
        token.accessToken,
        change.realmId,
        "invoice",
        invoiceId,
      );
      if (invoice?.Id && isInvoicePaid(invoice)) paid.push(invoice);
    }
    if (paid.length === 0) return outcome(200, { ok: true, reason: "not_paid" });

    // One request per customer per payment: the first paid invoice sends,
    // the others for the same customer are closed with a note so a later
    // invoice event does not send for them either.
    let worst: WebhookOutcome = outcome(200, { ok: true, reason: "sent" });
    const handledCustomers = new Map<string, string>();
    for (const invoice of paid) {
      const doc = invoiceDocument(change.realmId, invoice, topic);
      const customerKey = doc.customerId ?? `none:${invoice.Id}`;
      const firstLabel = handledCustomers.get(customerKey);
      if (firstLabel) {
        await recordSkippedWebhookEvent({
          provider: PROVIDER,
          dedupeKey: doc.dedupeKey,
          topic,
          businessId: business.id,
          reason: `Skipped: paid in the same payment as ${firstLabel}, which already covers this customer (${doc.label}).`,
        });
        continue;
      }
      const result = await deliverForDocument(context, doc);
      if (result.status === 200) handledCustomers.set(customerKey, doc.label);
      if (result.status > worst.status) worst = result;
    }
    return worst;
  } catch (error) {
    console.error("[quickbooks-webhook] failed to process change", error);
    return outcome(500, { ok: false, reason: "failed" });
  }
}

async function processAll(changes: QuickBooksChange[]): Promise<WebhookOutcome> {
  let worst: WebhookOutcome = outcome(200, { ok: true, reason: "nothing_to_do" });
  // In order, one at a time: Intuit sends one company at a time and the
  // token refresh is per company, so running them in parallel only adds
  // refresh races.
  for (const change of changes) {
    const result = await processQuickBooksChange(change);
    if (worst.body["reason"] === "nothing_to_do" || result.status > worst.status) {
      worst = result;
    }
  }
  return worst;
}

// Entry point for the /webhooks/quickbooks server route's POST handler.
//
// Intuit allows 3 seconds, which a real run (token refresh, two or three
// record reads, a text, an email) can exceed. So after the cheap checks the
// handler answers 200 at once and finishes in the background when the host
// can keep the function alive; otherwise it does the work first (slower, but
// a retry after a timeout lands on the per-document claim and is never
// processed twice). Same trade-off as the Jobber handler: once Intuit has
// been told "ok" it will not retry, but a failed run leaves its claim marked
// failed, so the next event for that invoice (Intuit sends one per payment
// AND per invoice change) takes over.
export async function handleQuickBooksWebhookRequest(
  request: Request,
): Promise<Response> {
  if (!isQuickBooksWebhookConfigured()) {
    return webhookJson(503, { ok: false, reason: "not_configured" });
  }

  const rawBody = await request.text();
  if (
    !verifyQuickBooksWebhookSignature(
      rawBody,
      request.headers.get("intuit-signature"),
    )
  ) {
    console.error(
      "[quickbooks-webhook] signature did not match. Check QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN against the Verifier Token on the Intuit Webhooks page (Development and Production have different tokens).",
    );
    return webhookJson(401, { ok: false, reason: "bad_signature" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return webhookJson(400, { ok: false, reason: "bad_payload" });
  }

  // Same record twice in one delivery (a create and an update together) is
  // handled once.
  const seen = new Set<string>();
  const changes = parseQuickBooksWebhook(payload)
    .filter(isRelevantChange)
    .filter((change) => {
      const key = `${change.realmId}:${change.entity}:${change.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (changes.length === 0) {
    return webhookJson(200, { ok: true, reason: "ignored" });
  }

  const work = processAll(changes);
  const schedule = getBackgroundScheduler(request);
  if (schedule) {
    schedule(
      work.then(
        (result) => {
          console.log(
            `[quickbooks-webhook] background run finished with ${result.status}: ${JSON.stringify(result.body)}`,
          );
        },
        (error) => {
          console.error("[quickbooks-webhook] background run crashed", error);
        },
      ),
    );
    return webhookJson(200, { ok: true, accepted: true, mode: "background" });
  }

  console.warn(
    "[quickbooks-webhook] no background hook on this host, answering after the work (may exceed Intuit's 3 second limit)",
  );
  const result = await work;
  return webhookJson(result.status, { ...result.body, mode: "inline" });
}
