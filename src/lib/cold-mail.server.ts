// Cold email, sent from real Zoho mailboxes on separate domains
// (colby@getuptrendscaling.com and colby@tryuptrendscaling.com) instead of
// Resend. Covers the four kinds of cold email:
//
//   lead_first          first email to a local business (cold outreach)
//   lead_followup       one follow-up, 2 days later, as a reply in the same thread
//   affiliate_first     partner program invite
//   affiliate_followup  one follow-up, 5 days later, as a reply in the same thread
//
// Why: Resend's rules don't allow cold email, and sending it from
// uptrendscaling.com put the main domain at risk. Everything people signed up
// for (welcome emails, owner alerts, weekly updates, review requests, partner
// check-ins) still goes through Resend from uptrendscaling.com.
//
// Deliverability rules built in here:
// - Warm-up: each mailbox starts at 5 emails a day and works up to 25 a day
//   over about 4 weeks (warmupCapFor). A mailbox never goes over its cap.
// - Sending is spread across the day: the cron runs several times a day and
//   each run only sends its share of what's left.
// - The same designed templates as before (Colby's call), sent with their
//   plain-text copy, and with no open or click tracking.
// - Follow-ups go out from the same mailbox that sent the first email,
//   linked to it as a reply.
// - Replies and bounces are read from each mailbox (IMAP) every run: anyone who
//   replies is never emailed again and Colby gets an alert at hello@; dead
//   addresses are blocked.
//
// Turned on by setting these in Vercel (nothing happens until they're set):
//   COLD_SENDER_1_EMAIL / COLD_SENDER_1_PASSWORD   (Zoho app password)
//   COLD_SENDER_2_EMAIL / COLD_SENDER_2_PASSWORD
// Optional: COLD_SENDER_NAME (default "Colby at UpTrend Scaling", same as before), COLD_SMTP_HOST
// (default smtppro.zoho.com), COLD_IMAP_HOST (default imappro.zoho.com),
// COLD_DAILY_MAX (default 25, the per-mailbox cap after warm-up).
//
// Dormant-safe like the rest of the app: never throws to the caller.

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import {
  AFFILIATE_FOLLOW_UP_AFTER_DAYS,
  prospectEligible,
  renderFollowUpEmail,
  renderInviteEmail,
} from "./affiliate-outreach.server";
import { getDb, isDbConfigured } from "./db/client";
import { affiliateProspects, coldSends, leads } from "./db/schema";
import {
  isResendConfigured,
  leadFirstName,
  leadFollowUpEmail,
  leadUnsubscribeUrl,
  sendEmail,
  UPTREND_SUPPORT_EMAIL,
} from "./messaging.server";
import { renderOutreachEmail } from "./outreach-email";

type Kind =
  "lead_first" | "lead_followup" | "affiliate_first" | "affiliate_followup";

type Sender = { email: string; password: string };

// UTC hours the /cron/lead-followups job runs (see vercel.json):
// 7, 8, 10, 12 and 2 Phoenix time.
const SLOT_HOURS_UTC = [14, 15, 17, 19, 21];
const MAX_PER_RUN = 15;
const PAUSE_MIN_MS = 2500;
const PAUSE_MAX_MS = 6000;
const LEAD_FOLLOW_UP_AFTER_DAYS = 2;

// Same home services list the lead sourcing uses (plus vets, groomers and
// salons, which Colby asked to keep).
const LEAD_INDUSTRY_PATTERN =
  "hvac|heating|air cond|plumb|electric|roof|garage door|pest|lawn|landscap|pool|tree|paint|fenc|handyman|appliance|locksmith|concrete|paving|masonry|solar|cleaning|maid|junk|moving|mover|gutter|window|flooring|remodel|drywall|irrigation|septic|siding|chimney|pressure wash|carpet|veterin|animal hosp|groom|salon|both";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPause(): number {
  return (
    PAUSE_MIN_MS + Math.floor(Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS))
  );
}

// ---- Config -------------------------------------------------------------------

export function coldSenders(): Sender[] {
  const senders: Sender[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const email = process.env[`COLD_SENDER_${i}_EMAIL`]?.trim().toLowerCase();
    const password = process.env[`COLD_SENDER_${i}_PASSWORD`]?.trim();
    if (email && password) senders.push({ email, password });
  }
  return senders;
}

