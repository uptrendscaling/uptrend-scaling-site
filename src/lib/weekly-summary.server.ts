// The weekly summary email every active client gets on Monday morning, built
// only from numbers we actually measured. Three layers, each a plain exported
// function so it can be tested without the framework:
//
//   1. summaryWindow()          the 7 full days to report on, in the business's
//                               own timezone (no date library, just Intl).
//   2. buildWeeklySummary()     reads one business's data, returns the subject,
//                               HTML, plain text and the raw numbers.
//   3. sendWeeklySummaries()    the cron job: picks who is due, claims each one
//                               so a double fire cannot send twice, sends the
//                               emails in one Resend batch and marks only the
//                               ones that really went out.
//
// The page is built like the cold-outreach emails (./outreach-email.ts): table
// layout, inline styles, no images (remote images are blocked by Apple Mail,
// Zoho and Outlook), a light body so dark-mode inversion cannot break it, and a
// dark header band that is plain text. Everything is dormant-safe: with no
// database or no Resend key nothing happens and nothing throws.

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";

import { getDb, isDbConfigured } from "./db/client";
import {
  businesses,
  crmConnections,
  crmWebhookEvents,
  customers,
  googleRatingSnapshots,
  googleReviews,
  messages,
  qrCodes,
  qrScans,
  type Business,
} from "./db/schema";
import { isResendConfigured, UPTREND_SUPPORT_EMAIL } from "./messaging.server";
import { escapeHtml } from "./outreach-email";
import { CANONICAL_SITE_URL } from "./site";

const DAY_MS = 86_400_000;
const DEFAULT_TIMEZONE = "America/Phoenix";

// ---------------------------------------------------------------------------
// Timezone and window helpers
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // h23 so midnight is hour 0, never "24".
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

// A bad or empty value in businesses.timezone must not stop that business's
// email, so anything Intl rejects falls back to Arizona (the column default).
export function safeTimezone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    zoneFormatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

type LocalParts = { y: number; m: number; d: number };

function localParts(ms: number, timeZone: string): LocalParts & {
  h: number;
  mi: number;
  s: number;
} {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    mi: get("minute"),
    s: get("second"),
  };
}

// How far the zone is ahead of UTC at this instant, in milliseconds.
function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - Math.floor(ms / 1000) * 1000;
}

// The real instant at which the given calendar day starts on a wall clock in
// that zone. Two passes so a daylight-saving change between the guess and the
// answer is still handled.
function localMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - zoneOffsetMs(guess, timeZone);
  t = guess - zoneOffsetMs(t, timeZone);
  return new Date(t);
}

// Calendar arithmetic on a y/m/d triple (month is 1 to 12), with no zone in it.
function shiftDay(parts: LocalParts, days: number): LocalParts {
  const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function weekdayOf(parts: LocalParts): number {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
}

function dayLabel(parts: LocalParts, withWeekday: boolean): string {
  const base = `${MONTHS[parts.m - 1]} ${parts.d}`;
  return withWeekday ? `${WEEKDAYS[weekdayOf(parts)]}, ${base}` : base;
}

function isoDate(parts: LocalParts): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.y}-${pad(parts.m)}-${pad(parts.d)}`;
}

export type SummaryWindow = {
  timezone: string;
  // The previous 7 full days: start is midnight 7 days before today in the
  // business's zone, end is midnight at the start of today (exclusive).
  start: Date;
  end: Date;
  // Eight midnights (start of each of the 7 days, plus the end), used to put
  // an event on its weekday without any further timezone math.
  dayStarts: Date[];
  dayShortNames: string[];
  dayLongNames: string[];
  // "Mon, Sep 28 to Sun, Oct 4"
  label: string;
  // Monday (as yyyy-mm-dd) of the current week in this zone. Part of the claim
  // key, so a retry on Tuesday of the same week still counts as the same week.
  weekKey: string;
};

export function summaryWindow(now: Date, timezone: string): SummaryWindow {
  const timeZone = safeTimezone(timezone);
  const today = localParts(now.getTime(), timeZone);
  const firstDay = shiftDay(today, -7);
  const lastDay = shiftDay(today, -1);

  const days: LocalParts[] = [];
  for (let i = 0; i < 7; i += 1) days.push(shiftDay(firstDay, i));
  const dayStarts = [...days, today].map((p) =>
    localMidnight(p.y, p.m, p.d, timeZone),
  );

  const daysSinceMonday = (weekdayOf(today) + 6) % 7;
  return {
    timezone: timeZone,
    start: dayStarts[0] as Date,
    end: dayStarts[7] as Date,
    dayStarts,
    dayShortNames: days.map((p) => WEEKDAYS[weekdayOf(p)] as string),
    dayLongNames: days.map((p) => WEEKDAYS_LONG[weekdayOf(p)] as string),
    label: `${dayLabel(firstDay, true)} to ${dayLabel(lastDay, true)}`,
    weekKey: isoDate(shiftDay(today, -daysSinceMonday)),
  };
}

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

export type GoogleReviewLine = {
  stars: number;
  name: string | null;
  comment: string | null;
};

export type GoogleStats = {
  // Null when we have no review rows for this business at all (nothing was
  // measured, so we do not print a "0").
  newReviews: number | null;
  reviews: GoogleReviewLine[];
  // From the newest rating snapshot. Null when there is no snapshot.
  rating: number | null;
  totalReviews: number | null;
  // Set only when that snapshot is a few days old, e.g. "Oct 1".
  asOfLabel: string | null;
  // Versus the snapshot about 7 days earlier. Null when there is none.
  ratingChange: number | null;
  totalReviewsChange: number | null;
};

export type WeeklySummaryStats = {
  windowStart: string;
  windowEnd: string;
  windowLabel: string;
  timezone: string;
  // No customers, no Google data and no QR code yet: gets the "how to get
  // started" version instead of a report full of zeros.
  isNewAccount: boolean;
  // Distinct customers who got their first request in the window.
  requestsSent: number;
  // Distinct customers who got a reminder, or a resend from the dashboard.
  remindersSent: number;
  linksOpened: number;
  markedReviewed: number;
  // Null when the business has no QR code at all (nothing to measure).
  qrScans: number | null;
  // Of requestsSent, how many were sent by a connected tool.
  automaticRequests: { jobber: number; square: number };
  requestsByDay: number[];
  dayShortNames: string[];
  dayLongNames: string[];
  // Customers whose message failed on every channel and who got nothing else.
  failedCustomers: number;
  // Paid-invoice events we could not turn into a request.
  skippedInvoices: { jobber: number; square: number; allNoContact: boolean };
  reviewLinkMissing: boolean;
  connected: { jobber: boolean; square: boolean; google: boolean };
  needsReconnect: Array<"jobber" | "square" | "google">;
  hasQrCode: boolean;
  google: GoogleStats | null;
};

export type SummaryContext = {
  businessName: string;
  contactName: string;
};

export type WeeklySummary = {
  subject: string;
  html: string;
  text: string;
  stats: WeeklySummaryStats;
};

type Db = ReturnType<typeof getDb>;

const NO_CONTACT_ERROR = "No usable contact info";
// How far apart the two rating snapshots may be and still be called "since
// last week": 7 days, give or take 2.
const BASELINE_MIN_DAYS = 5;
const BASELINE_MAX_DAYS = 9;
// A rating snapshot older than this gets an "as of" date next to it.
const STALE_SNAPSHOT_MS = 2 * DAY_MS;

async function gatherStats(
  db: Db,
  business: Business,
  now: Date,
): Promise<WeeklySummaryStats> {
  const win = summaryWindow(now, business.timezone);
  const { start, end } = win;

  const [
    messageRows,
    customerCounts,
    qrCodeRows,
    qrScanCounts,
    reviewRowsInWindow,
    anyReviewRows,
    latestSnapshots,
    connectionRows,
    skippedRows,
  ] = await Promise.all([
    // Every message in the window with where the customer came from. Customers
    // delete their messages along with them, so the inner join loses nothing.
    db
      .select({
        customerId: messages.customerId,
        kind: messages.kind,
        status: messages.status,
        sentAt: messages.sentAt,
        source: customers.source,
      })
      .from(messages)
      .innerJoin(customers, eq(customers.id, messages.customerId))
      .where(
        and(
          eq(messages.businessId, business.id),
          gte(messages.sentAt, start),
          lt(messages.sentAt, end),
        ),
      ),
    db
      .select({ total: count() })
      .from(customers)
      .where(eq(customers.businessId, business.id)),
    db
      .select({ id: qrCodes.id })
      .from(qrCodes)
      .where(eq(qrCodes.businessId, business.id))
      .limit(1),
    db
      .select({ n: count() })
      .from(qrScans)
      .where(
        and(
          eq(qrScans.businessId, business.id),
          gte(qrScans.scannedAt, start),
          lt(qrScans.scannedAt, end),
        ),
      ),
    db
      .select({
        stars: googleReviews.starRating,
        name: googleReviews.reviewerName,
        comment: googleReviews.comment,
      })
      .from(googleReviews)
      .where(
        and(
          eq(googleReviews.businessId, business.id),
          gte(googleReviews.reviewedAt, start),
          lt(googleReviews.reviewedAt, end),
        ),
      )
      .orderBy(desc(googleReviews.reviewedAt)),
    db
      .select({ id: googleReviews.id })
      .from(googleReviews)
      .where(eq(googleReviews.businessId, business.id))
      .limit(1),
    db
      .select()
      .from(googleRatingSnapshots)
      .where(eq(googleRatingSnapshots.businessId, business.id))
      .orderBy(desc(googleRatingSnapshots.takenAt))
      .limit(1),
    db
      .select({
        provider: crmConnections.provider,
        lastErrorMessage: crmConnections.lastErrorMessage,
      })
      .from(crmConnections)
      .where(eq(crmConnections.businessId, business.id)),
    // "stripe" rows in this table are claim markers, not CRM events, so only
    // Jobber and Square rows count here.
    db
      .select({
        provider: crmWebhookEvents.provider,
        errorMessage: crmWebhookEvents.errorMessage,
      })
      .from(crmWebhookEvents)
      .where(
        and(
          eq(crmWebhookEvents.businessId, business.id),
          inArray(crmWebhookEvents.provider, ["jobber", "square"]),
          isNotNull(crmWebhookEvents.errorMessage),
          gte(crmWebhookEvents.receivedAt, start),
          lt(crmWebhookEvents.receivedAt, end),
        ),
      ),
  ]);

  // Customer-level counts from the message log.
  const firstRequest = new Map<string, { at: number; source: string }>();
  const reminded = new Set<string>();
  const gotSomething = new Set<string>();
  const hadFailure = new Set<string>();
  for (const row of messageRows) {
    const at = row.sentAt.getTime();
    if (row.status === "failed") {
      hadFailure.add(row.customerId);
      continue;
    }
    gotSomething.add(row.customerId);
    if (row.kind === "initial") {
      const earlier = firstRequest.get(row.customerId);
      if (!earlier || at < earlier.at) {
        firstRequest.set(row.customerId, { at, source: row.source });
      }
    } else {
      // "reminder" from the daily job, or "manual" resend from the dashboard.
      reminded.add(row.customerId);
    }
  }
  const failedCustomers = [...hadFailure].filter(
    (id) => !gotSomething.has(id),
  ).length;

  const requestsByDay = win.dayStarts.slice(0, 7).map(() => 0);
  const automaticRequests = { jobber: 0, square: 0 };
  for (const { at, source } of firstRequest.values()) {
    let dayIndex = 0;
    for (let i = 0; i < 7; i += 1) {
      if (at >= (win.dayStarts[i] as Date).getTime()) dayIndex = i;
    }
    requestsByDay[dayIndex] = (requestsByDay[dayIndex] ?? 0) + 1;
    if (source === "jobber") automaticRequests.jobber += 1;
    if (source === "square") automaticRequests.square += 1;
  }

  // Link opens and marked-reviewed come straight from customer rows. Two small
  // counts rather than one clever query, so each stays obviously correct.
  const [linkCount, reviewedCount] = await Promise.all([
    db
      .select({ n: count() })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, business.id),
          gte(customers.linkClickedAt, start),
          lt(customers.linkClickedAt, end),
        ),
      ),
    db
      .select({ n: count() })
      .from(customers)
      .where(
        and(
          eq(customers.businessId, business.id),
          gte(customers.markedReviewedAt, start),
          lt(customers.markedReviewedAt, end),
        ),
      ),
  ]);

  const totalCustomers = customerCounts[0]?.total ?? 0;
  const hasQrCode = qrCodeRows.length > 0;
  const qrScanTotal = qrScanCounts[0]?.n ?? 0;

  // Google. The snapshot about a week before the newest one is the baseline for
  // "since last week"; if none is close enough the change is simply not shown.
  const latest = latestSnapshots[0] ?? null;
  const hasReviewRows = anyReviewRows.length > 0;
  let google: GoogleStats | null = null;
  if (latest || hasReviewRows) {
    let ratingChange: number | null = null;
    let totalReviewsChange: number | null = null;
    if (latest) {
      const target = latest.takenAt.getTime() - 7 * DAY_MS;
      const candidates = await db
        .select()
        .from(googleRatingSnapshots)
        .where(
          and(
            eq(googleRatingSnapshots.businessId, business.id),
            gte(
              googleRatingSnapshots.takenAt,
              new Date(latest.takenAt.getTime() - BASELINE_MAX_DAYS * DAY_MS),
            ),
            lte(
              googleRatingSnapshots.takenAt,
              new Date(latest.takenAt.getTime() - BASELINE_MIN_DAYS * DAY_MS),
            ),
          ),
        )
        .orderBy(asc(googleRatingSnapshots.takenAt));
      let baseline: (typeof candidates)[number] | null = null;
      for (const candidate of candidates) {
        if (
          !baseline ||
          Math.abs(candidate.takenAt.getTime() - target) <
            Math.abs(baseline.takenAt.getTime() - target)
        ) {
          baseline = candidate;
        }
      }
      if (baseline) {
        ratingChange =
          Math.round((latest.rating - baseline.rating) * 10) / 10;
        totalReviewsChange = latest.totalReviews - baseline.totalReviews;
      }
    }

    const stale =
      latest && now.getTime() - latest.takenAt.getTime() > STALE_SNAPSHOT_MS;
    google = {
      newReviews: hasReviewRows ? reviewRowsInWindow.length : null,
      reviews: reviewRowsInWindow.map((row) => ({
        stars: row.stars,
        name: row.name,
        comment: row.comment,
      })),
      rating: latest ? latest.rating : null,
      totalReviews: latest ? latest.totalReviews : null,
      asOfLabel:
        latest && stale
          ? dayLabel(
              localParts(latest.takenAt.getTime(), win.timezone),
              false,
            )
          : null,
      ratingChange,
      totalReviewsChange,
    };
  }

  const skipped = { jobber: 0, square: 0, allNoContact: true };
  for (const row of skippedRows) {
    if (row.provider === "jobber") skipped.jobber += 1;
    if (row.provider === "square") skipped.square += 1;
    if (row.errorMessage !== NO_CONTACT_ERROR) skipped.allNoContact = false;
  }

  const connected = {
    jobber: connectionRows.some((row) => row.provider === "jobber"),
    square: connectionRows.some((row) => row.provider === "square"),
    google: connectionRows.some((row) => row.provider === "google"),
  };
  const needsReconnect = connectionRows
    .filter((row) => Boolean(row.lastErrorMessage))
    .map((row) => row.provider);

  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    windowLabel: win.label,
    timezone: win.timezone,
    isNewAccount: totalCustomers === 0 && !google && !hasQrCode,
    requestsSent: firstRequest.size,
    remindersSent: reminded.size,
    linksOpened: linkCount[0]?.n ?? 0,
    markedReviewed: reviewedCount[0]?.n ?? 0,
    qrScans: hasQrCode || qrScanTotal > 0 ? qrScanTotal : null,
    automaticRequests,
    requestsByDay,
    dayShortNames: win.dayShortNames,
    dayLongNames: win.dayLongNames,
    failedCustomers,
    skippedInvoices: skipped,
    reviewLinkMissing: !business.googleReviewUrl?.trim(),
    connected,
    needsReconnect,
    hasQrCode,
    google,
  };
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

// Uses the owner's first name only when it looks like a clean one.
function firstName(contactName: string): string | null {
  const first = contactName.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{1,20}$/.test(first) ? first : null;
}

function isQuietWeek(s: WeeklySummaryStats): boolean {
  return (
    s.requestsSent === 0 &&
    s.remindersSent === 0 &&
    s.linksOpened === 0 &&
    s.markedReviewed === 0 &&
    (s.qrScans ?? 0) === 0 &&
    (s.google?.newReviews ?? 0) === 0
  );
}

export function summarySubject(s: WeeklySummaryStats): string {
  if (s.isNewAccount) return "Here is how to get started with UpTrend Scaling";
  // The one thing that stops every automatic request outranks the numbers.
  if (s.reviewLinkMissing) {
    return "Quick fix needed: add your Google review link";
  }

  const newGoogle = s.google?.newReviews ?? 0;
  const opened = s.linksOpened;
  if (s.requestsSent > 0) {
    const extra =
      newGoogle > 0
        ? `, ${plural(newGoogle, "new Google review")}`
        : opened > 0
          ? `, ${plural(opened, "review link")} opened`
          : "";
    return `Your week: ${plural(s.requestsSent, "review request")} sent${extra}`;
  }
  if (newGoogle > 0) {
    return `Your week: ${plural(newGoogle, "new Google review")}${
      opened > 0 ? `, ${plural(opened, "review link")} opened` : ""
    }`;
  }
  if (opened > 0) return `Your week: ${plural(opened, "review link")} opened`;
  if (s.markedReviewed > 0) {
    return `Your week: ${plural(s.markedReviewed, "customer")} marked as reviewed`;
  }
  return "Your week: a quiet one, no review requests went out";
}

function leadSentence(s: WeeklySummaryStats): string {
  const newGoogle = s.google?.newReviews ?? 0;
  if (isQuietWeek(s)) {
    return "It was a quiet week for reviews. No review requests went out.";
  }
  if (s.requestsSent > 0) {
    const asked = `${plural(s.requestsSent, "customer")} ${
      s.requestsSent === 1 ? "was" : "were"
    } asked for a review this week`;
    if (newGoogle > 0) {
      return `${asked}, and ${plural(newGoogle, "new Google review")} came in.`;
    }
    if (s.linksOpened > 0) {
      return `${asked}, and ${plural(s.linksOpened, "customer")} opened their review link.`;
    }
    return `${asked}.`;
  }
  if (newGoogle > 0) {
    return `No new review requests went out, but ${plural(newGoogle, "new Google review")} came in.`;
  }
  return "No new review requests went out this week, but there was some activity from earlier requests.";
}

const PROVIDER_NAMES = { jobber: "Jobber", square: "Square", google: "Google" };

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type Tip = { title: string; body: string };

// Problems the owner needs to know about, most important first.
function attentionItems(s: WeeklySummaryStats): Tip[] {
  const items: Tip[] = [];
  if (s.reviewLinkMissing) {
    items.push({
      title: "Add your Google review link.",
      body: "Until it is set, your review requests cannot send customers to Google, so nothing goes out automatically. It takes a minute in your dashboard settings.",
    });
  }
  if (s.failedCustomers > 0) {
    items.push({
      title: `${plural(s.failedCustomers, "customer")} did not get their message.`,
      body: "The phone number or email we have for them may be wrong. You can fix it in your dashboard.",
    });
  }
  const skipped = s.skippedInvoices.jobber + s.skippedInvoices.square;
  if (skipped > 0) {
    const where = joinNames([
      ...(s.skippedInvoices.jobber > 0 ? [PROVIDER_NAMES.jobber] : []),
      ...(s.skippedInvoices.square > 0 ? [PROVIDER_NAMES.square] : []),
    ]);
    items.push({
      title: `${plural(skipped, "paid invoice")} in ${where} did not turn into a review request.`,
      body: s.skippedInvoices.allNoContact
        ? "The customer on the invoice had no phone number or email, so there was nobody to message."
        : "Reply to this email and we will take a look.",
    });
  }
  for (const provider of s.needsReconnect) {
    items.push({
      title: `Your ${PROVIDER_NAMES[provider]} connection needs to be reconnected.`,
      body:
        provider === "google"
          ? "Until then, your rating and new reviews will not update here."
          : "Until then, paid invoices cannot trigger review requests. You can reconnect it in your dashboard.",
    });
  }
  return items;
}

// Gentle, optional ideas for things that are not set up yet. At most three.
function nextSteps(s: WeeklySummaryStats): string[] {
  const steps: string[] = [];
  const lowReview = (s.google?.reviews ?? []).find((r) => r.stars <= 3);
  if (lowReview) {
    steps.push(
      `Reply to your ${lowReview.stars}-star review on Google. A calm, friendly answer shows future customers you care.`,
    );
  }
  if (!s.connected.jobber && !s.connected.square) {
    steps.push(
      "Connect Jobber or Square, and a review request goes out on its own the moment an invoice is paid.",
    );
  }
  if (!s.connected.google) {
    steps.push(
      "Connect your Google Business Profile to see your star rating and new reviews in this email every week.",
    );
  }
  if (!s.hasQrCode) {
    steps.push(
      "Print a QR code for your counter, truck or invoices so customers can leave a review on the spot.",
    );
  }
  return steps.slice(0, 3);
}

type Step = { title: string; body: string; done: boolean };

function getStartedSteps(s: WeeklySummaryStats): Step[] {
  return [
    {
      title: "Add your Google review link",
      body: s.reviewLinkMissing
        ? "This is where every customer lands after tapping their personal link. Add it in your dashboard settings. Nothing can go out until it is set."
        : "Done. Customers who tap their link will land on your Google page.",
      done: !s.reviewLinkMissing,
    },
    {
      title: "Add your first customer",
      body: "Their review request goes out the moment you save them. No extra step.",
      done: false,
    },
    {
      title: "Connect Jobber or Square (optional)",
      body: "Then a review request goes out on its own every time an invoice is paid.",
      done: s.connected.jobber || s.connected.square,
    },
    {
      title: "Connect your Google Business Profile (optional)",
      body: "So your star rating and new reviews show up in this email each week.",
      done: s.connected.google,
    },
  ];
}

function trimComment(comment: string | null, max = 130): string | null {
  const flat = (comment ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:!?\s]+$/, "")}...`;
}

function trimName(name: string | null): string {
  const flat = (name ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "A customer";
  return flat.length > 32 ? `${flat.slice(0, 31)}...` : flat;
}

function ratingChangeText(g: GoogleStats): string[] {
  const lines: string[] = [];
  if (g.ratingChange !== null) {
    if (g.ratingChange > 0) {
      lines.push(`Up ${g.ratingChange.toFixed(1)} since last week`);
    } else if (g.ratingChange < 0) {
      lines.push(`Down ${Math.abs(g.ratingChange).toFixed(1)} since last week`);
    } else {
      lines.push("Same rating as last week");
    }
  }
  if (g.totalReviewsChange !== null && g.totalReviewsChange !== 0) {
    lines.push(
      g.totalReviewsChange > 0
        ? `${plural(g.totalReviewsChange, "review")} added since last week`
        : `${plural(Math.abs(g.totalReviewsChange), "review")} fewer than last week`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const FONT = "'Poppins','Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#18181b";
const MUTED = "#6b6b70";
const FAINT = "#71717a";
const LINE = "#e4e4e7";
const PANEL = "#f4f4f5";
const ZERO = "#9a9aa2";
const STAR = "#d97706";
const STAR_OFF = "#d4d4d8";
const GOOD = "#15803d";
const BAD = "#b91c1c";

const DASHBOARD_URL = `${CANONICAL_SITE_URL}/app`;

function label(text: string, color = MUTED): string {
  return `<div style="font-family:${FONT};font-size:11px;line-height:1.4;letter-spacing:2px;color:${color};font-weight:600;">${escapeHtml(text.toUpperCase())}</div>`;
}

function stars(n: number, size = 15): string {
  const filled = Math.max(0, Math.min(5, Math.round(n)));
  return `<span style="font-size:${size}px;line-height:1;letter-spacing:1px;white-space:nowrap;"><span style="color:${STAR};">${"★".repeat(filled)}</span><span style="color:${STAR_OFF};">${"★".repeat(5 - filled)}</span></span>`;
}

function statCell(value: number, caption: string, widthPct: number): string {
  const size = fmt(value).length > 3 ? 26 : 34;
  return `<td class="stat" width="${widthPct}%" valign="top" align="center" bgcolor="${PANEL}" style="background:${PANEL};border:1px solid ${LINE};border-radius:10px;padding:16px 6px 14px;">
              <div class="stat-num" style="font-family:${FONT};font-size:${size}px;line-height:1.1;font-weight:700;color:${value === 0 ? ZERO : INK};">${fmt(value)}</div>
              <div style="font-family:${FONT};font-size:12px;line-height:1.35;color:${MUTED};margin-top:6px;">${escapeHtml(caption)}</div>
            </td>`;
}

function statRow(cells: Array<[number, string]>): string {
  const width = Math.floor(100 / cells.length) - 1;
  const gap = `<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>`;
  return `<tr>
        <td class="px" style="padding:0 32px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
            ${cells.map(([value, caption]) => statCell(value, caption, width)).join(gap)}
            </tr>
          </table>
        </td>
      </tr>`;
}

// Lays the headline numbers out as rows of two or three equal cells, never a
// lone stretched cell: 4 cells are 2 + 2, 5 are 3 + 2, 6 are 3 + 3.
function statGrid(cells: Array<[number, string]>): string {
  const split = cells.length === 4 ? 2 : 3;
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += split) {
    rows.push(statRow(cells.slice(i, i + split)));
  }
  return rows.join("\n");
}

function bulletRows(items: string[], color = INK, size = 15): string {
  return items
    .map(
      (item) => `<tr>
                <td width="20" valign="top" style="padding:0 0 9px;font-family:${FONT};font-size:${size}px;line-height:1.55;color:${color};">&bull;</td>
                <td valign="top" style="padding:0 0 9px;font-family:${FONT};font-size:${size}px;line-height:1.55;color:${color};">${item}</td>
              </tr>`,
    )
    .join("\n");
}

function panel(inner: string): string {
  return `<tr>
        <td class="px" style="padding:6px 32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PANEL}" style="background:${PANEL};border:1px solid ${LINE};border-radius:10px;">
            ${inner}
          </table>
        </td>
      </tr>`;
}

function attentionBox(items: Tip[]): string {
  const body = items
    .map(
      (item, index) =>
        `<p style="margin:0 0 ${index === items.length - 1 ? 0 : 12}px;font-family:${FONT};font-size:15px;line-height:1.55;color:#422006;"><strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.body)}</p>`,
    )
    .join("\n              ");
  return `<tr>
        <td class="px" style="padding:6px 32px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fffbeb" style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;">
            <tr>
              <td style="padding:16px 20px 6px;">${label("Needs your attention", "#92400e")}</td>
            </tr>
            <tr>
              <td style="padding:6px 20px 18px;">
              ${body}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function googleCard(g: GoogleStats): string {
  const parts: string[] = [];

  if (g.rating !== null && g.totalReviews !== null) {
    const change = ratingChangeText(g);
    const changeColor =
      g.ratingChange !== null && g.ratingChange < 0
        ? BAD
        : g.ratingChange !== null && g.ratingChange > 0
          ? GOOD
          : MUTED;
    parts.push(`<tr>
              <td style="padding:16px 20px 4px;">${label("Your Google rating")}</td>
            </tr>
            <tr>
              <td style="padding:6px 20px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="104" valign="middle" align="left">
                      <div style="font-family:${FONT};font-size:42px;line-height:1;font-weight:700;color:${INK};">${g.rating.toFixed(1)}</div>
                      <div style="margin-top:6px;font-family:${FONT};">${stars(g.rating)}</div>
                    </td>
                    <td valign="middle" style="padding-left:12px;">
                      <div style="font-family:${FONT};font-size:15px;line-height:1.5;font-weight:600;color:${INK};">${plural(g.totalReviews, "review")} on Google</div>
                      ${change
                        .map(
                          (line, i) =>
                            `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${i === 0 ? changeColor : MUTED};">${escapeHtml(line)}</div>`,
                        )
                        .join("\n                      ")}
                      ${g.asOfLabel ? `<div style="font-family:${FONT};font-size:12px;line-height:1.5;color:${FAINT};">As of ${escapeHtml(g.asOfLabel)}</div>` : ""}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`);
  }

  if (g.newReviews !== null) {
    const shown = g.reviews.slice(0, 5);
    const more = g.reviews.length - shown.length;
    const divider =
      g.rating !== null
        ? `border-top:1px solid ${LINE};`
        : "";
    if (shown.length === 0) {
      parts.push(`<tr>
              <td style="padding:14px 20px 16px;${divider}font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};">No new Google reviews this week. They will show up here as they come in.</td>
            </tr>`);
    } else {
      parts.push(`<tr>
              <td style="padding:14px 20px 4px;${divider}">${label(g.newReviews === 1 ? "New this week: 1 review" : `New this week: ${fmt(g.newReviews)} reviews`)}</td>
            </tr>`);
      shown.forEach((review, index) => {
        const comment = trimComment(review.comment);
        parts.push(`<tr>
              <td style="padding:8px 20px ${index === shown.length - 1 && more === 0 ? 16 : 6}px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="88" valign="top" style="padding-top:1px;">${stars(review.stars, 14)}</td>
                    <td valign="top" style="font-family:${FONT};font-size:14px;line-height:1.5;color:${INK};"><strong>${escapeHtml(trimName(review.name))}</strong>${comment ? `<br><span style="color:${MUTED};">&ldquo;${escapeHtml(comment)}&rdquo;</span>` : ""}</td>
                  </tr>
                </table>
              </td>
            </tr>`);
      });
      if (more > 0) {
        parts.push(`<tr>
              <td style="padding:2px 20px 16px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">and ${plural(more, "more")}</td>
            </tr>`);
      }
    }
  }

  return panel(parts.join("\n            "));
}

function dayChart(s: WeeklySummaryStats): string {
  const max = Math.max(...s.requestsByDay, 1);
  const columns = s.requestsByDay
    .map((n) => {
      const height = n === 0 ? 3 : Math.max(8, Math.round((n / max) * 64));
      const color = n === 0 ? LINE : INK;
      return `<td width="14%" valign="bottom" align="center" style="padding:0 3px;">
                      <div style="font-family:${FONT};font-size:13px;line-height:1.6;font-weight:600;color:${INK};">${n === 0 ? "&nbsp;" : fmt(n)}</div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="${height}" bgcolor="${color}" style="height:${height}px;background:${color};border-radius:4px 4px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr></table>
                    </td>`;
    })
    .join("");
  const names = s.dayShortNames
    .map(
      (name) =>
        `<td width="14%" align="center" style="padding:6px 3px 0;font-family:${FONT};font-size:12px;line-height:1.4;color:${FAINT};">${name}</td>`,
    )
    .join("");
  return panel(`<tr>
              <td style="padding:16px 20px 2px;">${label("Review requests by day")}</td>
            </tr>
            <tr>
              <td style="padding:6px 14px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>${columns}</tr>
                  <tr>${names}</tr>
                </table>
              </td>
            </tr>`);
}

function activityLines(s: WeeklySummaryStats): string[] {
  const lines: string[] = [];
  const auto = s.automaticRequests.jobber + s.automaticRequests.square;
  if (auto > 0) {
    const from = joinNames([
      ...(s.automaticRequests.jobber > 0 ? [PROVIDER_NAMES.jobber] : []),
      ...(s.automaticRequests.square > 0 ? [PROVIDER_NAMES.square] : []),
    ]);
    lines.push(
      `${plural(auto, "review request")} went out on their own after a paid invoice in ${from}.`,
    );
  }
  const top = Math.max(...s.requestsByDay);
  if (s.requestsSent >= 3 && top > 0) {
    const topDays = s.requestsByDay
      .map((n, i) => (n === top ? i : -1))
      .filter((i) => i >= 0);
    if (topDays.length === 1) {
      lines.push(
        `Your busiest day was ${s.dayLongNames[topDays[0] as number]}, with ${plural(top, "request")}.`,
      );
    }
  }
  if (s.remindersSent > 0) {
    lines.push(
      `${plural(s.remindersSent, "reminder")} went out to customers who had not responded yet.`,
    );
  }
  return lines;
}

function layout(args: {
  subject: string;
  preheader: string;
  rows: string;
  businessName: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(args.subject)}</title>
<style>
@media only screen and (max-width:480px){
  .px{padding-left:20px !important;padding-right:20px !important;}
  .h1{font-size:23px !important;}
  .stat{padding-left:4px !important;padding-right:4px !important;}
  .stat-num{font-size:28px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(args.preheader)}</div>
<div style="background:#f4f4f5;padding:24px 12px;font-family:${FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};">
    <tr>
      <td align="center" bgcolor="#0b0b0c" style="background:#0b0b0c;padding:26px 32px 24px;">
        <a href="${CANONICAL_SITE_URL}" style="text-decoration:none;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;color:#fafafa;letter-spacing:-0.5px;">UpTrend <span style="font-weight:400;color:#a1a1aa;">Scaling</span></a>
        <div style="margin-top:6px;font-family:${FONT};font-size:11px;line-height:1.4;letter-spacing:2px;color:#8d8d93;">YOUR WEEKLY SUMMARY</div>
      </td>
    </tr>
${args.rows}
    <tr>
      <td class="px" align="center" style="padding:22px 32px 26px;border-top:1px solid ${LINE};background:#fafafa;">
        <p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};">You are getting this every Monday because you have an UpTrend Scaling account for ${escapeHtml(args.businessName)}. Turn this off anytime in your dashboard settings.</p>
        <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};">UpTrend Scaling LLC &middot; Glendale, AZ</p>
      </td>
    </tr>
  </table>
</div>
</body>
</html>`;
}

function titleBlock(
  ctx: SummaryContext,
  stats: WeeklySummaryStats,
  heading: string,
  lead: string,
  showWindow = true,
): string {
  const name = firstName(ctx.contactName);
  // The date range never splits across two lines on a phone.
  const subtitle = showWindow
    ? `${escapeHtml(ctx.businessName)} &middot; <span style="white-space:nowrap;">${escapeHtml(stats.windowLabel)}</span>`
    : escapeHtml(ctx.businessName);
  return `<tr>
      <td class="px" style="padding:30px 32px 14px;">
        <h1 class="h1" style="margin:0 0 6px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:700;color:${INK};">${escapeHtml(heading)}</h1>
        <p style="margin:0 0 20px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${subtitle}</p>
        <p style="margin:0 0 4px;font-family:${FONT};font-size:16px;line-height:1.65;color:${INK};">Hi ${escapeHtml(name ?? "there")},</p>
        <p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.65;color:${INK};">${escapeHtml(lead)}</p>
      </td>
    </tr>`;
}

function button(text: string): string {
  return `<tr>
      <td class="px" align="left" style="padding:10px 32px 30px;">
        <a href="${DASHBOARD_URL}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-family:${FONT};font-weight:600;font-size:15px;padding:14px 30px;border-radius:8px;">${escapeHtml(text)}</a>
      </td>
    </tr>`;
}

function renderRegular(
  ctx: SummaryContext,
  s: WeeklySummaryStats,
  subject: string,
): { html: string; text: string } {
  const attention = attentionItems(s);
  const steps = nextSteps(s);
  const activity = activityLines(s);

  // In the order a review request travels: sent, nudged, opened, reviewed, then
  // the extras. QR scans and Google reviews appear only when we measure them.
  const cells: Array<[number, string]> = [
    [s.requestsSent, "Review requests sent"],
    [s.remindersSent, "Reminders sent"],
    [s.linksOpened, "Review links opened"],
    [s.markedReviewed, "Marked as reviewed"],
  ];
  if (s.qrScans !== null) cells.push([s.qrScans, "QR code scans"]);
  if (s.google && s.google.newReviews !== null) {
    cells.push([s.google.newReviews, "New Google reviews"]);
  }

  const rows: string[] = [
    titleBlock(ctx, s, "Your week in reviews", leadSentence(s)),
  ];
  if (attention.length > 0) rows.push(attentionBox(attention));
  rows.push(statGrid(cells));
  if (s.google) rows.push(googleCard(s.google));
  if (s.requestsSent > 0) rows.push(dayChart(s));
  if (activity.length > 0) {
    rows.push(`<tr>
      <td class="px" style="padding:12px 32px 4px;">
        ${label("What else happened")}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
          ${bulletRows(activity.map(escapeHtml))}
        </table>
      </td>
    </tr>`);
  }
  if (steps.length > 0) {
    rows.push(`<tr>
      <td class="px" style="padding:12px 32px 4px;">
        ${label("Ideas for next week")}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
          ${bulletRows(steps.map(escapeHtml))}
        </table>
      </td>
    </tr>`);
  }
  rows.push(
    button(s.reviewLinkMissing ? "Add your review link" : "Open your dashboard"),
  );

  const preheader = [
    `${plural(s.requestsSent, "review request")} sent`,
    `${plural(s.linksOpened, "link")} opened`,
    ...(s.google && (s.google.newReviews ?? 0) > 0
      ? [`${plural(s.google.newReviews ?? 0, "new Google review")}`]
      : []),
  ].join(", ");

  const html = layout({
    subject,
    preheader,
    rows: rows.join("\n"),
    businessName: ctx.businessName,
  });

  // Plain text copy of exactly the same facts.
  const t: string[] = [];
  t.push("YOUR WEEK IN REVIEWS");
  t.push(`${ctx.businessName}, ${s.windowLabel}`);
  t.push("", `Hi ${firstName(ctx.contactName) ?? "there"},`, "", leadSentence(s));
  if (attention.length > 0) {
    t.push("", "NEEDS YOUR ATTENTION");
    for (const item of attention) t.push(`* ${item.title} ${item.body}`);
  }
  t.push("", "THE NUMBERS");
  for (const [value, caption] of cells) {
    t.push(`${caption}: ${fmt(value)}`);
  }
  if (s.google) {
    const g = s.google;
    t.push("", "GOOGLE");
    if (g.rating !== null && g.totalReviews !== null) {
      t.push(
        `Rating: ${g.rating.toFixed(1)} stars from ${plural(g.totalReviews, "review")}${g.asOfLabel ? ` (as of ${g.asOfLabel})` : ""}`,
      );
      for (const line of ratingChangeText(g)) t.push(line);
    }
    if (g.newReviews !== null) {
      if (g.reviews.length === 0) {
        t.push("No new Google reviews this week.");
      } else {
        t.push(`New this week: ${fmt(g.newReviews)}`);
        for (const review of g.reviews.slice(0, 5)) {
          const comment = trimComment(review.comment);
          t.push(
            `  ${plural(review.stars, "star")}, ${trimName(review.name)}${comment ? `: "${comment}"` : ""}`,
          );
        }
        if (g.reviews.length > 5) {
          t.push(`  and ${plural(g.reviews.length - 5, "more")}`);
        }
      }
    }
  }
  if (s.requestsSent > 0) {
    t.push("", "REVIEW REQUESTS BY DAY");
    s.requestsByDay.forEach((n, i) => t.push(`${s.dayShortNames[i]}: ${fmt(n)}`));
  }
  if (activity.length > 0) {
    t.push("", "WHAT ELSE HAPPENED");
    for (const line of activity) t.push(`* ${line}`);
  }
  if (steps.length > 0) {
    t.push("", "IDEAS FOR NEXT WEEK");
    for (const line of steps) t.push(`* ${line}`);
  }
  t.push("", `Open your dashboard: ${DASHBOARD_URL}`);
  t.push(
    "",
    `You are getting this every Monday because you have an UpTrend Scaling account for ${ctx.businessName}. Turn this off anytime in your dashboard settings.`,
    "UpTrend Scaling LLC, Glendale, AZ",
  );
  return { html, text: t.join("\n") };
}

function renderGetStarted(
  ctx: SummaryContext,
  s: WeeklySummaryStats,
  subject: string,
): { html: string; text: string } {
  const steps = getStartedSteps(s);
  const stepRows = steps
    .map((step, index) => {
      const circleColor = step.done ? GOOD : INK;
      return `<tr>
              <td width="40" valign="top" style="padding:0 0 18px;">
                <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="28" height="28" align="center" valign="middle" bgcolor="${circleColor}" style="width:28px;height:28px;background:${circleColor};border-radius:14px;font-family:${FONT};font-size:14px;line-height:28px;font-weight:700;color:#ffffff;">${step.done ? "&#10003;" : index + 1}</td></tr></table>
              </td>
              <td valign="top" style="padding:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK};"><strong>${escapeHtml(step.title)}</strong><br><span style="color:${MUTED};">${escapeHtml(step.body)}</span></td>
            </tr>`;
    })
    .join("\n");

  const lead =
    "Your account is ready. A few quick steps and your first review requests can go out today.";
  const rows = [
    titleBlock(ctx, s, "Here is how to get started", lead, false),
    `<tr>
      <td class="px" style="padding:10px 32px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${stepRows}
        </table>
      </td>
    </tr>`,
    `<tr>
      <td class="px" style="padding:0 32px 6px;">
        <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">From now on you will get a short email like this every Monday morning with your numbers for the week: review requests sent, links opened, new Google reviews and anything that needs your attention.</p>
      </td>
    </tr>`,
    button("Finish setting up"),
  ];
  const html = layout({
    subject,
    preheader: "Four quick steps and your first review requests can go out today.",
    rows: rows.join("\n"),
    businessName: ctx.businessName,
  });

  const t = [
    "HERE IS HOW TO GET STARTED",
    ctx.businessName,
    "",
    `Hi ${firstName(ctx.contactName) ?? "there"},`,
    "",
    lead,
    "",
    ...steps.map(
      (step, i) =>
        `${step.done ? "[done]" : `${i + 1}.`} ${step.title}\n   ${step.body}`,
    ),
    "",
    "From now on you will get a short email like this every Monday morning with your numbers for the week.",
    "",
    `Finish setting up: ${DASHBOARD_URL}`,
    "",
    `You are getting this every Monday because you have an UpTrend Scaling account for ${ctx.businessName}. Turn this off anytime in your dashboard settings.`,
    "UpTrend Scaling LLC, Glendale, AZ",
  ];
  return { html, text: t.join("\n") };
}

// Pure: turns the numbers into the finished email. Exported so a preview can be
// rendered without a database.
export function renderWeeklySummary(
  ctx: SummaryContext,
  stats: WeeklySummaryStats,
): { subject: string; html: string; text: string } {
  const subject = summarySubject(stats);
  const body = stats.isNewAccount
    ? renderGetStarted(ctx, stats, subject)
    : renderRegular(ctx, stats, subject);
  return { subject, ...body };
}

// Builds one business's summary for the 7 days before `now`. Returns null when
// the business does not exist.
export async function buildWeeklySummary(
  businessId: string,
  now: Date = new Date(),
): Promise<WeeklySummary | null> {
  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) return null;
  return buildForBusiness(db, business, now);
}

async function buildForBusiness(
  db: Db,
  business: Business,
  now: Date,
): Promise<WeeklySummary> {
  const stats = await gatherStats(db, business, now);
  const rendered = renderWeeklySummary(
    { businessName: business.businessName, contactName: business.contactName },
    stats,
  );
  return { ...rendered, stats };
}

// ---------------------------------------------------------------------------
// Sending (the cron job)
// ---------------------------------------------------------------------------

// Shared free Resend plan: 100 emails a day for everything. Sixty summaries
// leaves room for the customer review requests that share the quota.
const MAX_EMAILS_PER_RUN = 60;
// Whole run, database work and sending. The hosting plan cuts functions off a
// little after this.
const TIME_BUDGET_MS = 8_000;
// Building 60 emails is database work; keep the last part of the budget for the
// Resend call itself.
const SEND_RESERVE_MS = 3_000;
const BUILD_CONCURRENCY = 5;
// Resend allows 100 emails in one batch request. One request also keeps us far
// away from the per-second limit that rejected most single sends on 2026-10-02.
const RESEND_BATCH_LIMIT = 100;
// A summary is due again only after this long, so opening the cron URL by hand
// on a Tuesday does nothing.
const MIN_DAYS_BETWEEN_SUMMARIES = 5;
// An unfinished claim older than this (the run died between claiming and
// finishing) can be taken over. Longer than any run, so a live run is safe.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Resend's single-send endpoint allows about 2 requests a second per team.
const SINGLE_SEND_GAP_MS = 550;

const CLAIM_PROVIDER = "stripe" as const;
const CLAIM_TOPIC = "weekly_summary";

const SUMMARY_FROM = `UpTrend Scaling <${UPTREND_SUPPORT_EMAIL}>`;

export type WeeklySummaryRunResult = {
  ok: boolean;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  // True when the per-run cap or the time budget left some businesses for the
  // next run (they stay due).
  capped: boolean;
  reason?: "not_configured" | "error";
  // A few short failure reasons for the cron log. No personal data.
  errors?: string[];
};

export type SendWeeklySummariesOptions = {
  maxEmails?: number;
  budgetMs?: number;
  singleSendGapMs?: number;
};

function claimKey(businessId: string, weekKey: string): string {
  return `weekly-summary:${businessId}:${weekKey}`;
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

type ResendEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to: string;
};

type ResendResult =
  | { ok: true }
  | { ok: false; status: number | null; error: string };

async function postToResend(
  path: "/emails" | "/emails/batch",
  body: ResendEmail | ResendEmail[],
  timeoutMs: number,
): Promise<ResendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return { ok: false, status: null, error: "Resend is not configured yet." };
  try {
    const response = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      ok: false,
      status: response.status,
      error: payload?.message ?? `Resend responded with ${response.status}`,
    };
  } catch (error) {
    console.error("[weekly-summary] could not reach Resend", error);
    return { ok: false, status: null, error: "Network error sending email." };
  }
}

