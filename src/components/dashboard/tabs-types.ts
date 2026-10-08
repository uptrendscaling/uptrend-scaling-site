// Shapes shared by src/lib/dashboard-tabs.server.ts (which builds them) and the
// Requests and Reports tabs (which render them). Types and tiny constants
// only, so it is safe to import from both server and browser code.

import type { CustomerSource } from "../../lib/crm/providers";
import type { PillTone } from "./types";

// ---------------------------------------------------------------- requests

export type RequestChannel = "sms" | "email";
// "initial" is the first request, "reminder" the automatic nudge, "manual" a
// resend the owner triggered from the Customers tab.
export type RequestKind = "initial" | "reminder" | "manual";
export type RequestStatus = "sent" | "failed";
export type RequestSource = CustomerSource;

export type RequestsLogFilters = {
  channel?: RequestChannel;
  kind?: RequestKind;
  status?: RequestStatus;
};

export type RequestsLogInput = RequestsLogFilters & {
  // Opaque value returned as nextCursor by the previous page.
  cursor?: string;
};

export type RequestLogRow = {
  id: string;
  sentAt: string; // ISO string
  customerName: string;
  // The phone number (for a text) or email (for an email), partly hidden.
  contact: string | null;
  channel: RequestChannel;
  kind: RequestKind;
  source: RequestSource;
  status: RequestStatus;
  // Failed messages only: what went wrong in plain words, and the sending
  // service's own words underneath.
  problem: string | null;
  providerText: string | null;
};

// A paid invoice we could not act on (a crm_webhook_events row whose message
// starts with "Skipped:" or "Failed:").
export type AttentionItem = {
  id: string;
  at: string; // ISO string
  // Display name of the connector, e.g. "Square".
  provider: string;
  kind: "skipped" | "failed";
  // "Maria G." when the invoice told us who paid, otherwise null.
  customer: string | null;
  // What happened, in a sentence.
  headline: string;
  // An extra remark (the original wording of an error), or null.
  detail: string | null;
  // What the owner can do about it.
  fix: string;
  // The button to show with the fix, or null for none.
  action: "settings" | "customers" | null;
};

export type RequestsLogPage = {
  rows: RequestLogRow[];
  nextCursor: string | null;
  // Present on the first page only (no cursor).
  total?: number;
  attention?: { items: AttentionItem[]; more: number };
};

export type RequestsLogResult =
  ({ ok: true } & RequestsLogPage) | { ok: false; message: string };

// ----------------------------------------------------------------- reports

export type ReportMetricKey =
  | "requests"
  | "reminders"
  | "linksOpened"
  | "reviewed"
  | "qrScans"
  | "googleReviews";

export type ReportWeek = {
  weekStart: string; // that week's Monday, YYYY-MM-DD, in the business timezone
  requests: number; // customers with a first request sent
  reminders: number; // customers who got a reminder
  linksOpened: number; // customers who opened their review link
  reviewed: number; // customers marked as reviewed
  qrScans: number;
  // Reviews posted on Google. Null when Google data does not exist for this
  // business, so the column is left out instead of showing made-up zeros.
  googleReviews: number | null;
};

export type ReportComparison = {
  key: ReportMetricKey;
  label: string;
  thisMonth: number;
  lastMonth: number;
  pill: { text: string; tone: PillTone };
};

export type ReportsData = {
  generatedAt: string; // ISO string
  timezone: string;
  thisMonthLabel: string; // "October"
  lastMonthLabel: string; // "September"
  // Twelve weeks, newest first.
  weeks: ReportWeek[];
  comparison: ReportComparison[];
  // True when real Google review data is stored, so the Google column shows.
  hasGoogle: boolean;
  // False for a brand new account: nothing in the weeks or the months.
  hasAnyData: boolean;
};

export type ReportsResult =
  { ok: true; data: ReportsData } | { ok: false; message: string };