export function isColdMailConfigured(): boolean {
  return isDbConfigured() && coldSenders().length > 0;
}

function senderName(): string {
  return process.env["COLD_SENDER_NAME"]?.trim() || "Colby at UpTrend Scaling";
}

function dailyMax(): number {
  const n = Number(process.env["COLD_DAILY_MAX"]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 25;
}

// Emails a mailbox may send on day `day` of its warm-up (day 0 = the day it
// sent its first email).
export function warmupCapFor(day: number): number {
  const cap = day < 7 ? 5 : day < 14 ? 10 : day < 21 ? 15 : day < 28 ? 20 : 25;
  return Math.min(cap, dailyMax());
}

// ---- Email content ------------------------------------------------------------
// Colby's call: the cold emails keep the designed templates already in use
// (lib/outreach-email.ts for leads, the partner templates in
// lib/affiliate-outreach.server.ts), each sent with its plain-text copy.
// Only how they're sent changes, not what they say or how they look.

type Content = { subject: string; html: string; text: string };

function leadFirstContent(lead: {
  id: string;
  businessName: string;
  ownerName: string | null;
}): Content {
  const { subject, html, text } = renderOutreachEmail({
    kind: "first",
    greetingName: leadFirstName(lead.ownerName) ?? "there",
    businessName: lead.businessName.trim() || "your business",
    unsubscribeUrl: leadUnsubscribeUrl(lead.id),
  });
  return { subject, html, text };
}

function leadFollowUpContent(lead: {
  id: string;
  businessName: string;
  ownerName: string | null;
  contactedAt: Date | null;
}): Content {
  const { subject, html, text } = leadFollowUpEmail(lead);
  return { subject, html, text };
}

// ---- Sending ----------------------------------------------------------------

type SenderState = Sender & { sentToday: number; cap: number };

function phoenixDayStart(now = new Date()): Date {
  // Midnight in Phoenix (UTC-7 all year, no daylight saving).
  const phoenix = new Date(now.getTime() - 7 * 3600_000);
  phoenix.setUTCHours(0, 0, 0, 0);
  return new Date(phoenix.getTime() + 7 * 3600_000);
}

async function loadSenderStates(): Promise<SenderState[]> {
  const db = getDb();
  const senders = coldSenders();
  const dayStart = phoenixDayStart();
  const states: SenderState[] = [];
  for (const sender of senders) {
    const [first] = await db
      .select({ at: sql<Date | null>`min(${coldSends.sentAt})` })
      .from(coldSends)
      .where(eq(coldSends.sender, sender.email));
    const [today] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(coldSends)
      .where(
        and(
          eq(coldSends.sender, sender.email),
          gte(coldSends.sentAt, dayStart),
        ),
      );
    const firstAt = first?.at ? new Date(first.at) : null;
    const day = firstAt
      ? Math.floor(
          (dayStart.getTime() - phoenixDayStart(firstAt).getTime()) /
            86_400_000,
        )
      : 0;
    states.push({
      ...sender,
      sentToday: today?.n ?? 0,
      cap: warmupCapFor(day),
    });
  }
  return states;
}

type Transport = ReturnType<typeof nodemailer.createTransport>;
const transports = new Map<string, Transport>();

function transportFor(sender: Sender): Transport {
  let t = transports.get(sender.email);
  if (!t) {
    t = nodemailer.createTransport({
      host: process.env["COLD_SMTP_HOST"]?.trim() || "smtppro.zoho.com",
      port: 465,
      secure: true,
      auth: { user: sender.email, pass: sender.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    transports.set(sender.email, t);
  }
  return t;
}

type SendOutcome =
  | { ok: true; messageId: string | null }
  | { ok: false; permanent: boolean; error: string };

async function sendOne(
  sender: Sender,
  input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    unsubscribeUrl: string;
    inReplyTo?: string | null;
  },
): Promise<SendOutcome> {
  try {
    const info = await transportFor(sender).sendMail({
      from: { name: senderName(), address: sender.email },
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: {
        "List-Unsubscribe": `<mailto:${sender.email}?subject=unsubscribe>, <${input.unsubscribeUrl}>`,
      },
      ...(input.inReplyTo
        ? { inReplyTo: input.inReplyTo, references: [input.inReplyTo] }
        : {}),
    });
    return { ok: true, messageId: info.messageId ?? null };
  } catch (error) {
    const err = error as { responseCode?: number; message?: string };
    const code = err.responseCode ?? 0;
    // 5xx about the recipient (no such user, bad address) is permanent. A
    // 5xx about our login or sending limit is not the recipient's fault.
    const message = err.message ?? "Unknown error";
    const aboutRecipient =
      /recipient|mailbox|user unknown|no such user|does not exist|invalid address|address rejected/i.test(
        message,
      );
    return {
      ok: false,
      permanent: code >= 500 && code < 600 && aboutRecipient,
      error: message.slice(0, 300),
    };
  }
}

// The mailbox that sent the first email to this person, and that email's
// Message-ID, so the follow-up goes out as a reply in the same thread.
async function firstSendFor(
  refId: string,
  kind: "lead_first" | "affiliate_first",
): Promise<{ sender: string; messageId: string | null } | null> {
  const db = getDb();
  const [row] = await db
    .select({ sender: coldSends.sender, messageId: coldSends.messageId })
    .from(coldSends)
    .where(and(eq(coldSends.refId, refId), eq(coldSends.kind, kind)))
    .orderBy(desc(coldSends.sentAt))
    .limit(1);
  return row ?? null;
}

function pick(e: { subject: string; html: string; text: string }): Content {
  return { subject: e.subject, html: e.html, text: e.text };
}

// ---- Queues -----------------------------------------------------------------

type Job = {
  kind: Kind;
  refId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
};

async function leadFollowUpJobs(limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: leads.id,
      email: leads.email,
      businessName: leads.businessName,
      contactedAt: leads.contactedAt,
      ownerName: sql<string | null>`"leads"."owner_name"`,
    })
    .from(leads)
    .where(
      and(
        isNotNull(leads.contactedAt),
        isNull(leads.followUpSentAt),
        isNull(leads.respondedAt),
        sql`"leads"."unsubscribed_at" is null`,
        sql`coalesce(${leads.notes}, '') not like 'Follow-up not sent:%'`,
        sql`(${leads.contactedAt} at time zone 'America/Phoenix')::date <= (now() at time zone 'America/Phoenix')::date - ${LEAD_FOLLOW_UP_AFTER_DAYS}::int`,
      ),
    )
    .orderBy(asc(leads.contactedAt))
    .limit(limit);
  return rows.map((lead) => ({
    kind: "lead_followup" as const,
    refId: lead.id,
    to: lead.email,
    ...leadFollowUpContent(lead),
    unsubscribeUrl: leadUnsubscribeUrl(lead.id),
  }));
}

async function leadFirstJobs(limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: leads.id,
      email: leads.email,
      businessName: leads.businessName,
      ownerName: sql<string | null>`"leads"."owner_name"`,
    })
    .from(leads)
    .where(
      and(
        isNull(leads.contactedAt),
        isNull(leads.respondedAt),
        sql`"leads"."unsubscribed_at" is null`,
        sql`lower(${leads.email}) not like 'info@%'`,
        sql`${leads.industry} ~* ${LEAD_INDUSTRY_PATTERN}`,
        sql`coalesce(${leads.notes}, '') not like 'Not sent:%'`,
        // Colby's rule: never schools or other education businesses.
        sql`${leads.businessName} !~* 'school|preschool|montessori|academy|learning cent|day ?care|child ?care|tutor'`,
      ),
    )
    // Leads with a known owner name first (the greeting uses it).
    .orderBy(sql`("leads"."owner_name" is not null) desc`, asc(leads.createdAt))
    .limit(limit);
  return rows.map((lead) => ({
    kind: "lead_first" as const,
    refId: lead.id,
    to: lead.email,
    ...leadFirstContent(lead),
    unsubscribeUrl: leadUnsubscribeUrl(lead.id),
  }));
}

async function affiliateFollowUpJobs(limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(affiliateProspects)
    .where(
      and(
        prospectEligible,
        isNotNull(affiliateProspects.contactedAt),
        isNull(affiliateProspects.followUpSentAt),
        sql`(${affiliateProspects.contactedAt} at time zone 'America/Phoenix')::date <= (now() at time zone 'America/Phoenix')::date - ${AFFILIATE_FOLLOW_UP_AFTER_DAYS}::int`,
      ),
    )
    .orderBy(asc(affiliateProspects.contactedAt))
    .limit(limit);
  return rows.map((p) => ({
    kind: "affiliate_followup" as const,
    refId: p.id,
    to: p.email,
    ...pick(renderFollowUpEmail(p)),
    unsubscribeUrl: leadUnsubscribeUrl(p.id),
  }));
}

async function affiliateFirstJobs(limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(affiliateProspects)
    .where(and(prospectEligible, isNull(affiliateProspects.contactedAt)))
    .orderBy(
      asc(affiliateProspects.priority),
      asc(affiliateProspects.createdAt),
    )
    .limit(limit);
  return rows.map((p) => ({
    kind: "affiliate_first" as const,
    refId: p.id,
    to: p.email,
    ...pick(renderInviteEmail(p)),
    unsubscribeUrl: leadUnsubscribeUrl(p.id),
  }));
}

