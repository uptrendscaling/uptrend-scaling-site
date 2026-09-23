// Lightweight first-party site analytics: pageviews, clicks, and a
// background "still here" heartbeat, sent by the tracking snippet mounted
// once in src/routes/__root.tsx (so it covers every page, including the
// logged-in /app and /admin areas).
//
// One flat event table (analyticsEvents in db/schema.ts) rather than
// separate tables for "sessions"/"visits"/"presence" -- every question the
// admin dashboard asks (how many visits today, who's here right now, which
// businesses are logged in) is just a different time-windowed read over the
// same event log. Dormant-safe like everything else in this app: trackEvent
// silently no-ops when the database isn't configured yet, so the tracking
// snippet never breaks the site before Colby's finished setup.

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { desc, gte } from "drizzle-orm";
import { z } from "zod";

import { getSessionBusinessId } from "./auth.server";
import { getDb, isDbConfigured } from "./db/client";
import { analyticsEvents, businesses } from "./db/schema";
import { requireAdminBusiness } from "./reviews.server";

// "Active now" means an event in the last 3 minutes. The tracking snippet
// heartbeats roughly every 25 seconds while a tab is open and visible, so
// this comfortably survives a handful of missed beats.
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;
// How far back the totals / geo breakdown / average-time-on-site numbers
// look. A small site's event volume stays well within what's comfortable to
// pull into memory and total up here, same style as getAdminOverview below.
const TOTALS_WINDOW_DAYS = 30;

// ---- Recording events (called by the tracking snippet) -------------------

const trackInputSchema = z.object({
  visitorId: z.string().trim().min(1).max(100),
  sessionId: z.string().trim().min(1).max(100),
  kind: z.enum(["pageview", "click", "heartbeat"]),
  path: z.string().trim().min(1).max(300),
  label: z.string().trim().max(200).optional(),
});

export const trackEvent = createServerFn({ method: "POST" })
  .validator((input: unknown) => trackInputSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!isDbConfigured()) return { ok: false };
    try {
      const db = getDb();
      // Ties the event to a business when the visitor happens to be logged
      // in at the moment -- this is the entire mechanism behind "who's
      // logged in right now" below, no separate presence tracking needed.
      const businessId = await getSessionBusinessId();

      // Vercel's own IP geolocation headers -- no third-party service, and
      // we never store the visitor's raw IP address itself. City is
      // RFC3986-encoded by Vercel, so it needs decoding back to plain text.
      const rawCity = getRequestHeader("x-vercel-ip-city");
      const city = rawCity ? decodeURIComponent(rawCity) : null;
      const region = getRequestHeader("x-vercel-ip-country-region") ?? null;
      const country = getRequestHeader("x-vercel-ip-country") ?? null;

      await db.insert(analyticsEvents).values({
        visitorId: data.visitorId,
        sessionId: data.sessionId,
        kind: data.kind,
        path: data.path,
        label: data.label ?? null,
        city,
        region,
        country,
        businessId,
      });
      return { ok: true };
    } catch (error) {
      // Never let a tracking hiccup show up to a visitor -- just log it.
      console.error("[analytics] failed to record event", error);
      return { ok: false };
    }
  });

// ---- Admin: the analytics panel on /admin ---------------------------------

export type ActiveVisitor = {
  sessionId: string;
  path: string;
  businessId: string | null;
  businessName: string | null; // set only when this visitor is logged in
  city: string | null;
  region: string | null;
};

export type GeoBreakdownRow = { label: string; visits: number };

export type AnalyticsOverview = {
  visitsToday: number;
  visitsThisWeek: number;
  clicksThisWeek: number;
  avgSessionMinutes: number;
  activeNow: ActiveVisitor[];
  loggedInBusinesses: { id: string; businessName: string; path: string }[];
  topLocations: GeoBreakdownRow[];
};

export type AnalyticsOverviewResult =
  { ok: true; overview: AnalyticsOverview } | { ok: false; message: string };

