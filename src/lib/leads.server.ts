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
import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import {
  runAffiliateRecruiting,
  sendCheckins,
  type AffiliateRecruitingResult,
} from "./affiliate-outreach.server";
import {
  isColdMailConfigured,
  runColdMailSlot,
  type ColdMailRunResult,
} from "./cold-mail.server";
import { getDb, isDbConfigured } from "./db/client";
import { leads, type Lead } from "./db/schema";
import {
  leadFollowUpEmail,
  sendEmailBatch,
  sendEmailPlain,
  type OutreachEmail,
} from "./messaging.server";
import { requireAdminBusiness } from "./reviews.server";

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
  | { ok: true; sent: number; failed: number }
  | { ok: false; reason: "not_configured" };

// Safety limits. Never more than 60 follow-ups in one run (anything left
// over is picked up by tomorrow's run), 50 emails per Resend request, and a
// pause between requests so we stay well under Resend's 2 requests/second.
const FOLLOW_UP_RUN_LIMIT = 60;
const FOLLOW_UP_CHUNK_SIZE = 50;
const FOLLOW_UP_PAUSE_MS = 1000;
// Written into leads.notes when Resend permanently rejects an address, so
// the same bad address isn't retried (and doesn't hog a slot) every day.
const FOLLOW_UP_FAILED_NOTE_PREFIX = "Follow-up not sent:";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A lead row plus the owner's name. owner_name lives in the database but is
// not declared in the Drizzle schema, so it is selected by name here instead
// of editing the schema file.
type DueLead = Lead & { ownerName: string | null };

function followUpEmailFor(lead: DueLead): OutreachEmail {
  const email = leadFollowUpEmail({
    id: lead.id,
    businessName: lead.businessName,
    ownerName: lead.ownerName,
    contactedAt: lead.contactedAt,
  });
  return {
    to: lead.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
    unsubscribeUrl: email.unsubscribeUrl,
  };
}

// Finds every lead whose first email went out at least two Phoenix calendar
// days ago with no response recorded and no follow-up sent yet, sends one
// follow-up, and stamps followUpSentAt ONLY for emails Resend actually
// accepted. Called by the /cron/lead-followups route on a schedule.
//
// Uses Phoenix calendar dates, not a strict 48-hour timestamp check, so a
// lead emailed late on a given day is still picked up two days later.
export async function sendDueLeadFollowUps(): Promise<LeadFollowUpRunResult> {
  if (!isDbConfigured() || !process.env["RESEND_API_KEY"]) {
    return { ok: false, reason: "not_configured" };
  }

  const db = getDb();

  let due: DueLead[];
  try {
    due = await db
      .select({
        ...getTableColumns(leads),
        ownerName: sql<string | null>`"leads"."owner_name"`,
      })
      .from(leads)
      .where(
        and(
          isNull(leads.followUpSentAt),
          isNull(leads.respondedAt),
          isNotNull(leads.contactedAt),
          sql`(${leads.contactedAt} at time zone 'America/Phoenix')::date <= (now() at time zone 'America/Phoenix')::date - 2`,
          sql`coalesce(${leads.notes}, '') not like ${FOLLOW_UP_FAILED_NOTE_PREFIX + "%"}`,
          // Anyone who clicked Unsubscribe is never emailed again.
          sql`"leads"."unsubscribed_at" is null`,
        ),
      )
      .orderBy(asc(leads.contactedAt))
      .limit(FOLLOW_UP_RUN_LIMIT);
  } catch (error) {
    // Most likely the `leads` table/migration hasn't been applied yet --
    // ack the cron run with nothing sent rather than erroring, same
    // dormant-safe pattern as the rest of this app.
    console.error("[leads] failed to query due follow-ups", error);
    return { ok: true, sent: 0, failed: 0 };
  }

  async function markFollowedUp(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(leads)
      .set({ followUpSentAt: new Date() })
      .where(inArray(leads.id, ids));
  }

  let sent = 0;
  let failed = 0;

  for (let start = 0; start < due.length; start += FOLLOW_UP_CHUNK_SIZE) {
    const chunk = due.slice(start, start + FOLLOW_UP_CHUNK_SIZE);
    if (start > 0) await sleep(FOLLOW_UP_PAUSE_MS);

    const emails = chunk.map(followUpEmailFor);
    let result = await sendEmailBatch(emails);
    if (!result.ok && result.retryable) {
      // Rate limited or a brief Resend hiccup: wait once, try once more.
      await sleep(result.retryAfterMs ?? 2000);
      result = await sendEmailBatch(emails);
    }

    if (result.ok) {
      await markFollowedUp(chunk.map((lead) => lead.id));
      sent += chunk.length;
      continue;
    }

    if (result.status === 400 || result.status === 422) {
      // Resend rejects the whole batch if one address is invalid. Send this
      // chunk one at a time so the good addresses still go out.
      for (const lead of chunk) {
        await sleep(FOLLOW_UP_PAUSE_MS);
        const single = await sendEmailPlain(followUpEmailFor(lead));
        if (single.ok) {
          await markFollowedUp([lead.id]);
          sent += 1;
        } else if (single.status === 400 || single.status === 422) {
          failed += 1;
          await db
            .update(leads)
            .set({
              notes: `${FOLLOW_UP_FAILED_NOTE_PREFIX} ${single.error}`.slice(
                0,
                500,
              ),
            })
            .where(eq(leads.id, lead.id));
        } else {
          // Rate limit or outage mid-chunk: stop here and leave the rest
          // unmarked so tomorrow's run picks them up.
          console.error("[leads] follow-up run stopped early", single.error);
          return { ok: true, sent, failed: failed + 1 };
        }
      }
      continue;
    }

    // Anything else (bad API key, persistent rate limit, outage): do not
    // mark anyone as followed up, stop, and let the next run try again.
    console.error(
      "[leads] follow-up batch failed",
      result.status,
      result.error,
    );
    return { ok: true, sent, failed: failed + chunk.length };
  }

  console.log(`[leads] follow-up run finished: ${sent} sent, ${failed} failed`);
  return { ok: true, sent, failed };
}