// Mixes the four queues so leads get about two thirds of the day's sends and
// affiliate outreach about a third, with follow-ups ahead of new emails.
function interleave(queues: Record<Kind, Job[]>, total: number): Job[] {
  const pattern: Kind[] = [
    "lead_followup",
    "lead_first",
    "affiliate_followup",
    "lead_followup",
    "lead_first",
    "affiliate_first",
  ];
  const picked: Job[] = [];
  const cursors: Record<Kind, number> = {
    lead_first: 0,
    lead_followup: 0,
    affiliate_first: 0,
    affiliate_followup: 0,
  };
  let idle = 0;
  for (let i = 0; picked.length < total && idle < pattern.length; i += 1) {
    const kind = pattern[i % pattern.length] as Kind;
    const job = queues[kind][cursors[kind]];
    if (job) {
      picked.push(job);
      cursors[kind] += 1;
      idle = 0;
    } else {
      idle += 1;
    }
  }
  return picked;
}

async function markSent(job: Job): Promise<void> {
  const db = getDb();
  const now = new Date();
  if (job.kind === "lead_first") {
    await db
      .update(leads)
      .set({
        contactedAt: now,
        outreachGroup: sql`coalesce(${leads.outreachGroup}, 'Zoho cold email')`,
      })
      .where(eq(leads.id, job.refId));
  } else if (job.kind === "lead_followup") {
    await db
      .update(leads)
      .set({ followUpSentAt: now })
      .where(eq(leads.id, job.refId));
  } else if (job.kind === "affiliate_first") {
    await db
      .update(affiliateProspects)
      .set({ contactedAt: now })
      .where(eq(affiliateProspects.id, job.refId));
  } else {
    await db
      .update(affiliateProspects)
      .set({ followUpSentAt: now })
      .where(eq(affiliateProspects.id, job.refId));
  }
}

async function markDeadAddress(job: Job, error: string): Promise<void> {
  const note = `Not sent: ${error}`.slice(0, 500);
  if (job.kind === "lead_first" || job.kind === "lead_followup") {
    await getDb().execute(
      sql`update leads set unsubscribed_at = coalesce(unsubscribed_at, now()), notes = concat_ws(' | ', notes, ${note}) where id = ${job.refId}::uuid`,
    );
  } else {
    await getDb()
      .update(affiliateProspects)
      .set({ unsubscribedAt: new Date(), notes: note })
      .where(eq(affiliateProspects.id, job.refId));
  }
}

// ---- Reading replies and bounces ------------------------------------------------

type InboxScan = { replies: number; bounces: number; error?: string };

const AUTO_REPLY_SUBJECT =
  /out of (the )?office|automatic reply|auto.?reply|autoreply|away from|vacation|on leave/i;
const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery/i;
const BOUNCE_SUBJECT =
  /undeliver|delivery (status|failure|has failed)|failure notice|returned mail|could not be delivered|not delivered/i;

async function alertColbyOfReply(input: {
  mailbox: string;
  from: string;
  who: string;
  subject: string;
  snippet: string;
}): Promise<void> {
  if (!isResendConfigured()) return;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<p><strong>${esc(input.who)}</strong> (${esc(input.from)}) replied to a cold email.</p>
<p><strong>Subject:</strong> ${esc(input.subject)}</p>
<blockquote style="border-left:3px solid #ccc;margin:0;padding:6px 12px;color:#333;white-space:pre-wrap;">${esc(input.snippet)}</blockquote>
<p>Read and answer it in the ${esc(input.mailbox)} inbox at <a href="https://mail.zoho.com">mail.zoho.com</a>. They won't get any more automatic emails.</p>`;
  await sendEmail(
    UPTREND_SUPPORT_EMAIL,
    `Cold email reply from ${input.who}`,
    html,
    `UpTrend Scaling Alerts <${UPTREND_SUPPORT_EMAIL}>`,
  );
}

async function scanInbox(sender: Sender): Promise<InboxScan> {
  const db = getDb();
  const result: InboxScan = { replies: 0, bounces: 0 };
  const client = new ImapFlow({
    host: process.env["COLD_IMAP_HOST"]?.trim() || "imappro.zoho.com",
    port: 993,
    secure: true,
    auth: { user: sender.email, pass: sender.password },
    logger: false,
    socketTimeout: 20_000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - 3 * 86_400_000);
      const uids = await client.search({ since }, { uid: true });
      const recent = (uids || []).slice(-60);
      if (recent.length === 0) return result;
      for await (const msg of client.fetch(
        recent,
        { envelope: true, source: { start: 0, maxLength: 12_000 } },
        { uid: true },
      )) {
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
        const subject = msg.envelope?.subject ?? "";
        const raw = msg.source ? msg.source.toString("utf8") : "";

        if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject)) {
          // Find which of our recipients bounced.
          const found = Array.from(
            new Set(
              (
                raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ||
                []
              ).map((e) => e.toLowerCase()),
            ),
          ).filter((e) => !e.endsWith("zoho.com") && e !== sender.email);
          if (found.length === 0) continue;
          const sent = await db
            .select({ recipient: coldSends.recipient })
            .from(coldSends)
            .where(
              and(
                eq(coldSends.sender, sender.email),
                inArray(coldSends.recipient, found),
              ),
            );
          for (const { recipient } of sent) {
            const updated = await db.execute(
              sql`update leads set unsubscribed_at = now(), notes = concat_ws(' | ', notes, 'Bounced (cold mailbox) ' || current_date) where lower(email) = ${recipient} and unsubscribed_at is null returning id`,
            );
            await db.execute(
              sql`update affiliate_prospects set unsubscribed_at = now(), notes = concat_ws(' | ', notes, 'Bounced (cold mailbox)') where lower(email) = ${recipient} and unsubscribed_at is null`,
            );
            if ((updated.rows?.length ?? 0) > 0) result.bounces += 1;
          }
          continue;
        }

        if (
          !from ||
          AUTO_REPLY_SUBJECT.test(subject) ||
          /^auto-submitted:\s*auto-(replied|generated)/im.test(raw)
        ) {
          continue;
        }

        const leadRows = await db.execute(
          sql`update leads set responded_at = now() where lower(email) = ${from} and responded_at is null returning business_name`,
        );
        const prospectRows = await db.execute(
          sql`update affiliate_prospects set responded_at = now() where lower(email) = ${from} and responded_at is null returning company`,
        );
        const lead = leadRows.rows?.[0] as
          { business_name?: string } | undefined;
        const prospect = prospectRows.rows?.[0] as
          { company?: string } | undefined;
        const who = lead?.business_name ?? prospect?.company;
        if (!who) continue;

        result.replies += 1;
        const optOut = /no thanks|unsubscribe|remove me|stop/i.test(
          raw
            .split(/\r?\n\r?\n/)
            .slice(1)
            .join("\n")
            .slice(0, 600),
        );
        if (optOut) {
          await db.execute(
            sql`update leads set unsubscribed_at = coalesce(unsubscribed_at, now()) where lower(email) = ${from}`,
          );
        }
        const body = raw
          .split(/\r?\n\r?\n/)
          .slice(1)
          .join("\n");
        const snippet = body
          .replace(/<[^>]+>/g, " ")
          .replace(/=\r?\n/g, "")
          .replace(/\s+\n/g, "\n")
          .trim()
          .slice(0, 700);
        await alertColbyOfReply({
          mailbox: sender.email,
          from,
          who,
          subject,
          snippet,
        });
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    result.error = (error as Error).message?.slice(0, 200) ?? "IMAP error";
    console.error("[cold-mail] inbox scan failed", sender.email, error);
  } finally {
    await client.logout().catch(() => undefined);
  }
  return result;
}

// ---- The run ----------------------------------------------------------------------

export type ColdMailRunResult = {
  ok: boolean;
  skippedReason?: string;
  sent: Record<Kind, number>;
  failed: number;
  replies: number;
  bounces: number;
  mailboxes: Array<{
    email: string;
    sentToday: number;
    cap: number;
    inboxError?: string | undefined;
  }>;
};

