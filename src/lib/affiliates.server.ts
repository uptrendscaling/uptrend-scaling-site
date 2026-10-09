// Affiliate program: people who send us customers through their own link
// (uptrendscaling.com/?ref=CODE) earn 25% of every payment each referred
// customer makes, for as long as that customer stays, plus a one-time $20
// bonus when that customer makes their 2nd monthly payment. Referred customers
// skip the $20 setup fee. Every paying UpTrend customer also gets a referral
// link of their own automatically, on the same terms (source = "customer").
//
// How a referral is tracked, end to end:
// 1. Any page opened with ?ref=CODE saves the code in a cookie for 60 days
//    (REF_CAPTURE_SCRIPT, run in <head> by __root.tsx).
// 2. /start sends that code with the checkout request. createCheckoutSession
//    checks it belongs to an approved affiliate, leaves out the setup fee and
//    stamps the code on the Stripe checkout session and subscription metadata.
// 3. When the business finishes signup, the code is copied onto
//    businesses.referred_by.
// 4. /admin (Affiliates tab) adds up what each affiliate has earned straight
//    from the paid invoices in Stripe, minus payouts recorded there.
//
// Dormant-safe like the rest of the app: every exported function checks the
// database is configured and fails soft.

import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import {
  AFFILIATE_COMMISSION_RATE,
  AFFILIATE_PAYABLE_AFTER_PAYMENTS,
  AFFILIATE_SECOND_PAYMENT_BONUS_DOLLARS,
} from "./affiliate-config";
import { getSessionBusinessId } from "./auth.server";
import { ensureDemoAccount } from "./demo.server";
import { getDb, isDbConfigured } from "./db/client";
import {
  affiliatePayouts,
  affiliates,
  businesses,
  type Affiliate,
  type Business,
} from "./db/schema";
import { button, card, detailRows, emailShell, para } from "./email-layout";
import {
  isResendConfigured,
  sendEmail,
  UPTREND_SUPPORT_EMAIL,
} from "./messaging.server";
import { CANONICAL_SITE_URL } from "./site";
import { requireAdminBusiness } from "./reviews.server";

const SETUP_FEE_DESCRIPTION = "One-time account setup fee";
const CODE_PATTERN = /^[a-z0-9]{2,32}$/;

export function normalizeRefCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}

export function affiliateLinkFor(code: string): string {
  return `${CANONICAL_SITE_URL}/?ref=${code}`;
}

// Used by checkout: returns the affiliate only if the code is real and the
// affiliate is currently approved. Never throws.
export async function findApprovedAffiliate(
  rawCode: unknown,
): Promise<Affiliate | null> {
  const code = normalizeRefCode(rawCode);
  if (!code || !isDbConfigured()) return null;
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(affiliates)
      .where(and(eq(affiliates.code, code), eq(affiliates.status, "approved")))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error("[affiliates] failed to look up referral code", error);
    return null;
  }
}

// ---- Public: show "referred by" on the signup page --------------------------

export type ReferralLookup = { ok: true; name: string } | { ok: false };

export const lookupReferral = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ code: z.string().max(64) }).parse(input),
  )
  .handler(async ({ data }): Promise<ReferralLookup> => {
    const affiliate = await findApprovedAffiliate(data.code);
    if (!affiliate) return { ok: false };
    // First name only on a public page.
    const first = affiliate.name.trim().split(/\s+/)[0] ?? "";
    return { ok: true, name: first || "a partner" };
  });

// ---- Public: the application form on /affiliates ---------------------------

const applySchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: z.string().trim().max(40).optional().default(""),
  paypalEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter the email on your PayPal account")
    .max(254),
  website: z.string().trim().max(300).optional().default(""),
  promotePlan: z
    .string()
    .trim()
    .min(10, "Tell us a little about how you'd share UpTrend")
    .max(2000),
  agreed: z.literal(true, {
    errorMap: () => ({ message: "Please agree to the program terms" }),
  }),
});

export type ApplyResult = { ok: true } | { ok: false; message: string };