export const getAdminAnalyticsOverview = createServerFn({
  method: "GET",
}).handler(async (): Promise<AnalyticsOverviewResult> => {
  if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
  try {
    await requireAdminBusiness();
  } catch {
    return { ok: false, message: "Not authorized." };
  }

  const db = getDb();
  const now = Date.now();
  const activeSince = new Date(now - ACTIVE_WINDOW_MS);
  const windowStart = new Date(now - TOTALS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [recentEvents, allBusinesses] = await Promise.all([
    db
      .select()
      .from(analyticsEvents)
      .where(gte(analyticsEvents.occurredAt, windowStart))
      .orderBy(desc(analyticsEvents.occurredAt)),
    db.select().from(businesses),
  ]);
  const businessNameById = new Map(
    allBusinesses.map((b) => [b.id, b.businessName]),
  );

  const pageviews = recentEvents.filter((e) => e.kind === "pageview");
  const visitsToday = new Set(
    pageviews.filter((e) => e.occurredAt >= todayStart).map((e) => e.sessionId),
  ).size;
  const weekPageviews = pageviews.filter((e) => e.occurredAt >= weekStart);
  const visitsThisWeek = new Set(weekPageviews.map((e) => e.sessionId)).size;
  const clicksThisWeek = recentEvents.filter(
    (e) => e.kind === "click" && e.occurredAt >= weekStart,
  ).length;

  // Average time on site, over the last week: a session's length is its
  // last event minus its first. A session that only ever sent one event
  // (someone who bounced immediately) counts as 0 minutes, not excluded --
  // that's what "average session length" normally means.
  const weekEvents = recentEvents.filter((e) => e.occurredAt >= weekStart);
  const spanBySession = new Map<string, { min: Date; max: Date }>();
  for (const event of weekEvents) {
    const span = spanBySession.get(event.sessionId);
    if (!span) {
      spanBySession.set(event.sessionId, {
        min: event.occurredAt,
        max: event.occurredAt,
      });
    } else {
      if (event.occurredAt < span.min) span.min = event.occurredAt;
      if (event.occurredAt > span.max) span.max = event.occurredAt;
    }
  }
  const sessionMinutes = [...spanBySession.values()].map(
    (span) => (span.max.getTime() - span.min.getTime()) / 60000,
  );
  const avgSessionMinutes =
    sessionMinutes.length > 0
      ? Math.round(
          (sessionMinutes.reduce((a, b) => a + b, 0) / sessionMinutes.length) *
            10,
        ) / 10
      : 0;

  // Currently active: the most recent event for every session seen in the
  // last few minutes. recentEvents is already newest-first, so the first
  // time a session shows up here is its latest event.
  const activeEvents = recentEvents.filter((e) => e.occurredAt >= activeSince);
  const latestBySession = new Map<string, (typeof activeEvents)[number]>();
  for (const event of activeEvents) {
    if (!latestBySession.has(event.sessionId)) {
      latestBySession.set(event.sessionId, event);
    }
  }
  const activeNow: ActiveVisitor[] = [...latestBySession.values()]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((e) => ({
      sessionId: e.sessionId,
      path: e.path,
      businessId: e.businessId,
      businessName: e.businessId
        ? (businessNameById.get(e.businessId) ?? null)
        : null,
      city: e.city,
      region: e.region,
    }));

  const loggedInByBusinessId = new Map<
    string,
    { id: string; businessName: string; path: string }
  >();
  for (const visitor of activeNow) {
    if (visitor.businessId && visitor.businessName) {
      loggedInByBusinessId.set(visitor.businessId, {
        id: visitor.businessId,
        businessName: visitor.businessName,
        path: visitor.path,
      });
    }
  }

  const locationCounts = new Map<string, number>();
  for (const event of weekPageviews) {
    if (!event.city && !event.region) continue;
    const label = [event.city, event.region].filter(Boolean).join(", ");
    locationCounts.set(label, (locationCounts.get(label) ?? 0) + 1);
  }
  const topLocations: GeoBreakdownRow[] = [...locationCounts.entries()]
    .map(([label, visits]) => ({ label, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8);

  return {
    ok: true,
    overview: {
      visitsToday,
      visitsThisWeek,
      clicksThisWeek,
      avgSessionMinutes,
      activeNow,
      loggedInBusinesses: [...loggedInByBusinessId.values()],
      topLocations,
    },
  };
});
