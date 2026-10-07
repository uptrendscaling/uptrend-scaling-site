// Server side of the Requests and Reports tabs in the /app dashboard:
//
//   getRequestsLog   the message log (50 per page) plus a "needs attention"
//                    list of paid invoices we could not act on
//   getReportsData   a 12 week table and a this month versus last month row
//
// Same shape as the rest of the dashboard code: the real logic lives in plain
// exported functions that take a businessId (so a test database can run
// them), and the createServerFn wrappers at the bottom only read the session
// and call them. Real data only: nothing here invents a number, and with no
// database or no session nothing throws to the browser.

import { createServerFn } from "@tanstack/react-start";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import type {
  AttentionItem,
  ReportComparison,
  ReportMetricKey,
  ReportsData,
  ReportsResult,
  ReportWeek,
  RequestChannel,
  RequestKind,
  RequestLogRow,
  RequestsLogInput,
  RequestsLogPage,
  RequestsLogResult,
  RequestStatus,
} from "../components/dashboard/tabs-types";
import { getSessionBusinessId, isAuthConfigured } from "./auth.server";
import {
  monthComparisonPill,
  safeTimeZone,
  startOfMonthInstant,
  weekKeys,
  webhookProblemCondition,
  zonedParts,
  zonedTimeToInstant,
} from "./dashboard.server";
import { getDb, isDbConfigured } from "./db/client";
import {
  businesses,
  crmWebhookEvents,
  customers,
  messages,
  qrScans,
} from "./db/schema";
import { getGoogleSummary } from "./google.server";
import { UPTREND_SUPPORT_EMAIL } from "./messaging.server";

export const REQUESTS_PAGE_SIZE = 50;
export const REPORT_WEEKS = 12;
// A skipped or failed invoice stays on the "needs attention" list for this
// long. Older ones are history, and the owner cannot dismiss them.
const ATTENTION_WINDOW_DAYS = 30;
const ATTENTION_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------- hiding contact info