export async function runColdMailSlot(
  now = new Date(),
): Promise<ColdMailRunResult> {
  const sent: Record<Kind, number> = {
    lead_first: 0,
    lead_followup: 0,
    affiliate_first: 0,
    affiliate_followup: 0,
  };
  const empty: ColdMailRunResult = {
    ok: false,
    sent,
    failed: 0,
    replies: 0,
    bounces: 0,
    mailboxes: [],
  };
  if (!isColdMailConfigured())
    return { ...empty, skippedReason: "not_configured" };

  try {
    // 1. Read replies and bounces first, so nobody who replied gets a
    //    follow-up in this same run.
    let replies = 0;
    let bounces = 0;
    const inboxErrors = new Map<string, string>();
    for (const sender of coldSenders()) {
      const scan = await scanInbox(sender);
      replies += scan.replies;
      bounces += scan.bounces;
      if (scan.error) inboxErrors.set(sender.email, scan.error);
    }

    // 2. Work out this run's share of today's remaining warm-up allowance.
    const states = await loadSenderStates();
    const remainingToday = states.reduce(
      (sum, s) => sum + Math.max(0, s.cap - s.sentToday),
      0,
    );
    const hour = now.getUTCHours();
    const slotsLeft = Math.max(
      1,
      SLOT_HOURS_UTC.filter((h) => h >= hour).length,
    );
    const allowance = Math.min(
      MAX_PER_RUN,
      Math.ceil(remainingToday / slotsLeft),
    );

    let failed = 0;
    if (allowance > 0) {
      const queues: Record<Kind, Job[]> = {
        lead_followup: await leadFollowUpJobs(allowance),
        lead_first: await leadFirstJobs(allowance),
        affiliate_followup: await affiliateFollowUpJobs(allowance),
        affiliate_first: await affiliateFirstJobs(allowance),
      };
      const jobs = interleave(queues, allowance);

      for (const [index, job] of jobs.entries()) {
        // Follow-ups go from the mailbox that sent the first email, as a
        // reply in the same thread, when we have that record.
        const firstKind =
          job.kind === "lead_followup"
            ? "lead_first"
            : job.kind === "affiliate_followup"
              ? "affiliate_first"
              : null;
        const first = firstKind
          ? await firstSendFor(job.refId, firstKind)
          : null;
        let state = first
          ? states.find((s) => s.email === first.sender && s.sentToday < s.cap)
          : undefined;
        if (!state) {
          state = states
            .filter((s) => s.sentToday < s.cap)
            .sort((a, b) => a.sentToday / a.cap - b.sentToday / b.cap)[0];
        }
        if (!state) break;

        if (index > 0) await sleep(randomPause());
        const threaded = Boolean(
          first?.messageId && first.sender === state.email,
        );
        const outcome = await sendOne(state, {
          to: job.to,
          subject: job.subject,
          html: job.html,
          text: job.text,
          unsubscribeUrl: job.unsubscribeUrl,
          inReplyTo: threaded ? (first?.messageId ?? null) : null,
        });

        if (outcome.ok) {
          state.sentToday += 1;
          sent[job.kind] += 1;
          await getDb().insert(coldSends).values({
            sender: state.email,
            recipient: job.to.toLowerCase(),
            kind: job.kind,
            refId: job.refId,
            messageId: outcome.messageId,
          });
          await markSent(job);
        } else if (outcome.permanent) {
          failed += 1;
          await markDeadAddress(job, outcome.error);
        } else {
          // Login problem, Zoho limit, network: stop and try next run.
          failed += 1;
          console.error(
            "[cold-mail] send failed, stopping this run",
            state.email,
            outcome.error,
          );
          break;
        }
      }
    }

    const result: ColdMailRunResult = {
      ok: true,
      sent,
      failed,
      replies,
      bounces,
      mailboxes: states.map((s) => ({
        email: s.email,
        sentToday: s.sentToday,
        cap: s.cap,
        ...(inboxErrors.get(s.email)
          ? { inboxError: inboxErrors.get(s.email) }
          : {}),
      })),
    };
    console.log("[cold-mail] run finished", JSON.stringify(result));
    return result;
  } catch (error) {
    console.error("[cold-mail] run failed", error);
    return { ...empty, skippedReason: "error" };
  }
}
