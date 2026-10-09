// Affiliate recruiting, run once a day by the /cron/lead-followups job right
// after the cold-lead follow-ups. Three jobs:
//
// 1. Invites: up to AFFILIATE_INVITES_PER_DAY new people from
//    affiliate_prospects get a short, personal invite to the partner program.
// 2. Follow-ups: anyone invited AFFILIATE_FOLLOW_UP_AFTER_DAYS ago who hasn't
//    replied, applied or unsubscribed gets one short follow-up. Never more.
// 3. Check-ins: approved affiliates get a "here's the easiest first step"
//    email 3 days after approval, and a "need anything?" email at 10 days if
//    they haven't referred anyone yet.
//
// Everything shares Resend's free-plan limit of 100 emails a day with the
// site's other emails, so the caller passes in how many sends are left today
// and this never goes over it. Invites and follow-ups go out from the same
// sender as the cold emails, with replies going to hello@.
//
// Dormant-safe like the rest of the app: never throws, and does nothing when
// the database or Resend isn't configured.

import { createServerFn } from "@tanstack/react-start";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, isDbConfigured } from "./db/client";
import {
  affiliateProspects,
  affiliates,
  businesses,
  type AffiliateProspect,
} from "./db/schema";
import {
  button,
  card,
  detailRows,
  emailShell,
  escapeHtml,
  mutedPara,
  para,
  signoff,
  steps,
} from "./email-layout";
import {
  isResendConfigured,
  leadUnsubscribeUrl,
  sendEmail,
  sendEmailBatch,
  sendEmailPlain,
  type OutreachEmail,
} from "./messaging.server";
import { requireAdminBusiness } from "./reviews.server";
import { CANONICAL_SITE_URL } from "./site";

export const AFFILIATE_INVITES_PER_DAY = 15;
export const AFFILIATE_FOLLOW_UP_AFTER_DAYS = 5;
// Hard ceiling for this whole job in one day, whatever budget is passed in.
const AFFILIATE_MAX_SENDS_PER_DAY = 30;
const NOT_SENT_NOTE_PREFIX = "Not sent:";
const PAUSE_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Email copy -------------------------------------------------------------

type Kind = AffiliateProspect["kind"];

function whoTheyServe(kind: Kind): string {
  if (kind === "agency") return "your clients";
  if (kind === "community") return "your members";
  if (kind === "creator") return "your audience";
  return "the owners you work with";
}

function introLine(
  p: Pick<AffiliateProspect, "kind" | "company" | "audience">,
): string {
  if (p.kind === "agency")
    return `I came across ${p.company} while looking for agencies that help ${p.audience} grow.`;
  if (p.kind === "community")
    return `I came across ${p.company} while looking for groups that bring ${p.audience} together.`;
  if (p.kind === "creator")
    return `I came across ${p.company} while looking for shows and channels that help ${p.audience} grow.`;
  return `I came across ${p.company} while looking for people who help ${p.audience} grow.`;
}

function programUrl(campaign: string): string {
  return `${CANONICAL_SITE_URL}/affiliates?utm_source=partner_invite&utm_medium=email&utm_campaign=${campaign}`;
}

function unsubscribeSection(url: string) {
  return {
    html: `${mutedPara("Not interested in hearing from us?", 10)}${button("Unsubscribe", url, "secondary")}`,
    align: "center" as const,
    top: 18,
    bottom: 22,
  };
}

export function inviteSubject(company: string): string {
  const name = company.length > 40 ? "you" : company;
  return `Partner idea for ${name}`;
}

export const FOLLOW_UP_SUBJECT = "Following up: our partner program";

export type ProspectEmailInput = Pick<
  AffiliateProspect,
  "id" | "kind" | "firstName" | "company" | "audience"
>;

