// Everything the redesigned /app dashboard needs from the server, in as few
// round trips as possible:
//
//   getDashboardShell     top bar, integration chips, setup to-dos (every tab)
//   getDashboardOverview  the shell plus the whole Overview tab
//   setWeeklySummaryEnabled   the on/off switch in Settings
//
// The logic lives in plain exported functions that take a businessId (so it
// can be run against a test database); the server fns at the bottom are thin
// wrappers that read the session first. Real data only: nothing here invents
// a number. When Google is not connected the Google cards say so and the
// chart falls back to review links opened (customers.link_clicked_at).

import { createServerFn } from "@tanstack/react-start";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import type {
  ActivityItem,
  ChipTone,
  DashboardOverview,
  DashboardOverviewResult,
  DashboardShell,
  IntegrationChip,
  MessagingStatus,
  SetupTodo,
  StatCardData,
  WeeklyChart,
} from "../components/dashboard/types";
import { getSessionBusinessId, isAuthConfigured } from "./auth.server";
import type { ConnectionSummary } from "./crm/connections.server";
import type { GoogleStatus, GoogleSummary } from "./dashboard-types";
import { getDb, isDbConfigured } from "./db/client";
import {
  businesses,
  crmConnections,
  crmWebhookEvents,
  customers,
  messages,
  type Business,
} from "./db/schema";
import { getGoogleStatus, getGoogleSummary } from "./google.server";
import { isResendConfigured, isTelnyxConfigured } from "./messaging.server";
import { getRecentQrScans } from "./qr.server";

const DEFAULT_TIMEZONE = "America/Phoenix";
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 52;
const SPARK_WEEKS = 12;

// ------------------------------------------------------------------ time

export function safeTimeZone(value: string | null | undefined): string {
  const candidate = value || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

type ZonedParts = {
  year: number;
  month: number; // 1 to 12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Monday ... 6 = Sunday
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]) % 24,
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
    weekday: WEEKDAY_INDEX[parts["weekday"] ?? "Mon"] ?? 0,
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The real instant at which the given wall-clock time happens in `timeZone`.
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  const second = guess - zoneOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

export function startOfMonthInstant(
  now: Date,
  timeZone: string,
  monthsBack: number,
): Date {
  const p = zonedParts(now, timeZone);
  let year = p.year;
  let month = p.month - monthsBack;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  return zonedTimeToInstant(year, month, 1, timeZone);
}

function isoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

// The last `count` week keys (Monday dates as YYYY-MM-DD in the business's
// timezone), oldest first. The final entry is the current week.
export function weekKeys(now: Date, timeZone: string, count: number): string[] {
  const p = zonedParts(now, timeZone);
  const mondayUtc = Date.UTC(p.year, p.month - 1, p.day) - p.weekday * DAY_MS;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(isoDate(mondayUtc - i * 7 * DAY_MS));
  }
  return keys;
}

function instantOfDateKey(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedTimeToInstant(y ?? 1970, m ?? 1, d ?? 1, timeZone);
}

// How many of the weeks (oldest first) touch the current calendar year.
export function countYtdWeeks(keys: string[], now: Date, timeZone: string) {
  const year = zonedParts(now, timeZone).year;
  const jan1Utc = Date.UTC(year, 0, 1);
  const cutoff = isoDate(jan1Utc - 6 * DAY_MS);
  return Math.max(1, keys.filter((key) => key >= cutoff).length);
}

export function greetingFor(
  now: Date,
  timeZone: string,
  contactName: string,
): string {
  const hour = zonedParts(now, timeZone).hour;
  const salutation =
    hour >= 5 && hour < 12
      ? "Good morning"
      : hour >= 12 && hour < 17
        ? "Good afternoon"
        : "Good evening";
  const first = firstNameOf(contactName);
  return first ? `${salutation}, ${first}.` : `${salutation}.`;
}

export function firstNameOf(contactName: string | null | undefined): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  // The account claim flow stores "Owner" when no name was given.
  if (!first || first.toLowerCase() === "owner") return "";
  return first;
}

export function dateLineFor(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);
}

// ----------------------------------------------------------------- names

// "Maria Gonzalez" becomes "Maria G." (customers are shown like this).
export function shortName(
  full: string | null | undefined,
  fallback = "A customer",
): string {
  const tokens = (full ?? "").trim().split(/\s+/).filter(Boolean);
  const first = tokens[0];
  if (!first) return fallback;
  if (tokens.length === 1) return first;
  const last = tokens[tokens.length - 1] ?? "";
  const initial = last.replace(/[^\p{L}\p{N}]/gu, "").charAt(0);
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

export function excerpt(
  text: string | null | undefined,
  max = 64,
): string | null {
  const oneLine = (text ?? "").replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  if (oneLine.length <= max) return oneLine;
  const cut = oneLine.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).replace(
    /[\s.,;:!?-]+$/,
    "",
  );
  return `${trimmed}…`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

// ------------------------------------------------------------------ shell

export function smsStatus(): MessagingStatus["sms"] {
  if (!isTelnyxConfigured()) return "off";
  // US carriers block unverified numbers, so keys alone do not mean texts
  // arrive. TELNYX_VERIFIED=true is set once the carrier registration clears.
  return process.env["TELNYX_VERIFIED"] === "true" ? "on" : "pending";
}

export function messagingStatus(): MessagingStatus {
  return {
    sms: smsStatus(),
    email: isResendConfigured() ? "on" : "off",
  };
}

function chip(
  key: IntegrationChip["key"],
  label: string,
  detail: string,
  tone: ChipTone,
  options: Partial<
    Pick<IntegrationChip, "since" | "sincePrefix" | "opensSettings">
  > = {},
): IntegrationChip {
  return {
    key,
    label,
    detail,
    tone,
    since: options.since ?? null,
    sincePrefix: options.sincePrefix ?? null,
    opensSettings: options.opensSettings ?? false,
  };
}

function crmChip(
  key: "square" | "jobber",
  label: string,
  connection: ConnectionSummary | undefined,
): IntegrationChip {
  if (!connection) {
    return chip(key, label, "not connected", "off", { opensSettings: true });
  }
  if (connection.lastErrorMessage) {
    return chip(key, label, "needs reconnect", "warn", { opensSettings: true });
  }
  // Square and Jobber push events to us, so there is no "sync". Only claim
  // something when an event really arrived.
  if (connection.lastEventAt) {
    return chip(key, label, "listening", "ok", {
      since: new Date(connection.lastEventAt).toISOString(),
      sincePrefix: "last invoice",
      opensSettings: true,
    });
  }
  return chip(key, label, "listening", "ok", { opensSettings: true });
}

function googleChip(google: GoogleStatus): IntegrationChip {
  const label = "Google Business Profile";
  if (!google.configured) {
    return chip("google", label, "coming soon", "off", { opensSettings: true });
  }
  if (!google.connected) {
    return chip("google", label, "not connected", "off", {
      opensSettings: true,
    });
  }
  if (google.needsReconnect) {
    return chip("google", label, "needs reconnect", "warn", {
      opensSettings: true,
    });
  }
  if (google.awaitingLocation) {
    return chip("google", label, "pick a location", "warn", {
      opensSettings: true,
    });
  }
  if (google.lastSyncedAt) {
    return chip("google", label, "linked", "ok", {
      since: google.lastSyncedAt,
      sincePrefix: "synced",
      opensSettings: true,
    });
  }
  return chip("google", label, "linked", "ok", { opensSettings: true });
}

export function computeChips(input: {
  connections: ConnectionSummary[];
  google: GoogleStatus;
  messaging: MessagingStatus;
}): IntegrationChip[] {
  const byProvider = new Map(
    input.connections.map((connection) => [connection.provider, connection]),
  );
  const { sms, email } = input.messaging;
  return [
    crmChip("square", "Square", byProvider.get("square")),
    crmChip("jobber", "Jobber", byProvider.get("jobber")),
    sms === "on"
      ? chip("sms", "SMS", "on", "ok")
      : sms === "pending"
        ? chip("sms", "SMS", "pending carrier approval", "warn")
        : chip("sms", "SMS", "off", "off"),
    email === "on"
      ? chip("email", "Email", "on", "ok")
      : chip("email", "Email", "off", "off"),
    googleChip(input.google),
  ];
}

export function computeTodos(input: {
  business: Pick<Business, "googleReviewUrl">;
  connections: ConnectionSummary[];
  google: GoogleStatus;
  messaging: MessagingStatus;
}): SetupTodo[] {
  const todos: SetupTodo[] = [];
  const byProvider = new Map(
    input.connections.map((connection) => [connection.provider, connection]),
  );

  if (!input.business.googleReviewUrl) {
    todos.push({
      id: "review-link",
      title: "Add your Google review link",
      detail: "Nothing is sent to your customers until this is set.",
      blocking: true,
    });
  }

  if (byProvider.get("square")?.lastErrorMessage) {
    todos.push({
      id: "reconnect-square",
      title: "Reconnect Square",
      detail:
        "We lost access to your Square account. New paid invoices will not get a review request until you reconnect.",
      blocking: true,
    });
  }
  if (byProvider.get("jobber")?.lastErrorMessage) {
    todos.push({
      id: "reconnect-jobber",
      title: "Reconnect Jobber",
      detail:
        "We lost access to your Jobber account. New paid invoices will not get a review request until you reconnect.",
      blocking: true,
    });
  }
  if (input.google.connected && input.google.needsReconnect) {
    todos.push({
      id: "reconnect-google",
      title: "Reconnect Google",
      detail:
        "Google access was lost, so your rating and new reviews have stopped updating.",
      blocking: true,
    });
  }

  if (!byProvider.has("square") && !byProvider.has("jobber")) {
    todos.push({
      id: "crm",
      title: "Connect Square or Jobber",
      detail:
        "So a review request goes out on its own the moment an invoice is paid.",
      blocking: false,
    });
  }

  if (input.google.configured && !input.google.connected) {
    todos.push({
      id: "google",
      title: "Connect your Google Business Profile",
      detail:
        "So this dashboard can show your real rating and your new reviews.",
      blocking: false,
    });
  } else if (
    input.google.configured &&
    input.google.connected &&
    input.google.awaitingLocation
  ) {
    todos.push({
      id: "google-location",
      title: "Choose your Google business location",
      detail: "Pick which location is yours so we can track its reviews.",
      blocking: false,
    });
  }

  if (input.messaging.sms === "pending") {
    todos.push({
      id: "sms",
      title: "Text messages are waiting on carrier approval",
      detail:
        "US carriers block texts from new business numbers until they approve them. Emails still go out in the meantime.",
      blocking: false,
    });
  }

  return todos;
}

export type ShellOptions = {
  // Called only when the account is active (so a paused account never talks
  // to Google).
  getGoogleStatus: () => Promise<GoogleStatus>;
  now?: Date;
};

const IDLE_GOOGLE_STATUS: GoogleStatus = {
  configured: false,
  connected: false,
  needsReconnect: false,
  awaitingLocation: false,
  locationName: null,
  lastSyncedAt: null,
  errorMessage: null,
};

function toPublicBusiness(business: Business): DashboardShell["business"] {
  return {
    id: business.id,
    businessName: business.businessName,
    contactName: business.contactName,
    email: business.email,
    phone: business.phone,
    locations: business.locations,
    plan: business.plan,
    googleReviewUrl: business.googleReviewUrl,
    isAdmin: business.isAdmin,
    accessRevoked: business.accessRevoked,
  };
}

export async function loadDashboardShell(
  businessId: string,
  options: ShellOptions,
): Promise<DashboardShell | null> {
  const db = getDb();
  const now = options.now ?? new Date();

  const [businessRows, connectionRows] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1),
    db
      .select({
        provider: crmConnections.provider,
        connectedAt: crmConnections.connectedAt,
        lastErrorMessage: crmConnections.lastErrorMessage,
        lastEventAt: crmConnections.lastEventAt,
        externalLocationName: crmConnections.externalLocationName,
      })
      .from(crmConnections)
      .where(eq(crmConnections.businessId, businessId)),
  ]);
  const business = businessRows[0];
  if (!business) return null;

  const messaging = messagingStatus();
  const timezone = safeTimeZone(business.timezone);

  if (business.accessRevoked) {
    return {
      business: toPublicBusiness(business),
      generatedAt: now.toISOString(),
      timezone,
      weeklySummaryEnabled: business.weeklySummaryEnabled,
      chips: [],
      todos: [],
      live: false,
      connections: [],
      google: IDLE_GOOGLE_STATUS,
      messaging,
    };
  }

  const google = await options.getGoogleStatus();
  const todos = computeTodos({
    business,
    connections: connectionRows,
    google,
    messaging,
  });
  const live =
    Boolean(business.googleReviewUrl) &&
    !connectionRows.some(
      (connection) =>
        connection.provider !== "google" && connection.lastErrorMessage,
    ) &&
    !(google.connected && google.needsReconnect);

  return {
    business: toPublicBusiness(business),
    generatedAt: now.toISOString(),
    timezone,
    weeklySummaryEnabled: business.weeklySummaryEnabled,
    chips: computeChips({ connections: connectionRows, google, messaging }),
    todos,
    live,
    connections: connectionRows,
    google,
    messaging,
  };
}

