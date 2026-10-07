// Heads-up emails to the owner (hello@uptrendscaling.com) about money events
// that Stripe reports to our webhook (see ./stripe-webhook.server.ts):
//
//   A. "New signup": a client started the free trial or joined as a paying
//      member. Trigger: checkout.session.completed (subscription mode).
//   B. "Trial client paid": a trial client was charged for real for the first
//      time (normally day 7, when the free trial ends). Trigger: invoice.paid
//      (or invoice.payment_succeeded, same data) for a subscription whose plan
//      is "trial", with money actually collected, that is not the $0 invoice
//      created when the trial started.
//   C. "Membership canceled": a subscription ended, whether the client used the
//      Cancel membership button in their dashboard, it was canceled in the
//      Stripe dashboard, or Stripe ended it after failed payments. Trigger:
//      customer.subscription.deleted. The webhook turns the client's dashboard
//      access off first, then calls this.
//
// Everything here is best-effort and fenced off from the webhook proper:
// sendOwnerAlertForEvent() never throws and never changes what Stripe is told,
// so a Resend outage can never cause Stripe to retry (or disable) the endpoint,
// and the subscription access logic keeps working exactly as before.
//
// "Exactly once" is built on crm_webhook_events: a row with provider "stripe"
// is a claim marker (not a CRM event), with a dedupe key per real-world action:
//   signup:<subscription id, or checkout session id>
//   trial-paid:<subscription id>
//   cancel:<subscription id>
// Stripe retries deliveries and sends several events for one action, so the
// insert-or-skip claim is what keeps it to one email. If the email fails the
// claim is deleted so a dashboard "Resend event" can send it later.

import { and, eq, isNull, lt } from "drizzle-orm";
import type Stripe from "stripe";

import { getDb } from "./db/client";
import { businesses, crmWebhookEvents } from "./db/schema";
import {
  isResendConfigured,
  sendEmail,
  UPTREND_SUPPORT_EMAIL,
} from "./messaging.server";
import {
  EMAIL_FONT,
  button as emailButton,
  card as emailCard,
  detailRows as emailDetailRows,
  emailShell,
  eyebrow as emailEyebrow,
  mutedPara as emailMutedPara,
  paraHtml as emailParaHtml,
  type EmailSection,
} from "./email-layout";
import { MONTHLY_PRICE_CENTS, SETUP_FEE_CENTS, TRIAL_DAYS } from "./pricing";

const PROVIDER = "stripe" as const;

// Stripe event types that can produce an alert. invoice.paid and
// invoice.payment_succeeded describe the same payment; both are accepted so it
// does not matter which one is ticked in the Stripe dashboard (and if both are,
// the dedupe key keeps it to a single email).
const SIGNUP_EVENT = "checkout.session.completed";
const PAID_INVOICE_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_succeeded",
]);

// Unlike the two events above, this one also changes dashboard access (see
// ./stripe-webhook.server.ts), so the webhook runs its access logic first and
// only then asks for the alert.
export const CANCEL_ALERT_EVENT = "customer.subscription.deleted";

// Written into the Stripe subscription's cancellation details by the Cancel
// membership button (see ./membership.server.ts), so the alert can say the
// client canceled it themselves rather than it being done in Stripe.
export const DASHBOARD_CANCEL_COMMENT =
  "Canceled by the customer from the UpTrend Scaling dashboard";

export function isOwnerAlertEventType(type: string): boolean {
  return (
    type === SIGNUP_EVENT ||
    type === CANCEL_ALERT_EVENT ||
    PAID_INVOICE_EVENTS.has(type)
  );
}

// ---- Timing budget --------------------------------------------------------
// The alert runs inside the webhook request, so it must be quick. The email
// call gets about 5 seconds; the whole alert (database claim, optional Stripe
// lookups, email) gets a bit more, after which the webhook answers Stripe
// anyway and the alert is abandoned. An abandoned claim goes stale after
// STALE_CLAIM_MS and can then be re-taken by a "Resend event".
const SEND_TIMEOUT_MS = 5_000;
const OVERALL_TIMEOUT_MS = 9_000;
const STALE_CLAIM_MS = 2 * 60 * 1000;