type Prepared = {
  business: Business;
  key: string;
  email: ResendEmail;
};

type Delivery = { ok: true } | { ok: false; error: string; deferred: boolean };

// Sends everything in one batch request. Resend checks a batch strictly, so a
// single malformed address rejects the whole request (a 400 or 422); only in
// that case do we fall back to one-by-one sends so one bad address cannot
// block everyone else. Any other failure (quota, outage, bad key, timeout)
// fails the lot, because trying each one again would only repeat it.
async function deliver(
  prepared: Prepared[],
  deadline: number,
  gapMs: number,
): Promise<Delivery[]> {
  const batch = await postToResend(
    "/emails/batch",
    prepared.map((p) => p.email),
    deadline - Date.now(),
  );
  if (batch.ok) return prepared.map(() => ({ ok: true }) as Delivery);
  if (batch.status !== 400 && batch.status !== 422) {
    return prepared.map(() => ({ ok: false, error: batch.error, deferred: false }));
  }

  const results: Delivery[] = [];
  let lastStart = 0;
  for (const item of prepared) {
    const wait = lastStart + gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (Date.now() >= deadline) {
      results.push({ ok: false, error: "ran out of time", deferred: true });
      continue;
    }
    lastStart = Date.now();
    const single = await postToResend("/emails", item.email, deadline - Date.now());
    results.push(
      single.ok
        ? { ok: true }
        : { ok: false, error: single.error, deferred: false },
    );
    // A rate limit or a used-up daily quota will not clear within this run.
    if (!single.ok && single.status === 429) {
      for (let i = results.length; i < prepared.length; i += 1) {
        results.push({ ok: false, error: single.error, deferred: false });
      }
      break;
    }
  }
  return results;
}