// --------------------------------------------------------------- overview

type Db = ReturnType<typeof getDb>;

function sparkTail(values: number[], count = SPARK_WEEKS): number[] {
  return values.slice(-count);
}

function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(values[Math.round((i * (values.length - 1)) / (max - 1))] ?? 0);
  }
  return out;
}

type MessageAggregates = {
  requestsMonth: number;
  autoRequestsMonth: number;
  remindersMonth: number;
  asked30: number;
  opened30: number;
  askedPrev30: number;
  openedPrev30: number;
  requestsLast24h: number;
};

async function loadMessageAggregates(
  db: Db,
  businessId: string,
  now: Date,
  monthStart: Date,
): Promise<MessageAggregates> {
  const d1 = new Date(now.getTime() - DAY_MS).toISOString();
  const d30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const d60Date = new Date(now.getTime() - 60 * DAY_MS);
  const month = monthStart.toISOString();
  const floor = new Date(Math.min(monthStart.getTime(), d60Date.getTime()));
  const d60 = d60Date.toISOString();

  const rows = await db
    .select({
      requestsMonth:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${messages.sentAt} >= ${month}::timestamptz)`.mapWith(
          Number,
        ),
      autoRequestsMonth:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${customers.source} <> 'manual' and ${messages.sentAt} >= ${month}::timestamptz)`.mapWith(
          Number,
        ),
      remindersMonth:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'reminder' and ${messages.sentAt} >= ${month}::timestamptz)`.mapWith(
          Number,
        ),
      asked30:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${messages.sentAt} >= ${d30}::timestamptz)`.mapWith(
          Number,
        ),
      opened30:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${messages.sentAt} >= ${d30}::timestamptz and ${customers.linkClickedAt} is not null)`.mapWith(
          Number,
        ),
      askedPrev30:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${messages.sentAt} >= ${d60}::timestamptz and ${messages.sentAt} < ${d30}::timestamptz)`.mapWith(
          Number,
        ),
      openedPrev30:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${messages.sentAt} >= ${d60}::timestamptz and ${messages.sentAt} < ${d30}::timestamptz and ${customers.linkClickedAt} is not null)`.mapWith(
          Number,
        ),
      requestsLast24h:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${messages.sentAt} >= ${d1}::timestamptz)`.mapWith(
          Number,
        ),
    })
    .from(messages)
    .innerJoin(customers, eq(customers.id, messages.customerId))
    .where(
      and(
        eq(messages.businessId, businessId),
        eq(messages.status, "sent"),
        gte(messages.sentAt, floor),
      ),
    );

  return (
    rows[0] ?? {
      requestsMonth: 0,
      autoRequestsMonth: 0,
      remindersMonth: 0,
      asked30: 0,
      opened30: 0,
      askedPrev30: 0,
      openedPrev30: 0,
      requestsLast24h: 0,
    }
  );
}