export function renderInviteEmail(p: ProspectEmailInput): OutreachEmail & {
  html: string;
} {
  const unsubscribeUrl = leadUnsubscribeUrl(p.id);
  const subject = inviteSubject(p.company);
  const who = whoTheyServe(p.kind);
  const lines = {
    intro: introLine(p),
    what: "I run UpTrend Scaling. When a business gets paid for a job, we automatically text and email that customer a one-tap Google review link, plus one reminder if they forget. It connects to Square and Jobber, so there is nothing to type in.",
    offer: `We just opened a partner program, and I think it's a good fit for ${who}. You earn 25% of every payment from each business you send us, for as long as they stay a customer.`,
    cta: "Signing up takes about two minutes and costs nothing. Or just reply with any questions.",
    ps: 'P.S. Not a fit? Reply "no thanks" and I won\'t email again.',
  };
  const examples = [
    {
      label: "1 business, $100 plan",
      value: "$25 a month to you, every month they stay",
    },
    { label: "10 businesses", value: "$250 a month" },
    {
      label: "What they get",
      value: "No $20 setup fee, plus a 7-day free trial",
    },
  ];

  const html = emailShell({
    subject,
    preheader:
      "25% of every payment, for as long as each business you refer stays.",
    tagline: "PARTNER PROGRAM",
    sections: [
      { html: para(`Hi ${p.firstName},`), top: 30 },
      { html: para(lines.intro) },
      { html: para(lines.what) },
      { html: para(lines.offer) },
      {
        html: card("What it can look like", detailRows(examples)),
        top: 4,
        bottom: 16,
      },
      { html: para(lines.cta) },
      {
        html: button("See the partner program", programUrl("invite")),
        top: 4,
        bottom: 22,
      },
      {
        html: signoff("Colby", "UpTrend Scaling | uptrendscaling.com"),
        bottom: 4,
      },
      { html: mutedPara(lines.ps, 0), top: 12, bottom: 20 },
      unsubscribeSection(unsubscribeUrl),
    ],
    footerLines: [
      "UpTrend Scaling",
      "Google reviews on autopilot for local businesses",
    ],
  });

  const text = [
    `Hi ${p.firstName},`,
    "",
    lines.intro,
    "",
    lines.what,
    "",
    lines.offer,
    "",
    ...examples.map((e) => `${e.label}: ${e.value}`),
    "",
    lines.cta,
    programUrl("invite"),
    "",
    "Colby",
    "UpTrend Scaling | uptrendscaling.com",
    "",
    lines.ps,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  return { to: "", subject, html, text, unsubscribeUrl };
}

export function renderFollowUpEmail(p: ProspectEmailInput): OutreachEmail & {
  html: string;
} {
  const unsubscribeUrl = leadUnsubscribeUrl(p.id);
  const lines = {
    intro:
      "Quick follow up on my note about the UpTrend Scaling partner program.",
    short: `The short version: you earn 25% of every payment from each business you send us, for as long as they stay a customer, and the businesses you send skip our $20 setup fee. Most of ${whoTheyServe(p.kind)} could use more Google reviews, and this gets them without anyone having to ask.`,
    ask: "Want me to send a short walkthrough of how it works? Just reply and I will.",
    ps: "P.S. If this isn't a fit, reply \"no thanks\" and I won't email you again.",
  };
  const html = emailShell({
    subject: FOLLOW_UP_SUBJECT,
    preheader: "25% of every payment, for as long as they stay. Quick recap.",
    tagline: "PARTNER PROGRAM",
    sections: [
      { html: para(`Hi ${p.firstName},`), top: 30 },
      { html: para(lines.intro) },
      { html: para(lines.short) },
      { html: para(lines.ask) },
      {
        html: button("See the partner program", programUrl("followup")),
        top: 4,
        bottom: 22,
      },
      { html: signoff("Colby", "UpTrend Scaling"), bottom: 4 },
      { html: mutedPara(lines.ps, 0), top: 12, bottom: 20 },
      unsubscribeSection(unsubscribeUrl),
    ],
    footerLines: [
      "UpTrend Scaling",
      "Google reviews on autopilot for local businesses",
    ],
  });
  const text = [
    `Hi ${p.firstName},`,
    "",
    lines.intro,
    "",
    lines.short,
    "",
    lines.ask,
    programUrl("followup"),
    "",
    "Colby",
    "UpTrend Scaling",
    "",
    lines.ps,
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
  return { to: "", subject: FOLLOW_UP_SUBJECT, html, text, unsubscribeUrl };
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function checkin1Html(name: string, code: string): string {
  const link = `${CANONICAL_SITE_URL}/?ref=${code}`;
  return emailShell({
    subject: "The easiest way to get your first referral",
    preheader: "One short email to a few people you already know.",
    tagline: "PARTNER PROGRAM",
    sections: [
      { html: para(`Hi ${firstNameOf(name)},`), top: 30 },
      {
        html: para(
          "Thanks again for joining. The partners who earn first usually start small, so here's the quickest path:",
        ),
      },
      {
        html: card(
          null,
          steps([
            {
              title: "Pick 3 to 5 business owners you already know",
              detail:
                "Clients, friends, anyone who runs a local service business and wants more Google reviews.",
            },
            {
              title: "Send them the ready-made email from your kit",
              detail:
                "It's short and already has the right wording. Swap in your link and hit send.",
            },
            {
              title: "Say you earn a commission",
              detail:
                'One line is enough: "I earn a commission if you sign up through my link."',
            },
          ]),
        ),
        top: 4,
        bottom: 16,
      },
      {
        html: `<p style="margin:0;font-size:15px;line-height:1.6;color:#18181b;">Your link: <strong style="word-break:break-all;">${escapeHtml(link)}</strong></p>`,
        bottom: 16,
      },
      {
        html: button(
          "Open your partner kit",
          `${CANONICAL_SITE_URL}/affiliates/kit?ref=${code}`,
        ),
        top: 4,
        bottom: 18,
      },
      { html: para("Questions? Just reply.") },
      { html: signoff("Colby", "UpTrend Scaling"), bottom: 24 },
    ],
    footerLines: ["UpTrend Scaling partner program"],
  });
}

function checkin2Html(name: string, code: string): string {
  return emailShell({
    subject: "Anything I can help with?",
    preheader: "Happy to write your first post or email with you.",
    tagline: "PARTNER PROGRAM",
    sections: [
      { html: para(`Hi ${firstNameOf(name)},`), top: 30 },
      {
        html: para(
          "Checking in to see how sharing UpTrend is going. If you haven't had a chance yet, that's completely fine.",
        ),
      },
      {
        html: para(
          "If it would help, reply and tell me who you'd like to share it with (your clients, your email list, a Facebook group, a video). I'll write the post or email for you, ready to send.",
        ),
      },
      {
        html: button(
          "Open your partner kit",
          `${CANONICAL_SITE_URL}/affiliates/kit?ref=${code}`,
        ),
        top: 4,
        bottom: 18,
      },
      { html: signoff("Colby", "UpTrend Scaling"), bottom: 24 },
    ],
    footerLines: ["UpTrend Scaling partner program"],
  });
}

// ---- The daily run ------------------------------------------------------------

export type AffiliateRecruitingResult = {
  invited: number;
  followedUp: number;
  failed: number;
  checkins: number;
  skippedReason?: string;
};

// Prospects we must never email: already replied, unsubscribed, applied to
// the program, or opted out of the cold-lead emails under the same address.
const eligible = and(
  isNull(affiliateProspects.respondedAt),
  isNull(affiliateProspects.unsubscribedAt),
  sql`coalesce(${affiliateProspects.notes}, '') not like ${NOT_SENT_NOTE_PREFIX + "%"}`,
  sql`not exists (select 1 from affiliates a where lower(a.email) = ${affiliateProspects.email})`,
  sql`not exists (select 1 from leads l where lower(l.email) = ${affiliateProspects.email} and l.unsubscribed_at is not null)`,
);

async function sendProspectEmails(
  prospects: AffiliateProspect[],
  build: (p: AffiliateProspect) => OutreachEmail,
  onAccepted: (ids: string[]) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  if (prospects.length === 0) return { sent: 0, failed: 0 };
  const emails = prospects.map((p) => ({ ...build(p), to: p.email }));

  let result = await sendEmailBatch(emails);
  if (!result.ok && result.retryable) {
    await sleep(result.retryAfterMs ?? 2000);
    result = await sendEmailBatch(emails);
  }
  if (result.ok) {
    await onAccepted(prospects.map((p) => p.id));
    return { sent: prospects.length, failed: 0 };
  }
  if (result.status !== 400 && result.status !== 422) {
    console.error(
      "[affiliate-outreach] batch failed",
      result.status,
      result.error,
    );
    return { sent: 0, failed: prospects.length };
  }

  // One bad address rejects the whole batch: go one at a time instead.
  let sent = 0;
  let failed = 0;
  for (const [index, prospect] of prospects.entries()) {
    await sleep(PAUSE_MS);
    const single = await sendEmailPlain(emails[index] as OutreachEmail);
    if (single.ok) {
      await onAccepted([prospect.id]);
      sent += 1;
    } else if (single.status === 400 || single.status === 422) {
      failed += 1;
      await db
        .update(affiliateProspects)
        .set({ notes: `${NOT_SENT_NOTE_PREFIX} ${single.error}`.slice(0, 500) })
        .where(eq(affiliateProspects.id, prospect.id));
    } else {
      console.error("[affiliate-outreach] stopped early", single.error);
      return { sent, failed: failed + 1 };
    }
  }
  return { sent, failed };
}

async function sendCheckins(): Promise<number> {
  const db = getDb();
  let count = 0;

  const due1 = await db
    .select()
    .from(affiliates)
    .where(
      and(
        eq(affiliates.status, "approved"),
        isNotNull(affiliates.code),
        isNull(affiliates.checkin1SentAt),
        sql`${affiliates.approvedAt} <= now() - interval '3 days'`,
      ),
    )
    .limit(10);
  for (const a of due1) {
    const sent = await sendEmail(
      a.email,
      "The easiest way to get your first referral",
      checkin1Html(a.name, a.code as string),
      undefined,
      undefined,
      { idempotencyKey: `affiliate-checkin1-${a.id}` },
    );
    if (sent.ok) {
      count += 1;
      await db
        .update(affiliates)
        .set({ checkin1SentAt: new Date() })
        .where(eq(affiliates.id, a.id));
    }
  }

  const due2 = await db
    .select()
    .from(affiliates)
    .where(
      and(
        eq(affiliates.status, "approved"),
        isNotNull(affiliates.code),
        isNotNull(affiliates.checkin1SentAt),
        isNull(affiliates.checkin2SentAt),
        sql`${affiliates.approvedAt} <= now() - interval '10 days'`,
      ),
    )
    .limit(10);
  for (const a of due2) {
    const [referral] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.referredBy, a.code as string))
      .limit(1);
    if (!referral) {
      const sent = await sendEmail(
        a.email,
        "Anything I can help with?",
        checkin2Html(a.name, a.code as string),
        undefined,
        undefined,
        { idempotencyKey: `affiliate-checkin2-${a.id}` },
      );
      if (!sent.ok) continue;
      count += 1;
    }
    // Stamped either way: someone who already referred a business doesn't
    // need the nudge.
    await db
      .update(affiliates)
      .set({ checkin2SentAt: new Date() })
      .where(eq(affiliates.id, a.id));
  }
  return count;
}

// `budget` = how many more emails can go out today without passing Resend's
// daily limit (the caller subtracts what the cold-lead follow-ups used).
export async function runAffiliateRecruiting(
  budget: number,
): Promise<AffiliateRecruitingResult> {
  const empty = { invited: 0, followedUp: 0, failed: 0, checkins: 0 };
  if (
    !isDbConfigured() ||
    !isResendConfigured() ||
    !process.env["RESEND_API_KEY"]
  ) {
    return { ...empty, skippedReason: "not_configured" };
  }
  try {
    const db = getDb();
    let remaining = Math.min(budget, AFFILIATE_MAX_SENDS_PER_DAY);

    const checkins = remaining > 0 ? await sendCheckins() : 0;
    remaining -= checkins;

    const dueFollowUps =
      remaining > 0
        ? await db
            .select()
            .from(affiliateProspects)
            .where(
              and(
                eligible,
                isNotNull(affiliateProspects.contactedAt),
                isNull(affiliateProspects.followUpSentAt),
                sql`(${affiliateProspects.contactedAt} at time zone 'America/Phoenix')::date <= (now() at time zone 'America/Phoenix')::date - ${AFFILIATE_FOLLOW_UP_AFTER_DAYS}::int`,
              ),
            )
            .orderBy(asc(affiliateProspects.contactedAt))
            .limit(remaining)
        : [];
    const followUps = await sendProspectEmails(
      dueFollowUps,
      renderFollowUpEmail,
      async (ids) => {
        await db
          .update(affiliateProspects)
          .set({ followUpSentAt: new Date() })
          .where(inArray(affiliateProspects.id, ids));
      },
    );
    remaining -= followUps.sent + followUps.failed;

    const inviteLimit = Math.min(AFFILIATE_INVITES_PER_DAY, remaining);
    const newOnes =
      inviteLimit > 0
        ? await db
            .select()
            .from(affiliateProspects)
            .where(and(eligible, isNull(affiliateProspects.contactedAt)))
            .orderBy(
              asc(affiliateProspects.priority),
              asc(affiliateProspects.createdAt),
            )
            .limit(inviteLimit)
        : [];
    if (dueFollowUps.length && newOnes.length) await sleep(PAUSE_MS);
    const invites = await sendProspectEmails(
      newOnes,
      renderInviteEmail,
      async (ids) => {
        await db
          .update(affiliateProspects)
          .set({ contactedAt: new Date() })
          .where(inArray(affiliateProspects.id, ids));
      },
    );

    const result = {
      invited: invites.sent,
      followedUp: followUps.sent,
      failed: invites.failed + followUps.failed,
      checkins,
    };
    console.log("[affiliate-outreach] run finished", result);
    return result;
  } catch (error) {
    // Most likely the affiliate_prospects table isn't there yet.
    console.error("[affiliate-outreach] run failed", error);
    return { ...empty, skippedReason: "error" };
  }
}

// ---- Admin: the Recruiting panel on the Affiliates tab ------------------------

export type ProspectSummary = {
  id: string;
  company: string;
  fullName: string | null;
  email: string;
  kind: AffiliateProspect["kind"];
  audience: string;
  contactedAt: Date | null;
  followUpSentAt: Date | null;
  respondedAt: Date | null;
  unsubscribedAt: Date | null;
  applied: boolean;
  notSent: boolean;
};

export type ProspectsOverviewResult =
  { ok: true; prospects: ProspectSummary[] } | { ok: false; message: string };

export const getAffiliateProspects = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProspectsOverviewResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      const db = getDb();
      const rows = await db
        .select({
          prospect: affiliateProspects,
          applied: sql<boolean>`exists (select 1 from affiliates a where lower(a.email) = ${affiliateProspects.email})`,
        })
        .from(affiliateProspects)
        .orderBy(
          desc(
            sql`coalesce(${affiliateProspects.respondedAt}, ${affiliateProspects.followUpSentAt}, ${affiliateProspects.contactedAt})`,
          ),
          asc(affiliateProspects.priority),
        );
      return {
        ok: true,
        prospects: rows.map(({ prospect: p, applied }) => ({
          id: p.id,
          company: p.company,
          fullName: p.fullName,
          email: p.email,
          kind: p.kind,
          audience: p.audience,
          contactedAt: p.contactedAt,
          followUpSentAt: p.followUpSentAt,
          respondedAt: p.respondedAt,
          unsubscribedAt: p.unsubscribedAt,
          applied: Boolean(applied),
          notSent: (p.notes ?? "").startsWith(NOT_SENT_NOTE_PREFIX),
        })),
      };
    } catch (error) {
      console.error("[affiliate-outreach] failed to load prospects", error);
      return { ok: true, prospects: [] };
    }
  },
);

// "They replied" button: stops the follow-up for this person.
export const markProspectReplied = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ prospectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      await getDb()
        .update(affiliateProspects)
        .set({ respondedAt: new Date() })
        .where(eq(affiliateProspects.id, data.prospectId));
      return { ok: true };
    } catch (error) {
      console.error("[affiliate-outreach] failed to mark replied", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });
