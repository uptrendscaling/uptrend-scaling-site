// Shapes shared by src/lib/dashboard.server.ts (which builds them) and the
// dashboard components in this folder (which render them). Types and tiny
// constants only, so it is safe to import from both server and browser code.

import type { GoogleStatus } from "../../lib/dashboard-types";
import type { ConnectionSummary } from "../../lib/crm/connections.server";
import type { PublicBusiness } from "../../lib/reviews.server";

// ------------------------------------------------------------------- tabs

export const DASHBOARD_TABS = [
  "overview",
  "customers",
  "requests",
  "qr",
  "reports",
  "settings",
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

// The tabs shown in the top bar, in order. "settings" is a view, not a tab.
export const NAV_TABS: ReadonlyArray<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "customers", label: "Customers" },
  { id: "requests", label: "Requests" },
  { id: "qr", label: "QR codes" },
  { id: "reports", label: "Reports" },
];

// ------------------------------------------------------------------ shell

export type ChipTone = "ok" | "warn" | "off";
export type ChipKey =
  "quickbooks" | "square" | "jobber" | "zapier" | "google" | "sms" | "email";

// One small status chip under the top bar, e.g. "Square synced 2m ago".
export type IntegrationChip = {
  key: ChipKey;
  label: string;
  // The muted words after the label when `since` is null, e.g. "on".
  detail: string;
  tone: ChipTone;
  // When set the chip reads `${label} ${sincePrefix} ${relative(since)} ago`.
  since: string | null; // ISO string
  sincePrefix: string | null; // "synced", "last invoice"
  // Clicking the chip opens Settings.
  opensSettings: boolean;
};

export type SetupTodoId =
  | "review-link"
  | "reconnect-quickbooks"
  | "reconnect-square"
  | "reconnect-jobber"
  | "reconnect-google"
  | "crm"
  | "google"
  | "google-location"
  | "sms";

export type SetupTodo = {
  id: SetupTodoId;
  title: string;
  detail: string;
  // Blocking items stop automation (the top bar pill turns from LIVE to SETUP).
  blocking: boolean;
};

export type MessagingStatus = {
  sms: "on" | "pending" | "off";
  email: "on" | "off";
};

export type DashboardShell = {
  business: PublicBusiness;
  // ISO time the server built this. The browser formats "2m ago" against it
  // first so server and browser markup agree, then against its own clock.
  generatedAt: string;
  timezone: string;
  weeklySummaryEnabled: boolean;
  // Ask the same customer at most once every 90 days (Settings switch).
  repeatGuardEnabled: boolean;
  chips: IntegrationChip[];
  todos: SetupTodo[];
  // True when nothing is broken: access active, review link set, no
  // connection errors.
  live: boolean;
  connections: ConnectionSummary[];
  // Show the QuickBooks connector to this business (keys are in, and with
  // test keys only admin accounts see it).
  quickbooksOffered: boolean;
  google: GoogleStatus;
  messaging: MessagingStatus;
};

// -------------------------------------------------------------- overview

export type PillTone = "up" | "down" | "flat" | "muted";

export type StatCardData = {
  id: "rating" | "reviews" | "requests" | "rate" | "reminders";
  // Shown uppercase in the tiny mono label.
  label: string;
  // The big number. Null when there is no number to show (see emptyText, cta).
  value: string | null;
  // Small muted unit after the number, e.g. "%".
  unit: string | null;
  // 0 to 5, only for the rating card; draws five stars.
  stars: number | null;
  pill: { text: string; tone: PillTone } | null;
  // Muted caption under the pill (definitions, "connect Google" hints).
  hint: string | null;
  // Tooltip only (a longer definition that would not fit under the number).
  tip: string | null;
  // Text shown instead of the number when there is no data yet.
  emptyText: string | null;
  // Values for the little line at the right of the card.
  spark: number[] | null;
  // Rating card only: when Google is not connected the card becomes a call to
  // action that opens Settings instead of showing a number.
  cta: { text: string; button: string | null } | null;
  hero: boolean;
};

export type WeeklyChart = {
  // "google" counts real Google reviews; "links" counts review links opened.
  source: "google" | "links";
  title: string;
  // Last 52 weeks, oldest first. weekStart is that week's Monday (YYYY-MM-DD)
  // in the business's timezone.
  weeks: Array<{ weekStart: string; count: number }>;
  // How many of the newest weeks fall in the current calendar year (for YTD).
  ytdWeeks: number;
  // Small note under the chart, e.g. an offer to connect Google.
  note: string | null;
  noteOpensSettings: boolean;
  // Word for one unit in tooltips: "review" or "link opened".
  unitSingular: string;
  unitPlural: string;
};

export type ActivityIcon =
  "star" | "mail" | "refresh" | "qr" | "alert" | "link" | "check";

export type ActivityItem = {
  id: string;
  icon: ActivityIcon;
  title: string;
  detail: string;
  at: string; // ISO string
  // Shown under the "Reviews" toggle: Google reviews, review link opens and
  // customers marked as reviewed.
  reviewsOnly: boolean;
  warn: boolean;
};

export type DashboardOverview = {
  greeting: string; // "Good morning, Mike."
  dateLine: string; // "Tuesday, Oct 6"
  weeklyNote: string | null; // "Weekly summary emailed Mondays"
  subline: { strong: string; rest: string };
  stats: StatCardData[];
  chart: WeeklyChart;
  activity: ActivityItem[];
};

export type DashboardOverviewResult = {
  shell: DashboardShell;
  overview: DashboardOverview;
};

// ------------------------------------------------------------- tab props

// What /app hands to every tab component that fetches its own data
// (RequestsTab, QrTab, ReportsTab). CustomersTab is the exception: it takes
// the customer list from the page loader.
export type DashboardTabProps = {
  business: PublicBusiness;
  shell: DashboardShell;
  // Re-runs the /app loader: refreshes the top bar chips, the setup to-do
  // count and any loader data after this tab changed something.
  refresh: () => void;
};