type WeeklyMessageRow = {
  week: string;
  asked: number;
  opened: number;
  reminders: number;
};

async function loadWeeklyMessages(
  db: Db,
  businessId: string,
  timeZone: string,
  floor: Date,
): Promise<WeeklyMessageRow[]> {
  return db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${messages.sentAt} at time zone ${timeZone}), 'YYYY-MM-DD')`,
      asked:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial')`.mapWith(
          Number,
        ),
      opened:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'initial' and ${customers.linkClickedAt} is not null)`.mapWith(
          Number,
        ),
      reminders:
        sql<number>`count(distinct ${messages.customerId}) filter (where ${messages.kind} = 'reminder')`.mapWith(
          Number,
        ),
    })
    .from(messages)
    .innerJoin(customers, eq(customers.id, messages.customerId))
    .where(
      and(
        eq(messages.businessId, businessId),
        eq(messages.status, "sent"),
        gte(messages.sentAt, floor),
      ),
    )
    .groupBy(sql`1`);
}

async function loadLinkOpenCounts(
  db: Db,
  businessId: string,
  monthStart: Date,
  lastMonthStart: Date,
): Promise<{ thisMonth: number; lastMonth: number }> {
  const month = monthStart.toISOString();
  const lastMonth = lastMonthStart.toISOString();
  const rows = await db
    .select({
      thisMonth:
        sql<number>`count(*) filter (where ${customers.linkClickedAt} >= ${month}::timestamptz)`.mapWith(
          Number,
        ),
      lastMonth:
        sql<number>`count(*) filter (where ${customers.linkClickedAt} >= ${lastMonth}::timestamptz and ${customers.linkClickedAt} < ${month}::timestamptz)`.mapWith(
          Number,
        ),
    })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, businessId),
        gte(customers.linkClickedAt, lastMonthStart),
      ),
    );
  return rows[0] ?? { thisMonth: 0, lastMonth: 0 };
}

async function loadWeeklyLinkOpens(
  db: Db,
  businessId: string,
  timeZone: string,
  floor: Date,
): Promise<Array<{ week: string; opened: number }>> {
  return db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${customers.linkClickedAt} at time zone ${timeZone}), 'YYYY-MM-DD')`,
      opened: sql<number>`count(*)`.mapWith(Number),
    })
    .from(customers)
    .where(
      and(
        eq(customers.businessId, businessId),
        gte(customers.linkClickedAt, floor),
      ),
    )
    .groupBy(sql`1`);
}

type FeedMessageRow = {
  id: string;
  customerId: string;
  channel: "sms" | "email";
  kind: "initial" | "reminder" | "manual";
  status: "sent" | "failed";
  errorMessage: string | null;
  sentAt: Date;
  customerName: string;
  customerSource: "manual" | "jobber" | "square";
};

type FeedCustomerEvent = { id: string; name: string; at: Date };

type FeedProblemRow = {
  id: string;
  provider: "jobber" | "square" | "stripe";
  errorMessage: string | null;
  receivedAt: Date;
};

// crm_webhook_events.error_message holds three kinds of text (the state
// machine is described in crm/connections.server.ts): "Skipped: ..." (a paid
// invoice we deliberately did not send a request for), "Failed: ..." (we
// tried and hit an error) and "Note: ..." (the request WAS sent, with a
// remark such as "the phone number was not valid, so only the email went
// out"). Only the first two are problems the owner may need to act on. A
// "Note:" row must never be shown as a skipped invoice, and rows with no
// recognised prefix are not claimed to be problems either.
export function isWebhookProblem(message: string | null | undefined): boolean {
  const text = (message ?? "").trimStart();
  return text.startsWith("Skipped:") || text.startsWith("Failed:");
}

// The same rule as isWebhookProblem, as a WHERE condition, so the database
// does the filtering and "Note:" rows never use up a slot in a LIMIT.
export function webhookProblemCondition(): SQL {
  return or(
    like(crmWebhookEvents.errorMessage, "Skipped:%"),
    like(crmWebhookEvents.errorMessage, "Failed:%"),
  ) as SQL;
}

async function loadFeedRows(db: Db, businessId: string) {
  const [messageRows, clickRows, reviewedRows, problemRows] = await Promise.all(
    [
      db
        .select({
          id: messages.id,
          customerId: messages.customerId,
          channel: messages.channel,
          kind: messages.kind,
          status: messages.status,
          errorMessage: messages.errorMessage,
          sentAt: messages.sentAt,
          customerName: customers.name,
          customerSource: customers.source,
        })
        .from(messages)
        .innerJoin(customers, eq(customers.id, messages.customerId))
        .where(eq(messages.businessId, businessId))
        .orderBy(desc(messages.sentAt))
        .limit(40),
      db
        .select({
          id: customers.id,
          name: customers.name,
          at: customers.linkClickedAt,
        })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, businessId),
            isNotNull(customers.linkClickedAt),
          ),
        )
        .orderBy(desc(customers.linkClickedAt))
        .limit(12),
      db
        .select({
          id: customers.id,
          name: customers.name,
          at: customers.markedReviewedAt,
        })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, businessId),
            isNotNull(customers.markedReviewedAt),
          ),
        )
        .orderBy(desc(customers.markedReviewedAt))
        .limit(8),
      db
        .select({
          id: crmWebhookEvents.id,
          provider: crmWebhookEvents.provider,
          errorMessage: crmWebhookEvents.errorMessage,
          receivedAt: crmWebhookEvents.receivedAt,
        })
        .from(crmWebhookEvents)
        .where(
          and(
            eq(crmWebhookEvents.businessId, businessId),
            webhookProblemCondition(),
            inArray(crmWebhookEvents.provider, ["jobber", "square"]),
          ),
        )
        .orderBy(desc(crmWebhookEvents.receivedAt))
        .limit(8),
    ],
  );

  const clicks: FeedCustomerEvent[] = [];
  for (const row of clickRows) {
    if (row.at) clicks.push({ id: row.id, name: row.name, at: row.at });
  }
  const reviewed: FeedCustomerEvent[] = [];
  for (const row of reviewedRows) {
    if (row.at) reviewed.push({ id: row.id, name: row.name, at: row.at });
  }

  return {
    messageRows: messageRows as FeedMessageRow[],
    clicks,
    reviewed,
    problems: problemRows as FeedProblemRow[],
  };
}