export const applyForAffiliate = createServerFn({ method: "POST" })
  .validator((input: unknown) => applySchema.parse(input))
  .handler(async ({ data }): Promise<ApplyResult> => {
    if (!isDbConfigured()) {
      return {
        ok: false,
        message: `Applications open shortly. Email ${UPTREND_SUPPORT_EMAIL} in the meantime.`,
      };
    }
    try {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(affiliates)
        .where(eq(affiliates.email, data.email))
        .orderBy(desc(affiliates.createdAt))
        .limit(1);

      if (existing && existing.status !== "rejected") {
        // Already applied (or already a partner): refresh their details
        // rather than creating a duplicate row.
        await db
          .update(affiliates)
          .set({
            name: data.name,
            phone: data.phone || null,
            paypalEmail: data.paypalEmail,
            website: data.website || null,
            promotePlan: data.promotePlan,
          })
          .where(eq(affiliates.id, existing.id));
      } else {
        await db.insert(affiliates).values({
          name: data.name,
          email: data.email,
          phone: data.phone || null,
          paypalEmail: data.paypalEmail,
          website: data.website || null,
          promotePlan: data.promotePlan,
        });
      }

      if (isResendConfigured()) {
        await Promise.allSettled([
          sendEmail(
            UPTREND_SUPPORT_EMAIL,
            `New affiliate application: ${data.name}`,
            newApplicationAlertHtml(data),
          ),
          sendEmail(
            data.email,
            "We got your UpTrend Scaling affiliate application",
            applicantConfirmationHtml(data.name),
            undefined,
            undefined,
            {
              idempotencyKey: `affiliate-apply-${data.email}-${new Date().toISOString().slice(0, 10)}`,
            },
          ),
        ]);
      }
      return { ok: true };
    } catch (error) {
      console.error("[affiliates] failed to save application", error);
      return {
        ok: false,
        message: `Something went wrong. Please try again, or email ${UPTREND_SUPPORT_EMAIL}.`,
      };
    }
  });

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function newApplicationAlertHtml(data: z.infer<typeof applySchema>): string {
  return emailShell({
    subject: `New affiliate application: ${data.name}`,
    preheader: `${data.name} wants to join the affiliate program.`,
    tagline: "NEW AFFILIATE APPLICATION",
    sections: [
      {
        html: para(
          `${data.name} applied to the affiliate program. Approve them on the Affiliates tab in your admin dashboard to send them their link.`,
        ),
      },
      {
        html: card(
          null,
          detailRows([
            { label: "Name", value: data.name },
            { label: "Email", value: data.email },
            { label: "Phone", value: data.phone || "Not given" },
            { label: "PayPal", value: data.paypalEmail },
            { label: "Website / social", value: data.website || "Not given" },
            { label: "How they'll promote", value: data.promotePlan },
          ]),
        ),
      },
      {
        html: button(
          "Open Affiliates in admin",
          `${CANONICAL_SITE_URL}/admin?tab=affiliates`,
        ),
        align: "center",
        top: 12,
        bottom: 20,
      },
    ],
    footerLines: ["UpTrend Scaling owner alert"],
  });
}

function applicantConfirmationHtml(name: string): string {
  return emailShell({
    subject: "We got your UpTrend Scaling affiliate application",
    preheader:
      "Thanks for applying. We'll be in touch within a couple of business days.",
    tagline: "AFFILIATE PROGRAM",
    sections: [
      { html: para(`Hi ${firstName(name)},`) },
      {
        html: para(
          "Thanks for applying to the UpTrend Scaling affiliate program. We review every application by hand and will email you within a couple of business days.",
        ),
      },
      {
        html: para(
          "Once you're approved you'll get your own link. You earn 25% of every payment from each business you refer, for as long as they stay a customer, plus a $20 bonus when they make their 2nd payment. The businesses you send skip our $20 setup fee.",
        ),
      },
      {
        html: para(
          `Questions? Just reply, or write to ${UPTREND_SUPPORT_EMAIL}.`,
        ),
      },
    ],
    footerLines: [
      "UpTrend Scaling",
      "Google reviews on autopilot for local businesses",
    ],
  });
}

function approvalEmailHtml(
  name: string,
  code: string,
  demoSetupUrl: string | null,
): string {
  const link = affiliateLinkFor(code);
  return emailShell({
    subject: "You're in: your UpTrend Scaling affiliate link",
    preheader: "Your link is ready. Here's how it works.",
    tagline: "AFFILIATE PROGRAM",
    sections: [
      { html: para(`Hi ${firstName(name)},`) },
      {
        html: para(
          "You're approved for the UpTrend Scaling affiliate program. Here is your personal link:",
        ),
      },
      {
        html: card(
          "Your link",
          `<p style="margin:0;font-size:18px;font-weight:700;word-break:break-all;">${link}</p>`,
        ),
      },
      {
        html: card(
          "How it works",
          detailRows([
            {
              label: "You earn",
              value:
                "25% of every payment each referred business makes, for as long as they stay a customer, plus a $20 bonus on their 2nd payment",
            },
            {
              label: "They get",
              value: "The $20 setup fee waived, plus our 7-day free trial",
            },
            {
              label: "Tracking",
              value:
                "Anyone who clicks your link is credited to you for 60 days",
            },
            {
              label: "Paid",
              value:
                "Monthly by PayPal once you've earned $25. Commission on a customer becomes payable after their 2nd monthly payment.",
            },
          ]),
        ),
      },
      {
        html: para(
          'One rule we have to ask of everyone: when you share your link, say clearly that you earn a commission (for example, "I earn a commission if you sign up through my link"). In videos, say it out loud in the video. This is an FTC requirement.',
        ),
      },
      {
        html: para(
          "To make sharing easy, we put together a partner kit: ready-to-send emails, social posts, the key talking points and answers to common questions. Just swap in your link.",
        ),
      },
      ...(demoSetupUrl
        ? [
            {
              html: card(
                "Your demo account",
                `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#18181b;">We also set up a demo dashboard you can log into and show people. It's filled with sample customers and reviews, and it never sends real texts or emails, so click around freely.</p><p style="margin:0;font-size:15px;line-height:1.6;color:#18181b;">Set your password here (link works for 7 days): <a href="${demoSetupUrl}" style="color:#18181b;font-weight:700;">Set up my demo login</a>. After that, log in at uptrendscaling.com/login with this email address.</p>`,
              ),
              top: 4,
              bottom: 12,
            },
          ]
        : []),
      {
        html: button(
          "Open your partner kit",
          `${CANONICAL_SITE_URL}/affiliates/kit?ref=${code}`,
        ),
        align: "center",
        top: 12,
        bottom: 12,
      },
      {
        html: para(
          `Program terms are at ${CANONICAL_SITE_URL}/affiliates#terms. Questions? Reply anytime or email ${UPTREND_SUPPORT_EMAIL}.`,
        ),
      },
    ],
    footerLines: [
      "UpTrend Scaling",
      "Google reviews on autopilot for local businesses",
    ],
  });
}

// ---- Admin: the Affiliates tab ---------------------------------------------

export type AffiliateReferral = {
  businessId: string;
  businessName: string;
  email: string;
  signedUpAt: Date;
  accessRevoked: boolean;
  paidPayments: number;
  // Totals in cents over every paid monthly payment so far.
  commissionEarnedCents: number;
  commissionPayableCents: number;
};

export type AffiliateSummary = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  paypalEmail: string | null;
  website: string | null;
  promotePlan: string | null;
  status: Affiliate["status"];
  source: Affiliate["source"];
  hasDemo: boolean;
  code: string | null;
  link: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  referrals: AffiliateReferral[];
  earnedCents: number;
  payableCents: number;
  paidOutCents: number;
  owedCents: number;
};

export type AffiliatesOverviewResult =
  | { ok: true; affiliates: AffiliateSummary[]; stripeChecked: boolean }
  | { ok: false; message: string };

type StripeLike = import("stripe").default;

// 25% of everything paid, plus the one-time bonus once the business has made
// its 2nd payment.
function commissionCentsFor(payments: number[]): number {
  const percent = Math.round(
    payments.reduce((sum, cents) => sum + cents, 0) * AFFILIATE_COMMISSION_RATE,
  );
  const bonus =
    payments.length >= AFFILIATE_PAYABLE_AFTER_PAYMENTS
      ? AFFILIATE_SECOND_PAYMENT_BONUS_DOLLARS * 100
      : 0;
  return percent + bonus;
}

// What a referred business has paid us that earns commission: every paid
// invoice, minus any setup fee on it and minus anything refunded with a credit
// note. Returns per-payment amounts in cents.
async function commissionablePayments(
  stripe: StripeLike,
  stripeCustomerId: string,
): Promise<number[]> {
  const invoices = [];
  for await (const invoice of stripe.invoices.list({
    customer: stripeCustomerId,
    status: "paid",
    limit: 100,
  })) {
    invoices.push(invoice);
    if (invoices.length >= 1000) break;
  }
  const paid = invoices
    .filter((inv) => (inv.amount_paid ?? 0) > 0)
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

  return paid.map((inv) => {
    const setupFee = (inv.lines?.data ?? [])
      .filter((line) => line.description === SETUP_FEE_DESCRIPTION)
      .reduce((sum, line) => sum + Math.max(0, line.amount ?? 0), 0);
    const refunded = inv.post_payment_credit_notes_amount ?? 0;
    return Math.max(0, (inv.amount_paid ?? 0) - setupFee - refunded);
  });
}

export const getAffiliatesOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<AffiliatesOverviewResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }

    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(affiliates)
        .orderBy(desc(affiliates.createdAt));
      const codes = rows
        .map((r) => r.code)
        .filter((c): c is string => Boolean(c));

      const referred = codes.length
        ? await db
            .select({
              id: businesses.id,
              businessName: businesses.businessName,
              email: businesses.email,
              createdAt: businesses.createdAt,
              accessRevoked: businesses.accessRevoked,
              stripeCustomerId: businesses.stripeCustomerId,
              referredBy: businesses.referredBy,
            })
            .from(businesses)
            .where(
              and(
                isNotNull(businesses.referredBy),
                inArray(businesses.referredBy, codes),
              ),
            )
        : [];

      const payouts = await db.select().from(affiliatePayouts);
      const demoEmails = new Set(
        (
          await db
            .select({ email: businesses.email })
            .from(businesses)
            .where(eq(businesses.isDemo, true))
        ).map((b) => b.email.toLowerCase()),
      );

      const secretKey = process.env["STRIPE_SECRET_KEY"];
      let stripe: StripeLike | null = null;
      if (secretKey && referred.length) {
        const { default: Stripe } = await import("stripe");
        stripe = new Stripe(secretKey);
      }

      const referralsByCode = new Map<string, AffiliateReferral[]>();
      for (const biz of referred) {
        let payments: number[] = [];
        if (stripe && biz.stripeCustomerId) {
          try {
            payments = await commissionablePayments(
              stripe,
              biz.stripeCustomerId,
            );
          } catch (error) {
            console.error(
              "[affiliates] failed to read invoices",
              biz.id,
              error,
            );
          }
        }
        const earned = commissionCentsFor(payments);
        const referral: AffiliateReferral = {
          businessId: biz.id,
          businessName: biz.businessName,
          email: biz.email,
          signedUpAt: biz.createdAt,
          accessRevoked: biz.accessRevoked,
          paidPayments: payments.length,
          commissionEarnedCents: earned,
          commissionPayableCents:
            payments.length >= AFFILIATE_PAYABLE_AFTER_PAYMENTS ? earned : 0,
        };
        const key = biz.referredBy ?? "";
        referralsByCode.set(key, [
          ...(referralsByCode.get(key) ?? []),
          referral,
        ]);
      }

      const summaries: AffiliateSummary[] = rows.map((row) => {
        const refs = row.code ? (referralsByCode.get(row.code) ?? []) : [];
        const earnedCents = refs.reduce(
          (s, r) => s + r.commissionEarnedCents,
          0,
        );
        const payableCents = refs.reduce(
          (s, r) => s + r.commissionPayableCents,
          0,
        );
        const paidOutCents = payouts
          .filter((p) => p.affiliateId === row.id)
          .reduce((s, p) => s + p.amountCents, 0);
        return {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          paypalEmail: row.paypalEmail,
          website: row.website,
          promotePlan: row.promotePlan,
          status: row.status,
          source: row.source,
          hasDemo: demoEmails.has(row.email.toLowerCase()),
          code: row.code,
          link: row.code ? affiliateLinkFor(row.code) : null,
          createdAt: row.createdAt,
          approvedAt: row.approvedAt,
          referrals: refs,
          earnedCents,
          payableCents,
          paidOutCents,
          owedCents: Math.max(0, payableCents - paidOutCents),
        };
      });

      return {
        ok: true,
        affiliates: summaries,
        stripeChecked: Boolean(stripe) || referred.length === 0,
      };
    } catch (error) {
      // Most likely the affiliate tables haven't been created yet. Fail soft
      // so the rest of /admin still works.
      console.error("[affiliates] failed to load overview", error);
      return { ok: true, affiliates: [], stripeChecked: false };
    }
  },
);

async function uniqueCodeFor(name: string): Promise<string> {
  const db = getDb();
  const parts = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const base = (parts[0] ?? "partner").slice(0, 16) || "partner";
  const candidates = [
    base,
    parts[1] ? `${base}${parts[1][0]}` : null,
    parts[1] ? `${base}${parts[1]}`.slice(0, 24) : null,
  ].filter((c): c is string => Boolean(c) && CODE_PATTERN.test(c as string));
  for (let i = 2; i < 50; i++) candidates.push(`${base}${i}`);
  for (const candidate of candidates) {
    const [taken] = await db
      .select({ id: affiliates.id })
      .from(affiliates)
      .where(eq(affiliates.code, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}

export type AffiliateActionResult =
  { ok: true; code?: string | null } | { ok: false; message: string };

const statusSchema = z.object({
  affiliateId: z.string().uuid(),
  status: z.enum(["approved", "paused", "rejected"]),
  code: z.string().trim().toLowerCase().max(32).optional(),
});

// Approve (gives them a code and emails their link), pause (their link stops
// working for new signups) or reject an affiliate.
export const setAffiliateStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => statusSchema.parse(input))
  .handler(async ({ data }): Promise<AffiliateActionResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      const db = getDb();
      const [row] = await db
        .select()
        .from(affiliates)
        .where(eq(affiliates.id, data.affiliateId))
        .limit(1);
      if (!row) return { ok: false, message: "Affiliate not found." };

      if (data.status !== "approved") {
        await db
          .update(affiliates)
          .set({ status: data.status })
          .where(eq(affiliates.id, row.id));
        return { ok: true, code: row.code };
      }

      let code = row.code;
      if (!code) {
        const wanted = normalizeRefCode(data.code);
        if (wanted) {
          const [taken] = await db
            .select({ id: affiliates.id })
            .from(affiliates)
            .where(eq(affiliates.code, wanted))
            .limit(1);
          if (taken)
            return {
              ok: false,
              message: `The code "${wanted}" is already taken.`,
            };
          code = wanted;
        } else {
          code = await uniqueCodeFor(row.name);
        }
      }
      const firstApproval = !row.approvedAt;
      await db
        .update(affiliates)
        .set({
          status: "approved",
          code,
          approvedAt: row.approvedAt ?? new Date(),
        })
        .where(eq(affiliates.id, row.id));

      // Partners who applied get a demo account to show people. (Customers
      // referring others already have their own real dashboard.)
      let demoSetupUrl: string | null = null;
      if (firstApproval && row.source === "application") {
        try {
          const demo = await ensureDemoAccount(row);
          if (demo.ok) demoSetupUrl = demo.setupUrl;
        } catch (error) {
          console.error("[affiliates] demo account failed", error);
        }
      }

      if (firstApproval && isResendConfigured()) {
        const sent = await sendEmail(
          row.email,
          "You're in: your UpTrend Scaling affiliate link",
          approvalEmailHtml(row.name, code, demoSetupUrl),
          undefined,
          undefined,
          { idempotencyKey: `affiliate-approved-${row.id}` },
        );
        if (!sent.ok)
          console.error("[affiliates] approval email failed", sent.error);
      }
      return { ok: true, code };
    } catch (error) {
      console.error("[affiliates] failed to update status", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

const payoutSchema = z.object({
  affiliateId: z.string().uuid(),
  amountDollars: z.coerce.number().positive().max(100000),
  note: z.string().trim().max(300).optional().default(""),
});

// Records money already sent by PayPal so "still owed" stays right.
export const recordAffiliatePayout = createServerFn({ method: "POST" })
  .validator((input: unknown) => payoutSchema.parse(input))
  .handler(async ({ data }): Promise<AffiliateActionResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      const db = getDb();
      await db.insert(affiliatePayouts).values({
        affiliateId: data.affiliateId,
        amountCents: Math.round(data.amountDollars * 100),
        note: data.note || null,
      });
      return { ok: true };
    } catch (error) {
      console.error("[affiliates] failed to record payout", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

// ---- Demo accounts (admin) ---------------------------------------------------

// "Create demo" button on the Affiliates tab: makes the partner a demo
// account (or finds the one they have) and emails them a fresh link to set
// their password.
export const sendPartnerDemo = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ affiliateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<AffiliateActionResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      const db = getDb();
      const [row] = await db
        .select()
        .from(affiliates)
        .where(eq(affiliates.id, data.affiliateId))
        .limit(1);
      if (!row) return { ok: false, message: "Partner not found." };
      const demo = await ensureDemoAccount(row);
      if (!demo.ok) return { ok: false, message: demo.message };
      if (!isResendConfigured()) {
        return { ok: false, message: "Email isn't set up, so the link couldn't be sent." };
      }
      const sent = await sendEmail(
        row.email,
        "Your UpTrend Scaling demo account",
        demoInviteEmailHtml(row.name, demo.setupUrl),
      );
      if (!sent.ok) return { ok: false, message: "The email didn't go out. Try again." };
      return { ok: true, code: row.code };
    } catch (error) {
      console.error("[affiliates] failed to send demo", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

function demoInviteEmailHtml(name: string, setupUrl: string): string {
  return emailShell({
    subject: "Your UpTrend Scaling demo account",
    preheader: "A sample dashboard you can show people. It never sends real messages.",
    tagline: "PARTNER PROGRAM",
    sections: [
      { html: para(`Hi ${firstName(name)},`) },
      {
        html: para(
          "Here's your UpTrend Scaling demo account: a real dashboard filled with sample customers and reviews that you can log into and show the businesses you refer. It never sends real texts or emails, so click around freely.",
        ),
      },
      {
        html: button("Set up my demo login", setupUrl),
        align: "center",
        top: 12,
        bottom: 12,
      },
      {
        html: para(
          `The link works for 7 days. After you set a password, log in any time at ${CANONICAL_SITE_URL}/login with this email address.`,
        ),
      },
    ],
    footerLines: ["UpTrend Scaling partner program"],
  });
}

// ---- Customer referrals ------------------------------------------------------

// Every paying customer gets a referral link on the same terms as affiliates.
// Creates their affiliate row the first time it's needed (dashboard panel or
// welcome email). Never for demo or admin accounts. Never throws.
export async function ensureCustomerAffiliate(
  business: Business,
): Promise<Affiliate | null> {
  if (business.isDemo || business.isAdmin || !isDbConfigured()) return null;
  try {
    const db = getDb();
    const [linked] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.businessId, business.id))
      .limit(1);
    if (linked) return linked;

    // Already an affiliate under the same email (applied before signing up):
    // reuse that row so they keep one link.
    const [sameEmail] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.email, business.email.toLowerCase()))
      .orderBy(desc(affiliates.createdAt))
      .limit(1);
    if (sameEmail && sameEmail.status === "approved" && sameEmail.code) {
      const [updated] = await db
        .update(affiliates)
        .set({ businessId: business.id })
        .where(eq(affiliates.id, sameEmail.id))
        .returning();
      return updated ?? sameEmail;
    }

    const code = await uniqueCodeFor(business.businessName);
    const now = new Date();
    const [created] = await db
      .insert(affiliates)
      .values({
        name: business.contactName || business.businessName,
        email: business.email.toLowerCase(),
        status: "approved",
        code,
        approvedAt: now,
        source: "customer",
        businessId: business.id,
        // Customers don't get the partner onboarding check-in emails.
        checkin1SentAt: now,
        checkin2SentAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [raced] = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.businessId, business.id))
      .limit(1);
    return raced ?? null;
  } catch (error) {
    console.error("[affiliates] failed to set up customer referral link", error);
    return null;
  }
}

export type MyReferralResult =
  | {
      ok: true;
      link: string;
      paypalEmail: string | null;
      referrals: number;
      payingReferrals: number;
      earnedCents: number;
      paidOutCents: number;
    }
  | { ok: false; message: string };

// The "Refer a business" panel in the customer dashboard.
export const getMyReferral = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyReferralResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };
    try {
      const db = getDb();
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business || business.isDemo || business.isAdmin || business.accessRevoked) {
        return { ok: false, message: "Not available for this account." };
      }
      const affiliate = await ensureCustomerAffiliate(business);
      if (!affiliate?.code) return { ok: false, message: "Not available yet." };

      const referred = await db
        .select({
          stripeCustomerId: businesses.stripeCustomerId,
        })
        .from(businesses)
        .where(eq(businesses.referredBy, affiliate.code));

      let earnedCents = 0;
      let payingReferrals = 0;
      const secretKey = process.env["STRIPE_SECRET_KEY"];
      if (secretKey && referred.length) {
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(secretKey);
        for (const biz of referred) {
          if (!biz.stripeCustomerId) continue;
          try {
            const payments = await commissionablePayments(stripe, biz.stripeCustomerId);
            if (payments.length) payingReferrals += 1;
            earnedCents += commissionCentsFor(payments);
          } catch (error) {
            console.error("[affiliates] failed to read referral invoices", error);
          }
        }
      }
      const paidOutCents = (
        await db
          .select({ amountCents: affiliatePayouts.amountCents })
          .from(affiliatePayouts)
          .where(eq(affiliatePayouts.affiliateId, affiliate.id))
      ).reduce((sum, p) => sum + p.amountCents, 0);

      return {
        ok: true,
        link: affiliateLinkFor(affiliate.code),
        paypalEmail: affiliate.paypalEmail,
        referrals: referred.length,
        payingReferrals,
        earnedCents,
        paidOutCents,
      };
    } catch (error) {
      console.error("[affiliates] failed to load referral panel", error);
      return { ok: false, message: "Something went wrong." };
    }
  },
);

export const saveMyPayPal = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        paypalEmail: z
          .string()
          .trim()
          .toLowerCase()
          .email("Enter the email on your PayPal account")
          .max(254),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };
    try {
      const db = getDb();
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business) return { ok: false, message: "Not signed in." };
      const affiliate = await ensureCustomerAffiliate(business);
      if (!affiliate) return { ok: false, message: "Not available for this account." };
      await db
        .update(affiliates)
        .set({ paypalEmail: data.paypalEmail })
        .where(eq(affiliates.id, affiliate.id));
      return { ok: true };
    } catch (error) {
      console.error("[affiliates] failed to save PayPal email", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