// ---- Unsubscribe ----------------------------------------------------------
// Backs the /unsubscribe page that the Unsubscribe button in every outreach
// email links to. Public on purpose (no login): the link carries the lead's
// unguessable id, or the person types their own email address. Always answers
// "ok" for a well-formed request, whether or not a lead matched, so it can't
// be used to find out which addresses are in our list. The follow-up job skips
// every lead that has unsubscribed_at set. (That column is selected by name,
// like owner_name, so db/schema.ts is untouched.)

const unsubscribeInputSchema = z
  .object({
    leadId: z.string().trim().uuid().optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .refine((input) => Boolean(input.leadId || input.email), {
    message: "Missing lead or email.",
  });

export type UnsubscribeResult = { ok: true } | { ok: false; message: string };

export const unsubscribeLead = createServerFn({ method: "POST" })
  .validator((input: unknown) => unsubscribeInputSchema.parse(input))
  .handler(async ({ data }): Promise<UnsubscribeResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      const db = getDb();
      // The same link and page serve cold leads and affiliate prospects
      // (both ids are unguessable uuids), so both lists are updated.
      if (data.leadId) {
        await db.execute(
          sql`update leads set unsubscribed_at = coalesce(unsubscribed_at, now()) where id = ${data.leadId}::uuid`,
        );
        await db.execute(
          sql`update affiliate_prospects set unsubscribed_at = coalesce(unsubscribed_at, now()) where id = ${data.leadId}::uuid`,
        );
      } else if (data.email) {
        await db.execute(
          sql`update leads set unsubscribed_at = coalesce(unsubscribed_at, now()) where lower(email) = ${data.email}`,
        );
        await db.execute(
          sql`update affiliate_prospects set unsubscribed_at = coalesce(unsubscribed_at, now()) where email = ${data.email}`,
        );
      }
      return { ok: true };
    } catch (error) {
      console.error("[leads] failed to record unsubscribe", error);
      return {
        ok: false,
        message:
          "Something went wrong. Please try again, or just reply to the email and we'll remove you.",
      };
    }
  });

function isCronRequestAuthorized(): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  const auth = getRequestHeader("authorization");
  return auth === `Bearer ${expected}`;
}

export type LeadFollowUpCronResult =
  | (LeadFollowUpRunResult & { affiliate?: AffiliateRecruitingResult })
  | { ok: true; coldMail: ColdMailRunResult; checkins: number }
  | { ok: true; skipped: "not_this_slot" }
  | { ok: false; reason: "unauthorized" };

// The first of the day's runs (14:00 UTC, 7 AM Phoenix). The old Resend path
// only runs in this one; the extra runs exist to spread the Zoho cold email
// across the day.
const FIRST_SLOT_HOUR_UTC = 14;

export const runLeadFollowUpCron = createServerFn({ method: "GET" }).handler(
  async (): Promise<LeadFollowUpCronResult> => {
    if (!isCronRequestAuthorized()) {
      setResponseStatus(401);
      return { ok: false, reason: "unauthorized" };
    }

    // Cold email from the Zoho mailboxes, once they're set up in Vercel.
    // Replaces the Resend lead follow-ups and affiliate invites entirely.
    if (isColdMailConfigured()) {
      const coldMail = await runColdMailSlot();
      // Partner check-ins go to people who signed up, so they stay on Resend.
      let checkins = 0;
      if (new Date().getUTCHours() === FIRST_SLOT_HOUR_UTC) {
        checkins = await sendCheckins().catch((error) => {
          console.error("[leads] partner check-ins failed", error);
          return 0;
        });
      }
      setResponseStatus(200);
      return { ok: true, coldMail, checkins };
    }

    // Old path (Resend), once a day only.
    if (new Date().getUTCHours() !== FIRST_SLOT_HOUR_UTC) {
      setResponseStatus(200);
      return { ok: true, skipped: "not_this_slot" };
    }
    const result = await sendDueLeadFollowUps();
    // Affiliate invites, follow-ups and partner check-ins share Resend's
    // free-plan limit of 100 emails a day with everything else, so they only
    // get what's left after the lead follow-ups, keeping about 10 spare for
    // the site's own emails (welcome emails, review requests, alerts).
    const usedByLeads = result.ok ? result.sent + result.failed : 0;
    const affiliate = await runAffiliateRecruiting(
      Math.max(0, 90 - usedByLeads),
    );
    setResponseStatus(200);
    return { ...result, affiliate };
  },
);