const PROVIDER_NAMES: Record<string, string> = {
  square: "Square",
  jobber: "Jobber",
};

// One Overview feed row for a paid invoice we could not act on. Only rows
// that pass isWebhookProblem should be handed in: "Skipped:" (no request was
// sent) or "Failed:" (we hit an error, the provider retries).
export function webhookFeedItem(row: FeedProblemRow): ActivityItem {
  const raw = (row.errorMessage ?? "").trim();
  const provider = PROVIDER_NAMES[row.provider] ?? "Your invoicing app";
  const match = /^(Skipped|Failed):\s*([\s\S]*)$/.exec(raw);
  const failed = match?.[1] === "Failed";
  const body = (match?.[2] ?? raw).trim();
  const sentence = body.charAt(0).toUpperCase() + body.slice(1);
  const detail = `${provider}: ${excerpt(sentence, 96) ?? "something went wrong"}`;
  return {
    id: `skip-${row.id}`,
    icon: "alert",
    title: failed
      ? "Paid invoice could not be processed"
      : "Paid invoice skipped",
    detail,
    at: row.receivedAt.toISOString(),
    reviewsOnly: false,
    warn: true,
  };
}

// Turns the raw message log into feed rows. A customer with both a phone and
// an email gets two message rows a moment apart; those become one line.
export function messageFeedItems(rows: FeedMessageRow[]): ActivityItem[] {
  type Group = {
    first: FeedMessageRow;
    channels: Set<"sms" | "email">;
    error: string | null;
  };
  const groups: Group[] = [];
  for (const row of rows) {
    const existing = groups.find(
      (group) =>
        group.first.customerId === row.customerId &&
        group.first.kind === row.kind &&
        group.first.status === row.status &&
        Math.abs(group.first.sentAt.getTime() - row.sentAt.getTime()) <=
          2 * 60 * 1000,
    );
    if (existing) {
      existing.channels.add(row.channel);
      if (!existing.error && row.errorMessage)
        existing.error = row.errorMessage;
    } else {
      groups.push({
        first: row,
        channels: new Set([row.channel]),
        error: row.errorMessage,
      });
    }
  }

  return groups.map(({ first, channels, error }): ActivityItem => {
    const name = shortName(first.customerName);
    const both = channels.has("sms") && channels.has("email");
    const verb = both
      ? "texted and emailed"
      : channels.has("sms")
        ? "texted"
        : "emailed";
    const at = first.sentAt.toISOString();

    if (first.status === "failed") {
      const title = both
        ? "Request could not be delivered"
        : channels.has("sms")
          ? "Text could not be delivered"
          : "Email could not be delivered";
      const reason = excerpt(error, 80);
      return {
        id: `msg-${first.id}`,
        icon: "alert",
        title,
        detail: reason ? `${name}: ${reason}` : name,
        at,
        reviewsOnly: false,
        warn: true,
      };
    }

    if (first.kind === "reminder") {
      return {
        id: `msg-${first.id}`,
        icon: "refresh",
        title: "Reminder sent",
        detail: `${name} link not opened after 2 days`,
        at,
        reviewsOnly: false,
        warn: false,
      };
    }

    if (first.kind === "manual") {
      return {
        id: `msg-${first.id}`,
        icon: "mail",
        title: `Review request ${verb} again`,
        detail: `${name} resent by you`,
        at,
        reviewsOnly: false,
        warn: false,
      };
    }

    const detail =
      first.customerSource === "manual"
        ? `${name} added by you`
        : `${name} paid an invoice in ${PROVIDER_NAMES[first.customerSource] ?? "your invoicing app"}`;
    return {
      id: `msg-${first.id}`,
      icon: "mail",
      title: `Review request ${verb}`,
      detail,
      at,
      reviewsOnly: false,
      warn: false,
    };
  });
}

export function reviewFeedItems(
  reviews: GoogleSummary["recentReviews"],
): ActivityItem[] {
  return reviews.map((review) => {
    const name = shortName(review.reviewerName);
    const quote = excerpt(review.comment);
    return {
      id: `google-${review.id}`,
      icon: "star",
      title: `New ${review.starRating}-star Google review`,
      detail: quote ? `${name} “${quote}”` : `${name} left a star rating`,
      at: new Date(review.reviewedAt).toISOString(),
      reviewsOnly: true,
      warn: false,
    };
  });
}

function pickFeed(items: ActivityItem[]): ActivityItem[] {
  const sorted = [...items].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  const keep = new Set<string>();
  for (const item of sorted.slice(0, 12)) keep.add(item.id);
  for (const item of sorted.filter((i) => i.reviewsOnly).slice(0, 12)) {
    keep.add(item.id);
  }
  return sorted.filter((item) => keep.has(item.id));
}

function weeklyValues<T extends { week: string }>(
  keys: string[],
  rows: T[],
  pick: (row: T) => number,
): number[] {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.week, pick(row));
  return keys.map((key) => map.get(key) ?? 0);
}

function deltaPill(
  diff: number,
  suffix: string,
  flatText: string,
): { text: string; tone: "up" | "down" | "flat" } {
  if (diff > 0) return { text: `${formatCount(diff)} ${suffix}`, tone: "up" };
  if (diff < 0)
    return { text: `${formatCount(-diff)} ${suffix}`, tone: "down" };
  return { text: flatText, tone: "flat" };
}

// "12 vs last month". Early in a month the running total cannot fairly be
// compared with a whole month, so a lower number is shown as plain "N last
// month" instead of an alarming down arrow.
export function monthComparisonPill(
  thisMonth: number,
  lastMonth: number,
  dayOfMonth: number,
): NonNullable<StatCardData["pill"]> {
  if (thisMonth === 0 && lastMonth === 0) {
    return { text: "none yet", tone: "muted" };
  }
  if (dayOfMonth <= 10 && thisMonth < lastMonth) {
    return { text: `${formatCount(lastMonth)} last month`, tone: "muted" };
  }
  return deltaPill(
    thisMonth - lastMonth,
    "vs last month",
    "same as last month",
  );
}

export function buildRatingCard(
  summary: GoogleSummary,
  google: GoogleStatus,
): StatCardData {
  const base = {
    id: "rating" as const,
    label: "Google rating",
    unit: null,
    hero: true,
    emptyText: null,
  };

  if (summary.connected && summary.rating !== null) {
    let pill: StatCardData["pill"] = null;
    if (summary.ratingChange90d !== null) {
      const rounded = Math.round(summary.ratingChange90d * 10) / 10;
      pill =
        rounded === 0
          ? { text: "steady for 90 days", tone: "flat" }
          : {
              text: `${Math.abs(rounded).toFixed(1)} in 90 days`,
              tone: rounded > 0 ? "up" : "down",
            };
    } else if (summary.totalReviews !== null) {
      pill = {
        text: `${formatCount(summary.totalReviews)} ${plural(summary.totalReviews, "review")}`,
        tone: "muted",
      };
    }
    const history = summary.ratingHistory.map((point) => point.rating);
    return {
      ...base,
      value: summary.rating.toFixed(1),
      stars: summary.rating,
      pill,
      hint: null,
      tip: null,
      spark: history.length >= 2 ? downsample(history, 30) : null,
      cta: null,
    };
  }

  let cta: NonNullable<StatCardData["cta"]>;
  if (!google.configured) {
    cta = {
      text: "Coming soon, pending Google approval.",
      button: null,
    };
  } else if (google.connected && google.needsReconnect) {
    cta = { text: "Google access was lost.", button: "Reconnect Google" };
  } else if (google.connected && google.awaitingLocation) {
    cta = {
      text: "Pick your business location to start tracking.",
      button: "Choose location",
    };
  } else if (google.connected) {
    cta = {
      text: "Connected. Your rating shows up after the first sync.",
      button: null,
    };
  } else {
    cta = {
      text: "Connect Google to see your real rating and new reviews.",
      button: "Connect Google",
    };
  }
  return {
    ...base,
    value: null,
    stars: null,
    pill: null,
    hint: null,
    tip: null,
    spark: null,
    cta,
  };
}

export type OverviewInputs = {
  summary: GoogleSummary;
  agg: MessageAggregates;
  weeklyMessages: WeeklyMessageRow[];
  linkMonth: { thisMonth: number; lastMonth: number };
  weeklyLinks: Array<{ week: string; opened: number }>;
};

export function buildStatCards(
  shell: DashboardShell,
  input: OverviewInputs,
  keys: string[],
  now: Date,
): StatCardData[] {
  const { summary, agg, weeklyMessages, linkMonth, weeklyLinks } = input;
  const dayOfMonth = zonedParts(now, shell.timezone).day;
  const googleOn = summary.connected;
  const cards: StatCardData[] = [];

  cards.push(buildRatingCard(summary, shell.google));

  // 2. Reviews this month (Google), or review links opened (always true).
  if (googleOn) {
    const weekly = new Map(
      summary.weeklyCounts.map((w) => [w.weekStart, w.count]),
    );
    const spark = sparkTail(keys.map((key) => weekly.get(key) ?? 0));
    cards.push({
      id: "reviews",
      label: "Reviews this month",
      value: formatCount(summary.reviewsThisMonth),
      unit: null,
      stars: null,
      pill: monthComparisonPill(
        summary.reviewsThisMonth,
        summary.reviewsLastMonth,
        dayOfMonth,
      ),
      hint: null,
      tip: "New Google reviews so far this month.",
      emptyText: null,
      spark,
      cta: null,
      hero: false,
    });
  } else {
    const spark = sparkTail(
      weeklyValues(keys, weeklyLinks, (r: { opened: number }) => r.opened),
    );
    cards.push({
      id: "reviews",
      label: "Review links opened",
      value: formatCount(linkMonth.thisMonth),
      unit: null,
      stars: null,
      pill: monthComparisonPill(
        linkMonth.thisMonth,
        linkMonth.lastMonth,
        dayOfMonth,
      ),
      hint: "This month. Connect Google to count new reviews.",
      tip: null,
      emptyText: null,
      spark,
      cta: null,
      hero: false,
    });
  }

  // 3. Requests sent this month.
  const automaticShare =
    agg.requestsMonth > 0
      ? Math.round((agg.autoRequestsMonth / agg.requestsMonth) * 100)
      : null;
  cards.push({
    id: "requests",
    label: "Requests sent",
    value: formatCount(agg.requestsMonth),
    unit: null,
    stars: null,
    pill:
      automaticShare === null
        ? { text: "none sent yet", tone: "muted" }
        : { text: `${automaticShare}% automatic`, tone: "flat" },
    hint: null,
    tip: "Review requests sent this month.",
    emptyText: null,
    spark: sparkTail(
      weeklyValues(keys, weeklyMessages, (r: WeeklyMessageRow) => r.asked),
    ),
    cta: null,
    hero: false,
  });

  // 4. Review rate: share of customers asked in the last 30 days whose
  //    review link was opened, against the 30 days before that.
  if (agg.asked30 > 0) {
    const rate = Math.round((agg.opened30 / agg.asked30) * 100);
    let pill: StatCardData["pill"] = null;
    if (agg.askedPrev30 > 0) {
      const prevRate = Math.round((agg.openedPrev30 / agg.askedPrev30) * 100);
      const diff = rate - prevRate;
      pill = deltaPill(
        diff,
        diff === 1 || diff === -1 ? "pt" : "pts",
        "no change",
      );
    }
    const rateByWeek = keys.slice(-SPARK_WEEKS).map((key) => {
      const row = weeklyMessages.find((r) => r.week === key);
      return row && row.asked > 0
        ? Math.round((row.opened / row.asked) * 100)
        : null;
    });
    const spark = rateByWeek.filter((v): v is number => v !== null);
    cards.push({
      id: "rate",
      label: "Review rate",
      value: String(rate),
      unit: "%",
      stars: null,
      pill,
      hint: null,
      tip: "Share of customers asked in the last 30 days who opened their review link, compared with the 30 days before.",
      emptyText: null,
      spark: spark.length >= 2 ? spark : null,
      cta: null,
      hero: false,
    });
  } else {
    cards.push({
      id: "rate",
      label: "Review rate",
      value: null,
      unit: null,
      stars: null,
      pill: null,
      hint: "Shows once customers have been asked.",
      tip: null,
      emptyText: "No data yet",
      spark: null,
      cta: null,
      hero: false,
    });
  }

  // 5. Reminders sent this month. Reminders go out on the daily run once a
  //    request is 2 days old and unopened.
  cards.push({
    id: "reminders",
    label: "Reminders sent",
    value: formatCount(agg.remindersMonth),
    unit: null,
    stars: null,
    pill: { text: "after 2 days", tone: "flat" },
    hint: null,
    tip: "Sent automatically when a review link is still unopened after 2 days.",
    emptyText: null,
    spark: sparkTail(
      weeklyValues(keys, weeklyMessages, (r: WeeklyMessageRow) => r.reminders),
    ),
    cta: null,
    hero: false,
  });

  return cards;
}

export function buildChart(
  shell: DashboardShell,
  input: OverviewInputs,
  keys: string[],
  now: Date,
): WeeklyChart {
  const ytdWeeks = countYtdWeeks(keys, now, shell.timezone);
  if (input.summary.connected) {
    const map = new Map(
      input.summary.weeklyCounts.map((w) => [w.weekStart, w.count]),
    );
    return {
      source: "google",
      title: "Reviews earned per week",
      weeks: keys.map((weekStart) => ({
        weekStart,
        count: map.get(weekStart) ?? 0,
      })),
      ytdWeeks,
      note: null,
      noteOpensSettings: false,
      unitSingular: "review",
      unitPlural: "reviews",
    };
  }

  const map = new Map(input.weeklyLinks.map((w) => [w.week, w.opened]));
  let note: string;
  if (!shell.google.configured) {
    note =
      "Counting review links opened for now. Reviews customers post on Google will chart here once Google approves our connection.";
  } else if (shell.google.connected && shell.google.awaitingLocation) {
    note =
      "Counting review links opened for now. Choose your Google location in Settings to chart the reviews customers post.";
  } else if (shell.google.connected && shell.google.needsReconnect) {
    note =
      "Counting review links opened for now. Reconnect Google in Settings to chart the reviews customers post.";
  } else if (shell.google.connected) {
    note =
      "Counting review links opened for now. Reviews customers post will chart here after the first Google sync.";
  } else {
    note =
      "Counting review links opened for now. Connect Google to chart the reviews customers actually post.";
  }
  return {
    source: "links",
    title: "Review links opened per week",
    weeks: keys.map((weekStart) => ({
      weekStart,
      count: map.get(weekStart) ?? 0,
    })),
    ytdWeeks,
    note,
    noteOpensSettings: shell.google.configured && !shell.google.connected,
    unitSingular: "review link opened",
    unitPlural: "review links opened",
  };
}