async function findDueBusinesses(
  db: Db,
  now: Date,
  limit: number,
): Promise<Business[]> {
  const cutoff = new Date(now.getTime() - MIN_DAYS_BETWEEN_SUMMARIES * DAY_MS);
  return db
    .select()
    .from(businesses)
    .where(
      and(
        isNotNull(businesses.passwordHash),
        eq(businesses.accessRevoked, false),
        eq(businesses.weeklySummaryEnabled, true),
        isNotNull(businesses.plan),
        or(
          isNull(businesses.lastSummarySentAt),
          lt(businesses.lastSummarySentAt, cutoff),
        ),
      ),
    )
    .orderBy(asc(businesses.createdAt))
    .limit(limit);
}

// Insert-or-skip claim for each business's email this week, in one statement.
// Returns the claim keys this run now owns. A claim left unfinished by a run
// that died is taken over once it is stale; a finished one never is.
async function claimWeek(db: Db, keys: string[]): Promise<Set<string>> {
  const inserted = await db
    .insert(crmWebhookEvents)
    .values(
      keys.map((dedupeKey) => ({
        provider: CLAIM_PROVIDER,
        dedupeKey,
        topic: CLAIM_TOPIC,
      })),
    )
    .onConflictDoNothing({
      target: [crmWebhookEvents.provider, crmWebhookEvents.dedupeKey],
    })
    .returning({ dedupeKey: crmWebhookEvents.dedupeKey });
  const owned = new Set(inserted.map((row) => row.dedupeKey));

  const rest = keys.filter((key) => !owned.has(key));
  if (rest.length > 0) {
    const taken = await db
      .update(crmWebhookEvents)
      .set({ receivedAt: new Date() })
      .where(
        and(
          eq(crmWebhookEvents.provider, CLAIM_PROVIDER),
          inArray(crmWebhookEvents.dedupeKey, rest),
          isNull(crmWebhookEvents.processedAt),
          lt(crmWebhookEvents.receivedAt, new Date(Date.now() - STALE_CLAIM_MS)),
        ),
      )
      .returning({ dedupeKey: crmWebhookEvents.dedupeKey });
    for (const row of taken) owned.add(row.dedupeKey);
  }
  return owned;
}