// "+16025554417" becomes "(602) ***-4417". The log is read by the owner, but
// it is also what an employee looking over a shoulder sees, and the full
// number adds nothing: the customer's name says who it was. The full values
// never leave the server.
export function maskPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ***-${digits.slice(6)}`;
  }
  if (digits.length >= 4) return `***-${digits.slice(-4)}`;
  return null;
}

// "maria@gmail.com" becomes "m***@gmail.com".
export function maskEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  return `${value.charAt(0)}***${value.slice(at)}`;
}

// -------------------------------------------------- plain-language problems

// Telnyx and Resend answer in their own words ("The 'to' number is not a
// valid phone number"). This turns the common ones into something a plumber
// can act on and keeps the original text alongside, so nothing is hidden.
export function describeSendProblem(
  raw: string | null | undefined,
  channel: RequestChannel,
): { problem: string; providerText: string | null } {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      problem: "This message could not be delivered.",
      providerText: null,
    };
  }
  const lower = text.toLowerCase();
  const resend = "Open the Customers tab and press Resend to try again.";

  let problem: string | null = null;
  if (/not configured/.test(lower)) {
    problem =
      channel === "sms"
        ? "Text messages are not switched on for your account yet."
        : "Email sending is not switched on for your account yet.";
  } else if (/did not answer in time|timed out|timeout/.test(lower)) {
    problem = `The sending service was slow to answer, so this one did not go out. ${resend}`;
  } else if (/network error/.test(lower)) {
    problem = `A connection problem stopped this from going out. ${resend}`;
  } else if (/rate limit|too many requests/.test(lower)) {
    problem = `We were sending too fast, so this one was held back. ${resend}`;
  } else if (channel === "sms") {
    if (
      /opt(ed)?[ -]?out|unsubscribed|\bstop\b|blocked|blacklist|spam/.test(
        lower,
      )
    ) {
      problem =
        "This person opted out of texts, or their phone carrier blocked it.";
    } else if (
      /(not a valid|invalid).*(phone|number|mobile)|landline|cannot receive|can't receive|not (sms|text)[- ]?(capable|enabled)|unreachable/.test(
        lower,
      )
    ) {
      problem =
        "That number can't get texts. It may be a landline or have a typo.";
    }
  } else if (/bounce|suppress/.test(lower)) {
    problem =
      "Emails to that address are being blocked because it bounced before. Check that the address is right.";
  } else if (
    /(not a valid|invalid|malformed).*(email|address|recipient)|(email|address|recipient).*(not valid|invalid|malformed)/.test(
      lower,
    )
  ) {
    problem = "That email address does not look right.";
  }

  if (problem) return { problem, providerText: text };
  // Nothing we recognise: the sending service's own words are the best
  // explanation there is.
  return {
    problem: "This message could not be delivered.",
    providerText: text,
  };
}

type WebhookProblemRow = {
  id: string;
  provider: "jobber" | "square" | "stripe";
  errorMessage: string | null;
  receivedAt: Date;
};

// "Customer: Rob T. (Square customer ID 7QX2, invoice inv:0-ChCq)." gives
// "Rob T.". The log writes a short name such as "Maria G.", and "no name on
// file" when the invoice had none.
function customerFromMessage(body: string): string | null {
  const found = /Customer:\s*(.+)$/s.exec(body);
  if (!found) return null;
  let name = (found[1] ?? "").trim();
  const paren = name.indexOf(" (");
  if (paren > 0) name = name.slice(0, paren).trim();
  // A closing period ends the sentence, except in the initial of "Maria G.".
  if (name.endsWith(".") && !/\s\p{L}\.$/u.test(name)) name = name.slice(0, -1);
  if (!name || /^no name on file$/i.test(name)) return null;
  return name;
}

// Turns one "Skipped: ..." or "Failed: ..." row from crm_webhook_events into
// a headline, a remark and what to do about it. Wording matches what
// crm/connections.server.ts writes.
export function describeWebhookProblem(row: WebhookProblemRow): AttentionItem {
  const provider = row.provider === "jobber" ? "Jobber" : "Square";
  const raw = (row.errorMessage ?? "").trim();
  const match = /^(Skipped|Failed):\s*([\s\S]*)$/.exec(raw);
  const kind = match?.[1] === "Failed" ? "failed" : "skipped";
  const body = (match?.[2] ?? raw).trim();
  const lower = body.toLowerCase();
  const customer = customerFromMessage(body);
  const base = {
    id: row.id,
    at: row.receivedAt.toISOString(),
    provider,
    kind,
    customer,
  } as const;
  const addThemYourself = `Add them yourself on the Customers tab to ask them now.`;

  if (kind === "failed") {
    const sentence = body.charAt(0).toUpperCase() + body.slice(1);
    return {
      ...base,
      headline: "We hit a problem while handling this paid invoice.",
      detail: sentence || null,
      fix: `${provider} usually tries again on its own. If this stays here, add the customer yourself on the Customers tab.`,
      action: "customers",
    };
  }
  if (/no google review link/.test(lower)) {
    return {
      ...base,
      headline:
        "No review request was sent because your Google review link is not set.",
      detail: null,
      fix: "Add your Google review link in Settings. After that, every paid invoice gets a request on its own.",
      action: "settings",
    };
  }
  if (/account not active/.test(lower)) {
    return {
      ...base,
      headline: "No review request was sent because your account is paused.",
      detail: null,
      fix: `Email ${UPTREND_SUPPORT_EMAIL} and we will sort it out.`,
      action: null,
    };
  }
  if (/no customer name/.test(lower)) {
    return {
      ...base,
      headline:
        "The paid invoice had no customer name, so no request was sent.",
      detail: null,
      fix: `Add the name to the customer in ${provider} next time, or add them yourself on the Customers tab.`,
      action: "customers",
    };
  }
  if (/no (usable )?phone or email/.test(lower)) {
    const usable = /no usable/.test(lower);
    // Anything after the "(ids)." part is the reason the details were unusable.
    const remark = /\)\.\s*(.+)$/s.exec(body)?.[1]?.trim() ?? null;
    return {
      ...base,
      headline: usable
        ? "The phone number or email on file did not work, so no request was sent."
        : "They had no phone number or email on file, so there was nobody to send to.",
      detail: remark,
      fix: `Fix their contact details in ${provider}, or ${addThemYourself.charAt(0).toLowerCase()}${addThemYourself.slice(1)}`,
      action: "customers",
    };
  }
  const sentence = body.charAt(0).toUpperCase() + body.slice(1);
  return {
    ...base,
    headline: "We skipped this paid invoice.",
    detail: sentence || null,
    fix: addThemYourself,
    action: "customers",
  };
}

// ------------------------------------------------------------ requests log

// A page boundary is "the last row of the page": its sent_at and id. Paging
// "older than that pair" stays correct even when many messages share one
// second (a text and an email go out together). The time travels as text with
// full microsecond precision, because a JavaScript Date only keeps
// milliseconds and a rounded cursor would repeat or skip rows.
const CURSOR_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function decodeCursor(
  cursor: string | undefined,
): { at: string; id: string } | null {
  const found = cursor ? CURSOR_PATTERN.exec(cursor) : null;
  return found ? { at: found[1] ?? "", id: found[2] ?? "" } : null;
}

const CHANNELS: readonly RequestChannel[] = ["sms", "email"];
const KINDS: readonly RequestKind[] = ["initial", "reminder", "manual"];
const STATUSES: readonly RequestStatus[] = ["sent", "failed"];

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

// Shapes whatever the browser sent. It never throws: an unknown filter is
// simply ignored, so a stale link cannot break the page.
export function parseRequestsLogInput(input: unknown): RequestsLogInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: RequestsLogInput = {};
  const channel = pick(raw["channel"], CHANNELS);
  const kind = pick(raw["kind"], KINDS);
  const status = pick(raw["status"], STATUSES);
  if (channel) out.channel = channel;
  if (kind) out.kind = kind;
  if (status) out.status = status;
  if (typeof raw["cursor"] === "string" && raw["cursor"].length <= 100) {
    out.cursor = raw["cursor"];
  }
  return out;
}

export async function loadRequestsLog(
  businessId: string,
  input: RequestsLogInput = {},
  options: { now?: Date } = {},
): Promise<RequestsLogPage> {
  const db = getDb();
  const now = options.now ?? new Date();
  const cursor = decodeCursor(input.cursor);

  const filters: SQL[] = [eq(messages.businessId, businessId)];
  if (input.channel) filters.push(eq(messages.channel, input.channel));
  if (input.kind) filters.push(eq(messages.kind, input.kind));
  if (input.status) filters.push(eq(messages.status, input.status));

  const pageFilters = cursor
    ? [
        ...filters,
        sql`(${messages.sentAt}, ${messages.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`,
      ]
    : filters;

  // One extra row tells us whether another page exists.
  const pageQuery = db
    .select({
      id: messages.id,
      sentAt: messages.sentAt,
      sentAtText: sql<string>`to_char(${messages.sentAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      channel: messages.channel,
      kind: messages.kind,
      status: messages.status,
      errorMessage: messages.errorMessage,
      customerName: customers.name,
      phone: customers.phone,
      email: customers.email,
      source: customers.source,
    })
    .from(messages)
    .innerJoin(customers, eq(customers.id, messages.customerId))
    .where(and(...pageFilters))
    .orderBy(desc(messages.sentAt), desc(messages.id))
    .limit(REQUESTS_PAGE_SIZE + 1);

  // Only the first page also needs the total and the "needs attention" list.
  // Later pages (the "Load more" button) skip those queries.
  const since = new Date(now.getTime() - ATTENTION_WINDOW_DAYS * DAY_MS);
  const attentionWhere = and(
    eq(crmWebhookEvents.businessId, businessId),
    inArray(crmWebhookEvents.provider, ["jobber", "square"]),
    webhookProblemCondition(),
    gte(crmWebhookEvents.receivedAt, since),
  );
  const [pageRows, totals, attentionRows, attentionTotals] = await Promise.all([
    pageQuery,
    cursor
      ? Promise.resolve(null)
      : db
          .select({ total: count() })
          .from(messages)
          .where(and(...filters)),
    cursor
      ? Promise.resolve(null)
      : db
          .select({
            id: crmWebhookEvents.id,
            provider: crmWebhookEvents.provider,
            errorMessage: crmWebhookEvents.errorMessage,
            receivedAt: crmWebhookEvents.receivedAt,
          })
          .from(crmWebhookEvents)
          .where(attentionWhere)
          .orderBy(desc(crmWebhookEvents.receivedAt), desc(crmWebhookEvents.id))
          .limit(ATTENTION_LIMIT),
    cursor
      ? Promise.resolve(null)
      : db
          .select({ total: count() })
          .from(crmWebhookEvents)
          .where(attentionWhere),
  ]);

  const pageSlice = pageRows.slice(0, REQUESTS_PAGE_SIZE);
  const last = pageSlice[pageSlice.length - 1];
  const rows: RequestLogRow[] = pageSlice.map((row) => {
    const failure =
      row.status === "failed"
        ? describeSendProblem(row.errorMessage, row.channel)
        : null;
    return {
      id: row.id,
      sentAt: row.sentAt.toISOString(),
      customerName: row.customerName,
      contact:
        row.channel === "sms" ? maskPhone(row.phone) : maskEmail(row.email),
      channel: row.channel,
      kind: row.kind,
      source: row.source,
      status: row.status,
      problem: failure?.problem ?? null,
      providerText: failure?.providerText ?? null,
    };
  });

  const page: RequestsLogPage = {
    rows,
    nextCursor:
      pageRows.length > REQUESTS_PAGE_SIZE && last
        ? `${last.sentAtText}|${last.id}`
        : null,
  };
  if (totals) page.total = totals[0]?.total ?? 0;
  if (attentionRows) {
    const items = attentionRows.map(describeWebhookProblem);
    const all = attentionTotals?.[0]?.total ?? items.length;
    page.attention = { items, more: Math.max(0, all - items.length) };
  }
  return page;
}

// ----------------------------------------------------------------- reports

// Postgres numbers weeks from Monday, which is what the dashboard uses
// everywhere, and the timestamp is first moved into the business's own
// timezone so a Sunday night job lands in the right week.
function weekOf(column: AnyColumn, timeZone: string) {
  return sql<string>`to_char(date_trunc('week', ${column} at time zone ${timeZone}), 'YYYY-MM-DD')`;
}

// Small building blocks for the month totals below. Dates go in as ISO text
// with an explicit cast, the same way the Overview queries do it.
function fromIso(column: AnyColumn, iso: string): SQL {
  return sql`${column} >= ${iso}::timestamptz`;
}
function betweenIso(column: AnyColumn, startIso: string, endIso: string): SQL {
  return sql`${column} >= ${startIso}::timestamptz and ${column} < ${endIso}::timestamptz`;
}
function countWhere(condition: SQL) {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}
// "Requests sent" counts customers, not messages: a customer who got both a
// text and an email is one request. Same rule as the Overview cards.
function peopleWhere(kind: "initial" | "reminder", condition?: SQL) {
  const extra = condition ? sql` and ${condition}` : sql``;
  return sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = ${kind}${extra})`.mapWith(
    Number,
  );
}

function instantOfDateKey(key: string, timeZone: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return zonedTimeToInstant(year ?? 1970, month ?? 1, day ?? 1, timeZone);
}

function monthName(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(
    instant,
  );
}

const num = (value: number | null | undefined) => value ?? 0;

export async function loadReportsData(
  businessId: string,
  options: { now?: Date } = {},
): Promise<ReportsData> {
  const db = getDb();
  const now = options.now ?? new Date();

  const [businessRow] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  const timeZone = safeTimeZone(businessRow?.timezone);

  const keys = weekKeys(now, timeZone, REPORT_WEEKS); // oldest first
  const weekFloor = instantOfDateKey(keys[0] ?? "1970-01-01", timeZone);
  const thisMonthStart = startOfMonthInstant(now, timeZone, 0);
  const lastMonthStart = startOfMonthInstant(now, timeZone, 1);
  const thisIso = thisMonthStart.toISOString();
  const lastIso = lastMonthStart.toISOString();

  const [
    weeklyMessages,
    monthMessages,
    weeklyOpened,
    weeklyReviewed,
    monthCustomers,
    weeklyScans,
    monthScans,
    google,
  ] = await Promise.all([
    db
      .select({
        week: weekOf(messages.sentAt, timeZone),
        requests: peopleWhere("initial"),
        reminders: peopleWhere("reminder"),
      })
      .from(messages)
      .where(
        and(
          eq(messages.businessId, businessId),
          eq(messages.status, "sent"),
          gte(messages.sentAt, weekFloor),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        requestsThis: peopleWhere("initial", fromIso(messages.sentAt, thisIso)),
        requestsLast: peopleWhere(
          "initial",
          betweenIso(messages.sentAt, lastIso, thisIso),
        ),
        remindersThis: peopleWhere(
          "reminder",
          fromIso(messages.sentAt, thisIso),
        ),
        remindersLast: peopleWhere(
          "reminder",
          betweenIso(messages.sentAt, lastIso, thisIso),
        ),
      })
      .from(messages)
      .where(
        and(
          eq(messages.businessId, businessId),
          eq(messages.status, "sent"),
          gte(messages.sentAt, lastMonthStart),
        ),
      ),
    db
      .select({
        week: weekOf(customers.linkClickedAt, timeZone),
        n: countWhere(sql`true`),
      })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          gte(customers.linkClickedAt, weekFloor),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        week: weekOf(customers.markedReviewedAt, timeZone),
        n: countWhere(sql`true`),
      })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          gte(customers.markedReviewedAt, weekFloor),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        openedThis: countWhere(fromIso(customers.linkClickedAt, thisIso)),
        openedLast: countWhere(
          betweenIso(customers.linkClickedAt, lastIso, thisIso),
        ),
        reviewedThis: countWhere(fromIso(customers.markedReviewedAt, thisIso)),
        reviewedLast: countWhere(
          betweenIso(customers.markedReviewedAt, lastIso, thisIso),
        ),
      })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, businessId),
          or(
            gte(customers.linkClickedAt, lastMonthStart),
            gte(customers.markedReviewedAt, lastMonthStart),
          ),
        ),
      ),
    db
      .select({
        week: weekOf(qrScans.scannedAt, timeZone),
        n: countWhere(sql`true`),
      })
      .from(qrScans)
      .where(
        and(
          eq(qrScans.businessId, businessId),
          gte(qrScans.scannedAt, weekFloor),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        scansThis: countWhere(fromIso(qrScans.scannedAt, thisIso)),
        scansLast: countWhere(betweenIso(qrScans.scannedAt, lastIso, thisIso)),
      })
      .from(qrScans)
      .where(
        and(
          eq(qrScans.businessId, businessId),
          gte(qrScans.scannedAt, lastMonthStart),
        ),
      ),
    // Google reviews are counted from the owner's own Business Profile, and
    // only once a sync has really stored something (summary.connected). The
    // Overview tab uses this same summary, so the two tabs always agree.
    getGoogleSummary(businessId, now),
  ]);

  const messageByWeek = new Map(weeklyMessages.map((row) => [row.week, row]));
  const openedByWeek = new Map(weeklyOpened.map((row) => [row.week, row.n]));
  const reviewedByWeek = new Map(
    weeklyReviewed.map((row) => [row.week, row.n]),
  );
  const scansByWeek = new Map(weeklyScans.map((row) => [row.week, row.n]));
  const googleByWeek = new Map(
    google.weeklyCounts.map((row) => [row.weekStart, row.count]),
  );
  const hasGoogle = google.connected;

  const weeks: ReportWeek[] = keys
    .map((weekStart) => ({
      weekStart,
      requests: num(messageByWeek.get(weekStart)?.requests),
      reminders: num(messageByWeek.get(weekStart)?.reminders),
      linksOpened: num(openedByWeek.get(weekStart)),
      reviewed: num(reviewedByWeek.get(weekStart)),
      qrScans: num(scansByWeek.get(weekStart)),
      googleReviews: hasGoogle ? num(googleByWeek.get(weekStart)) : null,
    }))
    .reverse(); // newest first, like every list in the dashboard

  const months = monthMessages[0];
  const people = monthCustomers[0];
  const scans = monthScans[0];
  const dayOfMonth = zonedParts(now, timeZone).day;
  const pairs: Array<[ReportMetricKey, string, number, number]> = [
    [
      "requests",
      "Requests sent",
      num(months?.requestsThis),
      num(months?.requestsLast),
    ],
    [
      "reminders",
      "Reminders sent",
      num(months?.remindersThis),
      num(months?.remindersLast),
    ],
    [
      "linksOpened",
      "Review links opened",
      num(people?.openedThis),
      num(people?.openedLast),
    ],
    [
      "reviewed",
      "Marked reviewed",
      num(people?.reviewedThis),
      num(people?.reviewedLast),
    ],
    ["qrScans", "QR scans", num(scans?.scansThis), num(scans?.scansLast)],
  ];
  if (hasGoogle) {
    pairs.push([
      "googleReviews",
      "Google reviews",
      google.reviewsThisMonth,
      google.reviewsLastMonth,
    ]);
  }
  const comparison: ReportComparison[] = pairs.map(
    ([key, label, thisMonth, lastMonth]) => ({
      key,
      label,
      thisMonth,
      lastMonth,
      pill: monthComparisonPill(thisMonth, lastMonth, dayOfMonth),
    }),
  );

  const hasAnyData =
    comparison.some((item) => item.thisMonth > 0 || item.lastMonth > 0) ||
    weeks.some(
      (week) =>
        week.requests +
          week.reminders +
          week.linksOpened +
          week.reviewed +
          week.qrScans +
          num(week.googleReviews) >
        0,
    );

  return {
    generatedAt: now.toISOString(),
    timezone: timeZone,
    thisMonthLabel: monthName(thisMonthStart, timeZone),
    lastMonthLabel: monthName(lastMonthStart, timeZone),
    weeks,
    comparison,
    hasGoogle,
    hasAnyData,
  };
}

// -------------------------------------------------------- server functions

const NOT_SIGNED_IN = "Please sign in again to see this page.";

async function sessionBusinessId(): Promise<string | null> {
  try {
    return await getSessionBusinessId();
  } catch (error) {
    console.error("[dashboard-tabs] could not read the session", error);
    return null;
  }
}

// The validator only shapes the input (it never throws), so a stale filter
// reaches the handler as "no filter" instead of an error page.
export const getRequestsLog = createServerFn({ method: "GET" })
  .validator((input: unknown): RequestsLogInput => parseRequestsLogInput(input))
  .handler(async ({ data }): Promise<RequestsLogResult> => {
    if (!isDbConfigured() || !isAuthConfigured()) {
      return { ok: true, rows: [], nextCursor: null, total: 0 };
    }
    const businessId = await sessionBusinessId();
    if (!businessId) return { ok: false, message: NOT_SIGNED_IN };
    try {
      return { ok: true, ...(await loadRequestsLog(businessId, data)) };
    } catch (error) {
      console.error("[dashboard-tabs] failed to load the requests log", error);
      return {
        ok: false,
        message:
          "We couldn't load your requests just now. Please refresh and try again.",
      };
    }
  });

export const getReportsData = createServerFn({ method: "GET" }).handler(
  async (): Promise<ReportsResult> => {
    if (!isDbConfigured() || !isAuthConfigured()) {
      return {
        ok: false,
        message: "Reports are not switched on yet. Please check back soon.",
      };
    }
    const businessId = await sessionBusinessId();
    if (!businessId) return { ok: false, message: NOT_SIGNED_IN };
    try {
      return { ok: true, data: await loadReportsData(businessId) };
    } catch (error) {
      console.error("[dashboard-tabs] failed to load reports", error);
      return {
        ok: false,
        message:
          "We couldn't load your reports just now. Please refresh and try again.",
      };
    }
  },
);