export function buildSubline(
  shell: DashboardShell,
  summary: GoogleSummary,
  requestsLast24h: number,
): { strong: string; rest: string } {
  let strong: string;
  let rest: string;
  if (summary.connected) {
    const n = summary.newSinceYesterday;
    strong =
      n === 0
        ? "No new Google reviews"
        : `${formatCount(n)} new Google ${plural(n, "review")}`;
    rest = " since yesterday.";
  } else {
    const n = requestsLast24h;
    strong =
      n === 0
        ? "No review requests"
        : `${formatCount(n)} review ${plural(n, "request")}`;
    rest = ` went out since yesterday.`;
  }

  const crmRunning = shell.connections.some(
    (connection) =>
      (connection.provider === "square" || connection.provider === "jobber") &&
      !connection.lastErrorMessage,
  );
  if (crmRunning && shell.business.googleReviewUrl) {
    rest += " Everything else is running on its own.";
  }
  return { strong, rest };
}

export async function loadDashboardOverview(
  businessId: string,
  shell: DashboardShell,
  options: { now?: Date } = {},
): Promise<DashboardOverview> {
  const db = getDb();
  const now = options.now ?? new Date();
  const timeZone = shell.timezone;
  const keys = weekKeys(now, timeZone, WEEKS);
  const floor = instantOfDateKey(keys[0] ?? "1970-01-01", timeZone);
  const monthStart = startOfMonthInstant(now, timeZone, 0);
  const lastMonthStart = startOfMonthInstant(now, timeZone, 1);

  const [summary, agg, weeklyMessages, linkMonth, weeklyLinks, feed, scans] =
    await Promise.all([
      getGoogleSummary(businessId, now),
      loadMessageAggregates(db, businessId, now, monthStart),
      loadWeeklyMessages(db, businessId, timeZone, floor),
      loadLinkOpenCounts(db, businessId, monthStart, lastMonthStart),
      loadWeeklyLinkOpens(db, businessId, timeZone, floor),
      loadFeedRows(db, businessId),
      getRecentQrScans(businessId, 12),
    ]);

  const inputs: OverviewInputs = {
    summary,
    agg,
    weeklyMessages,
    linkMonth,
    weeklyLinks,
  };

  const items: ActivityItem[] = [
    ...messageFeedItems(feed.messageRows),
    ...reviewFeedItems(summary.recentReviews.slice(0, 12)),
    ...feed.clicks.map((event): ActivityItem => ({
      id: `click-${event.id}-${event.at.getTime()}`,
      icon: "link",
      title: "Review link opened",
      detail: `${shortName(event.name)} opened the link in the request`,
      at: event.at.toISOString(),
      reviewsOnly: true,
      warn: false,
    })),
    ...feed.reviewed.map((event): ActivityItem => ({
      id: `reviewed-${event.id}-${event.at.getTime()}`,
      icon: "check",
      title: "Marked as reviewed",
      detail: `${shortName(event.name)} marked reviewed by you`,
      at: event.at.toISOString(),
      reviewsOnly: true,
      warn: false,
    })),
    ...scans.map((scan): ActivityItem => ({
      id: `qr-${scan.id}`,
      icon: "qr",
      title: "QR code scanned",
      detail: scan.city ? `${scan.label}, ${scan.city}` : scan.label,
      at: new Date(scan.scannedAt).toISOString(),
      reviewsOnly: false,
      warn: false,
    })),
    ...feed.problems.map(webhookFeedItem),
  ];

  return {
    greeting: greetingFor(now, timeZone, shell.business.contactName),
    dateLine: dateLineFor(now, timeZone),
    weeklyNote: shell.weeklySummaryEnabled
      ? "Weekly summary emailed Mondays"
      : null,
    subline: buildSubline(shell, summary, agg.requestsLast24h),
    stats: buildStatCards(shell, inputs, keys, now),
    chart: buildChart(shell, inputs, keys, now),
    activity: pickFeed(items),
  };
}

// -------------------------------------------------------- server functions

async function sessionBusinessId(): Promise<string | null> {
  if (!isDbConfigured() || !isAuthConfigured()) return null;
  return getSessionBusinessId();
}

// Top bar, chips and setup to-dos. Null when nobody is signed in.
export const getDashboardShell = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardShell | null> => {
    const businessId = await sessionBusinessId();
    if (!businessId) return null;
    return loadDashboardShell(businessId, {
      getGoogleStatus: () => getGoogleStatus(),
    });
  },
);

// The shell plus everything on the Overview tab, in one round trip. Paused
// accounts (access_revoked) get no data at all.
export const getDashboardOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardOverviewResult | null> => {
    const businessId = await sessionBusinessId();
    if (!businessId) return null;
    const now = new Date();
    const shell = await loadDashboardShell(businessId, {
      getGoogleStatus: () => getGoogleStatus(),
      now,
    });
    if (!shell || shell.business.accessRevoked) return null;
    const overview = await loadDashboardOverview(businessId, shell, { now });
    return { shell, overview };
  },
);

const weeklySummarySchema = z.object({ enabled: z.boolean() });

export const setWeeklySummaryEnabled = createServerFn({ method: "POST" })
  .validator((input: unknown) => weeklySummarySchema.parse(input))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; enabled: boolean } | { ok: false; message: string }
    > => {
      const businessId = await sessionBusinessId();
      if (!businessId) return { ok: false, message: "Not signed in." };
      try {
        const db = getDb();
        await db
          .update(businesses)
          .set({ weeklySummaryEnabled: data.enabled })
          .where(eq(businesses.id, businessId));
        return { ok: true, enabled: data.enabled };
      } catch (error) {
        console.error("[dashboard] failed to update weekly summary", error);
        return {
          ok: false,
          message: "Something went wrong. Please try again.",
        };
      }
    },
  );