const TIMED_OUT = Symbol("timed-out");

async function raceTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---- Small helpers --------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// Stripe fields that are either an id string or the expanded object.
function idOf(value: unknown): string | null {
  return (
    nonEmptyString(value) ??
    (isPlainObject(value) ? nonEmptyString(value["id"]) : null)
  );
}

function metadataOf(value: unknown): Record<string, string> | null {
  if (!isPlainObject(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function parseLocations(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Email subjects are plain text, not HTML, but they carry customer-typed
// business names: flatten line breaks and control characters, and cap length.
function cleanForSubject(value: string, max = 80): string {
  const flat = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

export function formatMoney(
  cents: number,
  currency: string | null | undefined,
): string {
  const code = (currency ?? "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

// Colby and the LLC are in Arizona (no daylight saving), so dates read the way
// he thinks about them.
const DISPLAY_TIME_ZONE = "America/Phoenix";

export function formatDateTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(unixSeconds * 1000));
}

export function formatDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(unixSeconds * 1000));
}

export function dashboardUrl(
  livemode: boolean,
  kind: "customers" | "subscriptions" | "invoices",
  id: string,
): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}${kind}/${encodeURIComponent(id)}`;
}

function expectedFirstChargeCents(locations: number): number {
  return MONTHLY_PRICE_CENTS * locations + SETUP_FEE_CENTS;
}

function expectedFirstChargeFormula(
  locations: number,
  currency: string | null,
): string {
  const plural = locations === 1 ? "location" : "locations";
  return `${formatMoney(MONTHLY_PRICE_CENTS, currency)} x ${locations} ${plural} + ${formatMoney(
    SETUP_FEE_CENTS,
    currency,
  )} setup fee`;
}

// ---- Email layout ---------------------------------------------------------

type AlertRow = { label: string; value: string };
type AlertLink = { label: string; url: string };

type AlertLayout = {
  subject: string;
  preheader: string;
  tone: "trial" | "paid";
  badge: string;
  headline: string;
  subline: string;
  testMode: boolean;
  rows: AlertRow[];
  links: AlertLink[];
  note: string | null;
};

// Same design as the cold-outreach and welcome emails (see ./email-layout.ts):
// dark wordmark header, white card, light grey details box, dark button. No
// images, light colors only, table-based with inline styles. Rows are
// label/value pairs so the plain-text version Resend derives reads cleanly top
// to bottom. Every dynamic value goes through escapeHtml (inside the layout
// helpers, or explicitly below for the headline).
export function renderAlertEmail(layout: AlertLayout): string {
  const e = escapeHtml;

  const headlineBlock = `${emailEyebrow(layout.badge)}
        <h1 style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:#18181b;">${e(layout.headline)}</h1>
        ${emailParaHtml(e(layout.subline), 0)}`;

  const buttons = layout.links
    .map(
      (link, index) =>
        `<div style="margin:0 0 10px;">${emailButton(link.label, link.url, index === 0 ? "primary" : "secondary")}</div>`,
    )
    .join("\n        ");

  const sections: EmailSection[] = [
    { top: 32, bottom: 12, html: headlineBlock },
    {
      top: 8,
      bottom: 12,
      html: emailCard("Details", emailDetailRows(layout.rows)),
    },
  ];
  if (layout.note) {
    sections.push({
      top: 8,
      bottom: 8,
      html: emailMutedPara(layout.note, 0),
    });
  }
  if (buttons) {
    sections.push({ top: 16, bottom: 18, html: buttons });
  }

  return emailShell({
    subject: layout.subject,
    preheader: layout.preheader,
    tagline: "Owner alert",
    bannerText: layout.testMode
      ? "Test mode event from Stripe. No real money moved and this is not a real client."
      : null,
    sections,
    footerLines: [
      `Owner alert from UpTrend Scaling. Sent to ${UPTREND_SUPPORT_EMAIL}.`,
    ],
  });
}

// ---- Alert A: new signup --------------------------------------------------

export type OwnerAlert = {
  // Becomes crm_webhook_events.dedupe_key (provider "stripe").
  dedupeKey: string;
  subject: string;
  html: string;
};

type EventContext = { livemode: boolean; created: number; type: string };

// Pure: turns a completed Checkout session into the email, or null when the
// session is not a subscription signup. Uses Stripe's own numbers (amount_total
// is exactly what was collected at checkout, promo codes included).
export function buildSignupAlert(
  session: Stripe.Checkout.Session,
  ctx: EventContext,
): OwnerAlert | null {
  if (session.mode !== "subscription") return null;

  const metadata = metadataOf(session.metadata) ?? {};
  const plan = metadata["plan"] ?? null;
  const isTrial = plan === "trial";
  const isMember = plan === "membership";

  const email =
    nonEmptyString(session.customer_details?.email) ??
    nonEmptyString(session.customer_email);
  const businessName =
    nonEmptyString(metadata["businessName"]) ??
    nonEmptyString(session.customer_details?.name);
  const contactName =
    nonEmptyString(metadata["contactName"]) ??
    nonEmptyString(session.customer_details?.name);
  const phone =
    nonEmptyString(metadata["phone"]) ??
    nonEmptyString(session.customer_details?.phone);
  const locations = parseLocations(metadata["locations"]);

  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);

  const currency = session.currency ?? "usd";
  const dueToday =
    typeof session.amount_total === "number" ? session.amount_total : null;
  const discount = session.total_details?.amount_discount ?? 0;
  const paymentPending = session.payment_status === "unpaid";

  const displayName = businessName ?? email ?? "Unknown business";
  const testPrefix = ctx.livemode ? "" : "[TEST] ";
  const kindLabel = isTrial
    ? "New free trial"
    : isMember
      ? "New member"
      : "New signup";
  const subject = `${testPrefix}${kindLabel}: ${cleanForSubject(displayName)}`;

  const trialEnd = ctx.created + TRIAL_DAYS * 24 * 60 * 60;
  const planText = isTrial
    ? `Free trial (${TRIAL_DAYS} days, card on file)`
    : isMember
      ? "Membership (starts billing today)"
      : "Not recorded";

  const rows: AlertRow[] = [
    { label: "Business", value: businessName ?? "Not provided" },
    { label: "Contact", value: contactName ?? "Not provided" },
    { label: "Email", value: email ?? "Not provided" },
    { label: "Phone", value: phone ?? "Not provided" },
    {
      label: "Locations",
      value: locations === null ? "Not provided" : String(locations),
    },
    { label: "Plan", value: planText },
    {
      label: "Due today",
      value:
        dueToday === null
          ? "Not reported by Stripe"
          : paymentPending
            ? `${formatMoney(dueToday, currency)} (payment still pending)`
            : formatMoney(dueToday, currency),
    },
  ];
  if (discount > 0) {
    rows.push({
      label: "Discount",
      value: `${formatMoney(discount, currency)} off (promo code)`,
    });
  }
  if (isTrial) {
    rows.push({ label: "Trial ends", value: formatDate(trialEnd) });
    if (locations !== null) {
      rows.push({
        label: "First charge",
        value: `About ${formatMoney(expectedFirstChargeCents(locations), currency)} on that date (${expectedFirstChargeFormula(locations, currency)}), before any promo code`,
      });
    }
  }
  rows.push({ label: "Signed up", value: formatDateTime(ctx.created) });

  const links: AlertLink[] = [];
  if (customerId) {
    links.push({
      label: "Open customer in Stripe",
      url: dashboardUrl(ctx.livemode, "customers", customerId),
    });
  }
  if (subscriptionId) {
    links.push({
      label: "Open subscription in Stripe",
      url: dashboardUrl(ctx.livemode, "subscriptions", subscriptionId),
    });
  }

  const note = isTrial
    ? "Nothing was charged today. The card on file is billed automatically when the trial ends, and you will get a second email when that payment goes through."
    : isMember
      ? paymentPending
        ? "This client chose to pay today, but Stripe has not confirmed the payment yet."
        : "This client skipped the free trial and paid at checkout."
      : null;

  const html = renderAlertEmail({
    subject,
    preheader: isTrial
      ? `${displayName} started a free trial. Nothing is due today.`
      : `${displayName} signed up${dueToday === null ? "" : ` and paid ${formatMoney(dueToday, currency)} today`}.`,
    tone: isTrial ? "trial" : "paid",
    badge: isTrial
      ? "Free trial started"
      : isMember
        ? "New member"
        : "New signup",
    headline: displayName,
    subline: isTrial
      ? "Just started the 7 day free trial."
      : isMember
        ? "Just joined as a paying member."
        : "Just signed up through checkout.",
    testMode: !ctx.livemode,
    rows,
    links,
    note,
  });

  return {
    dedupeKey: `signup:${subscriptionId ?? session.id}`,
    subject,
    html,
  };
}

// ---- Alert B: trial client paid -------------------------------------------

// Where the subscription lives on an invoice depends on the Stripe API version
// the webhook endpoint is pinned to. Newer versions: invoice.parent
// .subscription_details.{subscription,metadata}. Older versions: a top-level
// invoice.subscription (and invoice.subscription_details.metadata). The SDK
// types only describe the newer shape, so this reads both through plain
// objects instead of trusting either one.
export function readInvoiceSubscription(invoice: Stripe.Invoice): {
  subscriptionId: string | null;
  metadata: Record<string, string> | null;
} {
  const raw = invoice as unknown as PlainObject;
  const parent = isPlainObject(raw["parent"]) ? raw["parent"] : null;
  const parentDetails =
    parent && isPlainObject(parent["subscription_details"])
      ? parent["subscription_details"]
      : null;
  const legacyDetails = isPlainObject(raw["subscription_details"])
    ? raw["subscription_details"]
    : null;
  const legacySubscription = raw["subscription"];

  const subscriptionId =
    idOf(parentDetails?.["subscription"]) ??
    idOf(legacySubscription) ??
    idOf(legacyDetails?.["subscription"]);

  const metadata =
    metadataOf(parentDetails?.["metadata"]) ??
    metadataOf(legacyDetails?.["metadata"]) ??
    (isPlainObject(legacySubscription)
      ? metadataOf(legacySubscription["metadata"])
      : null);

  return { subscriptionId, metadata };
}

// Cheap checks that need no network: money actually changed hands, and it is
// not the $0 invoice Stripe creates when a trial subscription starts.
export function isRealChargeAfterSubscriptionStart(
  invoice: Stripe.Invoice,
): boolean {
  return (
    invoice.amount_paid > 0 && invoice.billing_reason !== "subscription_create"
  );
}

function invoiceLineSummaries(
  invoice: Stripe.Invoice,
  currency: string,
): string[] {
  const lines = isPlainObject(invoice.lines) ? invoice.lines["data"] : null;
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const line of lines) {
    if (!isPlainObject(line) || typeof line["amount"] !== "number") continue;
    const description = nonEmptyString(line["description"]) ?? "Line item";
    out.push(`${description}: ${formatMoney(line["amount"], currency)}`);
  }
  return out;
}

// Pure: builds the "trial client paid" email from the invoice Stripe sent plus
// the subscription's metadata. The amount is whatever Stripe says was paid.
export function buildTrialPaymentAlert(
  invoice: Stripe.Invoice,
  subscriptionId: string,
  metadata: Record<string, string>,
  ctx: EventContext,
): OwnerAlert {
  const businessName = nonEmptyString(metadata["businessName"]);
  const contactName =
    nonEmptyString(metadata["contactName"]) ??
    nonEmptyString(invoice.customer_name);
  const phone = nonEmptyString(metadata["phone"]);
  const email = nonEmptyString(invoice.customer_email);
  const locations = parseLocations(metadata["locations"]);
  const customerId = idOf(invoice.customer);

  const currency = invoice.currency ?? "usd";
  const paid = invoice.amount_paid;
  const paidAt = invoice.status_transitions?.paid_at ?? ctx.created;

  const displayName = businessName ?? email ?? "Unknown business";
  const testPrefix = ctx.livemode ? "" : "[TEST] ";
  const subject = `${testPrefix}Trial client paid: ${cleanForSubject(displayName)} (${formatMoney(paid, currency)})`;

  const rows: AlertRow[] = [
    { label: "Business", value: businessName ?? "Not provided" },
    { label: "Contact", value: contactName ?? "Not provided" },
    { label: "Email", value: email ?? "Not provided" },
    { label: "Phone", value: phone ?? "Not provided" },
    {
      label: "Locations",
      value: locations === null ? "Not provided" : String(locations),
    },
    { label: "Amount paid", value: formatMoney(paid, currency) },
  ];
  const lineSummaries = invoiceLineSummaries(invoice, currency);
  lineSummaries.forEach((text, index) => {
    rows.push({ label: index === 0 ? "Charged for" : "", value: text });
  });
  rows.push({ label: "Paid on", value: formatDateTime(paidAt) });
  const invoiceNumber = nonEmptyString(invoice.number);
  if (invoiceNumber) rows.push({ label: "Invoice", value: invoiceNumber });

  // The first charge should be the monthly price per location plus the one-time
  // setup fee. Say whether Stripe's real amount matches, but never replace it.
  let note: string | null = null;
  if (locations !== null) {
    const expected = expectedFirstChargeCents(locations);
    note =
      paid === expected
        ? `This matches the usual first charge (${expectedFirstChargeFormula(locations, currency)}).`
        : `The usual first charge for ${locations} ${locations === 1 ? "location" : "locations"} is ${formatMoney(expected, currency)} (${expectedFirstChargeFormula(locations, currency)}), but Stripe collected ${formatMoney(paid, currency)}. A promo code, a changed quantity or a missing setup fee can explain that, so it is worth a quick look in Stripe.`;
  }

  const links: AlertLink[] = [];
  if (customerId) {
    links.push({
      label: "Open customer in Stripe",
      url: dashboardUrl(ctx.livemode, "customers", customerId),
    });
  }
  links.push({
    label: "Open subscription in Stripe",
    url: dashboardUrl(ctx.livemode, "subscriptions", subscriptionId),
  });
  if (invoice.id) {
    links.push({
      label: "Open invoice in Stripe",
      url: dashboardUrl(ctx.livemode, "invoices", invoice.id),
    });
  }

  const html = renderAlertEmail({
    subject,
    preheader: `${displayName} paid ${formatMoney(paid, currency)} after the free trial.`,
    tone: "paid",
    badge: "Trial client paid",
    headline: displayName,
    subline: `Paid ${formatMoney(paid, currency)} after the free trial. This is their first real payment.`,
    testMode: !ctx.livemode,
    rows,
    links,
    note,
  });

  return { dedupeKey: `trial-paid:${subscriptionId}`, subject, html };
}

// ---- Alert C: membership canceled -----------------------------------------

// What our own database knows about the client whose subscription ended. The
// signup details also ride along in the subscription metadata, so a missing
// account (null) still produces a useful email.
export type CanceledAccount = {
  businessName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  locations: number | null;
};

// Human wording for who or what ended the subscription.
function cancellationSource(subscription: Stripe.Subscription): string {
  const details = subscription.cancellation_details;
  if (details?.comment === DASHBOARD_CANCEL_COMMENT) {
    return "The client, using Cancel membership in their dashboard";
  }
  if (details?.reason === "payment_failed") {
    return "Stripe, automatically, after payments kept failing";
  }
  if (details?.reason === "payment_disputed") {
    return "Stripe, automatically, after a payment dispute";
  }
  return "Canceled in the Stripe dashboard";
}

// Pure: turns a deleted subscription into the email. Null when the event has no
// subscription id to dedupe on. `account` is the matching row from our own
// database (null when none was found, for example a subscription that was never
// claimed by an account).
export function buildCancellationAlert(
  subscription: Stripe.Subscription,
  account: CanceledAccount | null,
  ctx: EventContext,
): OwnerAlert | null {
  const subscriptionId = nonEmptyString(subscription.id);
  if (!subscriptionId) return null;

  const metadata = metadataOf(subscription.metadata) ?? {};
  const plan = metadata["plan"] ?? null;
  const businessName =
    account?.businessName ?? nonEmptyString(metadata["businessName"]);
  const contactName =
    account?.contactName ?? nonEmptyString(metadata["contactName"]);
  const email = account?.email ?? null;
  const phone = account?.phone ?? nonEmptyString(metadata["phone"]);
  const locations = account?.locations ?? parseLocations(metadata["locations"]);
  const customerId = idOf(subscription.customer);

  const canceledAt =
    typeof subscription.canceled_at === "number"
      ? subscription.canceled_at
      : ctx.created;
  const trialEnd =
    typeof subscription.trial_end === "number" ? subscription.trial_end : null;
  const duringTrial = trialEnd !== null && trialEnd > canceledAt;
  const startedAt =
    typeof subscription.start_date === "number"
      ? subscription.start_date
      : typeof subscription.created === "number"
        ? subscription.created
        : null;

  const displayName = businessName ?? email ?? "Unknown business";
  const testPrefix = ctx.livemode ? "" : "[TEST] ";
  const subject = `${testPrefix}Membership canceled: ${cleanForSubject(displayName)}`;

  const planText =
    plan === "trial"
      ? `Free trial (${TRIAL_DAYS} days, card on file)`
      : plan === "membership"
        ? "Membership (billing from day one)"
        : "Not recorded";

  const rows: AlertRow[] = [
    { label: "Business", value: businessName ?? "Not provided" },
    { label: "Contact", value: contactName ?? "Not provided" },
    { label: "Email", value: email ?? "Not provided" },
    { label: "Phone", value: phone ?? "Not provided" },
    {
      label: "Locations",
      value: locations === null ? "Not provided" : String(locations),
    },
    { label: "Plan", value: planText },
    { label: "Canceled by", value: cancellationSource(subscription) },
    {
      label: "Timing",
      value: duringTrial
        ? "During the free trial, nothing was ever charged"
        : "After billing had started",
    },
  ];
  if (startedAt !== null) {
    rows.push({ label: "Signed up", value: formatDateTime(startedAt) });
  }
  rows.push({ label: "Canceled", value: formatDateTime(canceledAt) });

  const links: AlertLink[] = [];
  if (customerId) {
    links.push({
      label: "Open customer in Stripe",
      url: dashboardUrl(ctx.livemode, "customers", customerId),
    });
  }
  links.push({
    label: "Open subscription in Stripe",
    url: dashboardUrl(ctx.livemode, "subscriptions", subscriptionId),
  });

  const note = account
    ? "Their dashboard access was turned off automatically and no further charges will happen. Their customer data is kept."
    : "No matching dashboard account was found for this subscription, so there was no access to turn off. No further charges will happen.";

  const html = renderAlertEmail({
    subject,
    preheader: duringTrial
      ? `${displayName} canceled during the free trial. Nothing was charged.`
      : `${displayName} canceled their membership.`,
    tone: duringTrial ? "trial" : "paid",
    badge: duringTrial ? "Canceled during free trial" : "Membership canceled",
    headline: displayName,
    subline: duringTrial
      ? "Canceled before the free trial ended."
      : "Canceled their membership.",
    testMode: !ctx.livemode,
    rows,
    links,
    note,
  });

  return { dedupeKey: `cancel:${subscriptionId}`, subject, html };
}

// ---- Claiming (exactly once) ----------------------------------------------

type Claim = { id: string };

// Insert-or-skip. Returns the claim when this delivery owns the alert, or null
// when it was already handled (or is being handled right now). An unfinished
// claim older than STALE_CLAIM_MS (the process died or timed out between
// claiming and sending) is taken over in a single UPDATE, so two deliveries
// cannot both take it.
async function claimAlert(
  dedupeKey: string,
  topic: string,
): Promise<Claim | null> {
  const db = getDb();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [inserted] = await db
      .insert(crmWebhookEvents)
      .values({ provider: PROVIDER, dedupeKey, topic })
      .onConflictDoNothing({
        target: [crmWebhookEvents.provider, crmWebhookEvents.dedupeKey],
      })
      .returning({ id: crmWebhookEvents.id });
    if (inserted) return { id: inserted.id };

    const [taken] = await db
      .update(crmWebhookEvents)
      .set({ receivedAt: new Date(), topic })
      .where(
        and(
          eq(crmWebhookEvents.provider, PROVIDER),
          eq(crmWebhookEvents.dedupeKey, dedupeKey),
          isNull(crmWebhookEvents.processedAt),
          lt(
            crmWebhookEvents.receivedAt,
            new Date(Date.now() - STALE_CLAIM_MS),
          ),
        ),
      )
      .returning({ id: crmWebhookEvents.id });
    if (taken) return { id: taken.id };

    // Not claimable. If the row is still there it was handled or is in flight.
    // If it vanished (another delivery released its claim after a failed send
    // between our insert and our update), go around once and try to claim it.
    const [existing] = await db
      .select({ id: crmWebhookEvents.id })
      .from(crmWebhookEvents)
      .where(
        and(
          eq(crmWebhookEvents.provider, PROVIDER),
          eq(crmWebhookEvents.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);
    if (existing) return null;
  }
  return null;
}

async function finishClaim(
  claim: Claim,
  errorMessage: string | null,
): Promise<void> {
  try {
    await getDb()
      .update(crmWebhookEvents)
      .set({ processedAt: new Date(), errorMessage })
      .where(eq(crmWebhookEvents.id, claim.id));
  } catch (error) {
    console.error("[owner-alerts] failed to mark alert as sent", error);
  }
}

// Frees the dedupe key so a Stripe "Resend event" can try again.
async function releaseClaim(claim: Claim): Promise<void> {
  try {
    await getDb()
      .delete(crmWebhookEvents)
      .where(eq(crmWebhookEvents.id, claim.id));
  } catch (error) {
    console.error("[owner-alerts] failed to release alert claim", error);
  }
}

// ---- Sending --------------------------------------------------------------

// The display name makes these easy to filter in Gmail; the address is the
// same support inbox the welcome email already sends from.
const ALERT_FROM = `UpTrend Scaling Alerts <${UPTREND_SUPPORT_EMAIL}>`;

async function deliverAlert(claim: Claim, alert: OwnerAlert): Promise<void> {
  let failure: string | null = null;
  try {
    // The Resend idempotency key is tied to this claim's row id. If this
    // process dies after Resend accepted the email but before the claim was
    // marked done, the stale-claim takeover reuses the same row (same key) and
    // Resend answers with the first result instead of sending a second email.
    // A released claim is deleted, so a later retry gets a new row and a new key
    // and cannot be blocked by a remembered failure.
    const result = await raceTimeout(
      sendEmail(
        UPTREND_SUPPORT_EMAIL,
        alert.subject,
        alert.html,
        ALERT_FROM,
        undefined,
        { idempotencyKey: `owner-alert-${claim.id}` },
      ),
      SEND_TIMEOUT_MS,
    );
    if (result === TIMED_OUT) failure = "email request timed out";
    else if (!result.ok) failure = result.error;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure) {
    console.error(
      `[owner-alerts] could not send "${alert.subject}": ${failure}`,
    );
    await releaseClaim(claim);
    return;
  }
  await finishClaim(claim, null);
}

// ---- Stripe lookups (only when the event itself is not enough) ------------

async function fetchSubscriptionMetadata(
  stripe: Stripe,
  subscriptionId: string,
): Promise<Record<string, string> | null> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return metadataOf(subscription.metadata) ?? {};
  } catch (error) {
    console.error(
      "[owner-alerts] could not look up subscription",
      subscriptionId,
      error,
    );
    return null;
  }
}

// True when this subscription already had a real payment before this invoice.
// Normally the dedupe claim alone makes "first charge only" true, but it cannot
// know about payments from before this feature was switched on, or about a day-7
// alert whose email failed and was released. Asking Stripe settles it. If the
// lookup fails we assume "first" so a real day-7 payment is never silently lost.
async function hasEarlierRealPayment(
  stripe: Stripe,
  subscriptionId: string,
  currentInvoiceId: string,
): Promise<boolean> {
  try {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      status: "paid",
      limit: 20,
    });
    return page.data.some(
      (other) =>
        other.id !== currentInvoiceId &&
        other.amount_paid > 0 &&
        other.billing_reason !== "subscription_create",
    );
  } catch (error) {
    console.error(
      "[owner-alerts] could not check earlier invoices",
      subscriptionId,
      error,
    );
    return false;
  }
}

// ---- Orchestration ---------------------------------------------------------

async function processSignup(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const alert = buildSignupAlert(session, {
    livemode: event.livemode,
    created: event.created,
    type: event.type,
  });
  if (!alert) return;

  const claim = await claimAlert(alert.dedupeKey, event.type);
  if (!claim) return;
  await deliverAlert(claim, alert);
}

async function processPaidInvoice(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  if (!isRealChargeAfterSubscriptionStart(invoice)) return;

  const ref = readInvoiceSubscription(invoice);
  if (!ref.subscriptionId) return;

  // The invoice carries a snapshot of the subscription's metadata. If it is
  // missing the plan (older invoices, or an API version without it), ask Stripe.
  let metadata = ref.metadata;
  if (!metadata || typeof metadata["plan"] !== "string") {
    metadata = await fetchSubscriptionMetadata(stripe, ref.subscriptionId);
  }
  if (!metadata || metadata["plan"] !== "trial") return;

  const alert = buildTrialPaymentAlert(invoice, ref.subscriptionId, metadata, {
    livemode: event.livemode,
    created: event.created,
    type: event.type,
  });

  const claim = await claimAlert(alert.dedupeKey, event.type);
  if (!claim) return;

  if (
    await hasEarlierRealPayment(stripe, ref.subscriptionId, invoice.id ?? "")
  ) {
    await finishClaim(
      claim,
      "Not the first real payment for this subscription",
    );
    return;
  }
  await deliverAlert(claim, alert);
}

// Looks the client up by subscription id. Any failure just means the email goes
// out with the details Stripe already has.
async function findCanceledAccount(
  subscriptionId: string,
): Promise<CanceledAccount | null> {
  try {
    const [row] = await getDb()
      .select({
        businessName: businesses.businessName,
        contactName: businesses.contactName,
        email: businesses.email,
        phone: businesses.phone,
        locations: businesses.locations,
      })
      .from(businesses)
      .where(eq(businesses.stripeSubscriptionId, subscriptionId))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error(
      "[owner-alerts] could not look up the canceled account",
      subscriptionId,
      error,
    );
    return null;
  }
}

async function processCancellation(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const subscriptionId = nonEmptyString(subscription.id);
  if (!subscriptionId) return;

  const account = await findCanceledAccount(subscriptionId);
  const alert = buildCancellationAlert(subscription, account, {
    livemode: event.livemode,
    created: event.created,
    type: event.type,
  });
  if (!alert) return;

  const claim = await claimAlert(alert.dedupeKey, event.type);
  if (!claim) return;
  await deliverAlert(claim, alert);
}

async function processOwnerAlert(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  if (event.type === SIGNUP_EVENT) {
    await processSignup(event);
  } else if (event.type === CANCEL_ALERT_EVENT) {
    await processCancellation(event);
  } else if (PAID_INVOICE_EVENTS.has(event.type)) {
    await processPaidInvoice(stripe, event);
  }
}

// Entry point used by the webhook. Never throws, never returns anything the
// caller needs, and gives up after OVERALL_TIMEOUT_MS so Stripe always gets its
// answer promptly. Dormant until Resend is configured (checked before claiming,
// so nothing is marked as handled while emails cannot go out).
export async function sendOwnerAlertForEvent(
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  try {
    if (!isOwnerAlertEventType(event.type)) return;
    if (!isResendConfigured()) return;

    const outcome = await raceTimeout(
      processOwnerAlert(stripe, event),
      OVERALL_TIMEOUT_MS,
    );
    if (outcome === TIMED_OUT) {
      console.error(
        `[owner-alerts] gave up waiting on ${event.type} ${event.id}`,
      );
    }
  } catch (error) {
    console.error(
      `[owner-alerts] failed to handle ${event.type} ${event.id}`,
      error,
    );
  }
}
