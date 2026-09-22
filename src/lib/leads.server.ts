// Cold-outreach lead tracking: backs the outreach map on /admin. Separate
// from reviews.server.ts (which is the CRM for actual paying clients), but
// reuses its DB config check and admin-auth helper for consistency.
//
// Dormant-safe like the rest of the app: every exported function checks
// isDbConfigured() first and returns a friendly result instead of throwing.

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, isDbConfigured } from "./db/client";
import { leads, type Lead } from "./db/schema";
import {
  isResendConfigured,
  leadFollowUpEmailHtml,
  leadFollowUpEmailSubject,
  sendEmail,
} from "./messaging.server";
import { requireAdminBusiness } from "./reviews.server";

const FOLLOW_UP_DELAY_MS = 48 * 60 * 60 * 1000; // 48 hours

// ---- Admin: the outreach map ------------------------------------------

export type LeadSummary = {
  id: string;
  businessName: string;
  email: string;
  industry: string;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  outreachGroup: string | null;
  contactedAt: Date | null;
  respondedAt: Date | null;
  followUpSentAt: Date | null;
  notes: string | null;
};

function toSummary(lead: Lead): LeadSummary {
  return {
    id: lead.id,
    businessName: lead.businessName,
    email: lead.email,
    industry: lead.industry,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    lat: lead.lat,
    lng: lead.lng,
    outreachGroup: lead.outreachGroup,
    contactedAt: lead.contactedAt,
    respondedAt: lead.respondedAt,
    followUpSentAt: lead.followUpSentAt,
    notes: lead.notes,
  };
}

export type LeadsOverviewResult =
  { ok: true; leads: LeadSummary[] } | { ok: false; message: string };

export const getLeadsOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<LeadsOverviewResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }

    try {
      const db = getDb();
      const rows = await db.select().from(leads);
      return { ok: true, leads: rows.map(toSummary) };
    } catch (error) {
      // Most likely the `leads` table/migration hasn't been applied to the
      // database yet -- fail soft (empty map) rather than break the rest of
      // /admin, which has nothing to do with outreach leads.
      console.error("[leads] failed to load leads overview", error);
      return { ok: true, leads: [] };
    }
  },
);

const markRespondedInputSchema = z.object({
  leadId: z.string().trim().min(1),
});

export type MarkRespondedResult = { ok: true } | { ok: false; message: string };

// Manual "mark as responded" button on the map/CRM page -- skips the
// follow-up email for this lead and shows it as responded on the map.
export const markLeadResponded = createServerFn({ method: "POST" })
  .validator((input: unknown) => markRespondedInputSchema.parse(input))
  .handler(async ({ data }): Promise<MarkRespondedResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }

    try {
      const db = getDb();
      await db
        .update(leads)
        .set({ respondedAt: new Date() })
        .where(eq(leads.id, data.leadId));
      return { ok: true };
    } catch (error) {
      console.error("[leads] failed to mark lead responded", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

// ---- Automated 48-hour follow-up (driven by Vercel Cron) ----------------

export type LeadFollowUpRunResult =
  { ok: true; sent: number } | { ok: false; reason: "not_configured" };

// Finds every lead contacted 48+ hours ago with no response recorded and no
// follow-up sent yet, sends one follow-up email, and stamps
// followUpSentAt. Called by the /cron/lead-followups route on a schedule.
export async function sendDueLeadFollowUps(): Promise<LeadFollowUpRunResult> {
  if (!isDbConfigured()) return { ok: false, reason: "not_configured" };

  const db = getDb();
  const cutoff = new Date(Date.now() - FOLLOW_UP_DELAY_MS);

  let due: Lead[];
  try {
    due = await db
      .select()
      .from(leads)
      .where(
        and(
          isNull(leads.followUpSentAt),
          isNull(leads.respondedAt),
          lt(leads.contactedAt, cutoff),
        ),
      );
  } catch (error) {
    // Most likely the `leads` table/migration hasn't been applied yet --
    // ack the cron run with nothing sent rather than erroring, same
    // dormant-safe pattern as the rest of this app.
    console.error("[leads] failed to query due follow-ups", error);
    return { ok: true, sent: 0 };
  }

  let sent = 0;
  for (const lead of due) {
    if (isResendConfigured()) {
      await sendEmail(
        lead.email,
        leadFollowUpEmailSubject(lead.businessName),
        leadFollowUpEmailHtml(lead.businessName),
      );
    }
    await db
      .update(leads)
      .set({ followUpSentAt: new Date() })
      .where(eq(leads.id, lead.id));
    sent += 1;
  }

  return { ok: true, sent };
}

function isCronRequestAuthorized(): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  const auth = getRequestHeader("authorization");
  return auth === `Bearer ${expected}`;
}

export type LeadFollowUpCronResult =
  LeadFollowUpRunResult | { ok: false; reason: "unauthorized" };

export const runLeadFollowUpCron = createServerFn({ method: "GET" }).handler(
  async (): Promise<LeadFollowUpCronResult> => {
    if (!isCronRequestAuthorized()) {
      setResponseStatus(401);
      return { ok: false, reason: "unauthorized" };
    }

    const result = await sendDueLeadFollowUps();
    setResponseStatus(200);
    return result;
  },
);