async function releaseClaims(db: Db, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await db
      .delete(crmWebhookEvents)
      .where(
        and(
          eq(crmWebhookEvents.provider, CLAIM_PROVIDER),
          inArray(crmWebhookEvents.dedupeKey, keys),
        ),
      );
  } catch (error) {
    console.error("[weekly-summary] failed to release claims", error);
  }
}

// Sends this week's summary to every business that is due. Never throws.
//
// Who is due: account claimed (password set), access not revoked, summary not
// switched off, a plan, and no summary in the last 5 days.
//
// Exactly once: before building an email, the business's week is claimed with
// an insert-or-skip row (the same claim-marker pattern the owner alerts use),
// so two runs at the same moment, or a retry, cannot both send it. The
// claim is released if the send fails, so a later run can try again.
// last_summary_sent_at is only written after Resend accepted the email.
export async function sendWeeklySummaries(
  now: Date = new Date(),
  options: SendWeeklySummariesOptions = {},
): Promise<WeeklySummaryRunResult> {
  const result: WeeklySummaryRunResult = {
    ok: true,
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    capped: false,
  };
  if (!isDbConfigured() || !isResendConfigured()) {
    return { ...result, ok: false, reason: "not_configured" };
  }

  const cap = Math.min(
    options.maxEmails ?? MAX_EMAILS_PER_RUN,
    RESEND_BATCH_LIMIT,
  );
  const startedAt = Date.now();
  const deadline = startedAt + (options.budgetMs ?? TIME_BUDGET_MS);
  const errors: string[] = [];
  const noteError = (message: string) => {
    if (errors.length < 5 && !errors.includes(message)) errors.push(message);
  };

  try {
    const db = getDb();
    const found = await findDueBusinesses(db, now, cap + 1);
    const due = found.slice(0, cap);
    if (found.length > cap) {
      result.capped = true;
      console.warn(
        `[weekly-summary] capped at ${cap} emails this run; the rest stay due and go out next run`,
      );
    }
    result.considered = due.length;
    if (due.length === 0) return result;

    const keyFor = (business: Business) =>
      claimKey(business.id, summaryWindow(now, business.timezone).weekKey);
    const owned = await claimWeek(db, due.map(keyFor));
    const claimed = due.filter((business) => owned.has(keyFor(business)));
    // Already sent (or being sent by another run right now).
    result.skipped += due.length - claimed.length;

    // Build every email. Anything that cannot be built, or that we run out of
    // time for, gives its claim back so it stays due.
    const buildDeadline = deadline - SEND_RESERVE_MS;
    const releaseKeys: string[] = [];
    const built = await mapWithLimit(claimed, BUILD_CONCURRENCY, async (business) => {
      if (Date.now() > buildDeadline) {
        result.skipped += 1;
        result.capped = true;
        releaseKeys.push(keyFor(business));
        return null;
      }
      try {
        const summary = await buildForBusiness(db, business, now);
        const prepared: Prepared = {
          business,
          key: keyFor(business),
          email: {
            from: SUMMARY_FROM,
            to: business.email,
            subject: summary.subject,
            html: summary.html,
            text: summary.text,
            reply_to: UPTREND_SUPPORT_EMAIL,
          },
        };
        return prepared;
      } catch (error) {
        console.error("[weekly-summary] failed to build a summary", error);
        result.failed += 1;
        noteError("could not build a summary");
        releaseKeys.push(keyFor(business));
        return null;
      }
    });
    const prepared = built.filter((item): item is Prepared => item !== null);

    const sentKeys: string[] = [];
    const sentIds: string[] = [];
    if (prepared.length > 0) {
      const deliveries = await deliver(
        prepared,
        deadline,
        options.singleSendGapMs ?? SINGLE_SEND_GAP_MS,
      );
      prepared.forEach((item, index) => {
        const delivery = deliveries[index] ?? {
          ok: false as const,
          error: "no result",
          deferred: false,
        };
        if (delivery.ok) {
          sentKeys.push(item.key);
          sentIds.push(item.business.id);
        } else if (delivery.deferred) {
          result.skipped += 1;
          result.capped = true;
          releaseKeys.push(item.key);
        } else {
          result.failed += 1;
          noteError(delivery.error);
          releaseKeys.push(item.key);
        }
      });
    }

    // Only now, with Resend's yes in hand, record that these went out. If this
    // write fails the finished claim still stops a same-week resend.
    if (sentIds.length > 0) {
      result.sent = sentIds.length;
      try {
        await db
          .update(businesses)
          .set({ lastSummarySentAt: now })
          .where(inArray(businesses.id, sentIds));
        await db
          .update(crmWebhookEvents)
          .set({ processedAt: new Date() })
          .where(
            and(
              eq(crmWebhookEvents.provider, CLAIM_PROVIDER),
              inArray(crmWebhookEvents.dedupeKey, sentKeys),
            ),
          );
      } catch (error) {
        console.error(
          "[weekly-summary] sent, but could not record it (the claim still prevents a repeat this week)",
          error,
        );
        noteError("sent, but could not record it");
      }
    }
    await releaseClaims(db, releaseKeys);

    if (result.failed > 0) {
      console.error(
        `[weekly-summary] ${result.failed} of ${result.considered} summaries failed: ${errors.join("; ")}`,
      );
    }
    if (errors.length > 0) result.errors = errors;
    return result;
  } catch (error) {
    console.error("[weekly-summary] run failed", error);
    return { ...result, ok: false, reason: "error" };
  }
}

// ---------------------------------------------------------------------------
// Cron entry point
// ---------------------------------------------------------------------------

// Same check as the reminders job (reviews.server.ts): Vercel signs scheduled
// requests with CRON_SECRET as a Bearer token, so only our own cron can run it.
function isCronRequestAuthorized(): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  const auth = getRequestHeader("authorization");
  return auth === `Bearer ${expected}`;
}

export type WeeklySummaryCronResult =
  | WeeklySummaryRunResult
  | { ok: false; reason: "unauthorized" };

// Wrapped in createServerFn, like runReminderCron, so the body (and the
// request-header calls in it) is compiled out of the client bundle.
export const runWeeklySummaryCron = createServerFn({ method: "GET" }).handler(
  async (): Promise<WeeklySummaryCronResult> => {
    if (!isCronRequestAuthorized()) {
      setResponseStatus(401);
      return { ok: false, reason: "unauthorized" };
    }
    const result = await sendWeeklySummaries(new Date());
    setResponseStatus(result.reason === "error" ? 500 : 200);
    return result;
  },
);
