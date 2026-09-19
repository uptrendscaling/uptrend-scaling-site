// The CRM itself: business accounts, customers, and the automated
// SMS/email review-request pipeline. Everything here is dormant-safe --
// every exported server function checks isDbConfigured()/isAuthConfigured()
// first and returns a friendly "not_configured" result instead of throwing,
// so the site keeps working normally before the database is provisioned.

import { randomUUID } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseStatus } from "@tanstack/react-start/server";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";

import {
  clearBusinessSession,
  createBusinessSession,
  createPasswordResetToken,
  getSessionBusinessId,
  hashPassword,
  isAuthConfigured,
  verifyPassword,
  verifyPasswordResetToken,
} from "./auth.server";
import { getDb, isDbConfigured } from "./db/client";
import { businesses, customers, messages, type Business, type Customer } from "./db/schema";
import { CANONICAL_SITE_URL } from "./site";
import {
  initialEmailHtml,
  initialEmailSubject,
  initialSmsBody,
  isResendConfigured,
  isTwilioConfigured,
  reminderEmailHtml,
  reminderEmailSubject,
  reminderSmsBody,
  resetPasswordEmailHtml,
  resetPasswordEmailSubject,
  reviewLinkFor,
  sendEmail,
  sendSms,
  UPTREND_SUPPORT_EMAIL,
  welcomeEmailHtml,
  welcomeEmailSubject,
} from "./messaging.server";

const REMINDER_DELAY_MS = 48 * 60 * 60 * 1000;

export function isCrmConfigured(): boolean {
  return isDbConfigured() && isAuthConfigured();
}

// Public shape of a business -- never send the password hash to the client.
export type PublicBusiness = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  locations: number;
  plan: string | null;
  googleReviewUrl: string | null;
};

function toPublicBusiness(business: Business): PublicBusiness {
  return {
    id: business.id,
    businessName: business.businessName,
    contactName: business.contactName,
    email: business.email,
    phone: business.phone,
    locations: business.locations,
    plan: business.plan,
    googleReviewUrl: business.googleReviewUrl,
  };
}

// ---- Account claiming (from /start/success) ------------------------------

const claimInputSchema = z.object({
  sessionId: z.string().trim().min(1),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export type ClaimResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_configured" | "not_found" | "already_claimed" | "error";
      message: string;
    };

// Turns a completed Stripe Checkout session into a logged-in CRM account.
// Runs entirely off the Stripe session itself (no webhook dependency): we
// re-verify the session server-side with the secret key, then create or
// update the matching business row and set their password.
export const claimBusinessAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => claimInputSchema.parse(input))
  .handler(async ({ data }): Promise<ClaimResult> => {
    const secretKey = process.env["STRIPE_SECRET_KEY"];
    if (!secretKey || !isCrmConfigured()) {
      return {
        ok: false,
        reason: "not_configured",
        message: "Account setup isn't switched on yet -- check back soon.",
      };
    }

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);

      const email = session.customer_details?.email ?? session.customer_email ?? null;
      if (!email) {
        return {
          ok: false,
          reason: "not_found",
          message: "We couldn't find that checkout session.",
        };
      }

      const metadata = session.metadata ?? {};
      const businessName =
        typeof metadata["businessName"] === "string" ? metadata["businessName"] : "";
      const contactName =
        typeof metadata["contactName"] === "string" ? metadata["contactName"] : "";
      const phone = typeof metadata["phone"] === "string" ? metadata["phone"] : "";
      const locationsRaw =
        typeof metadata["locations"] === "string" ? Number(metadata["locations"]) : 1;
      const locations =
        Number.isFinite(locationsRaw) && locationsRaw > 0 ? Math.round(locationsRaw) : 1;
      const plan = typeof metadata["plan"] === "string" ? metadata["plan"] : null;
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
      const stripeSubscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;

      const db = getDb();
      const [existing] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.email, email))
        .limit(1);

      if (existing?.passwordHash) {
        return {
          ok: false,
          reason: "already_claimed",
          message: "This account already has a password. Try logging in instead.",
        };
      }

      const passwordHash = await hashPassword(data.password);

      let businessId: string;
      let welcomeBusinessName: string;
      let welcomeContactName: string;
      if (existing) {
        businessId = existing.id;
        welcomeBusinessName = existing.businessName;
        welcomeContactName = existing.contactName;
        await db
          .update(businesses)
          .set({
            passwordHash,
            stripeCustomerId,
            stripeSubscriptionId,
            plan: plan === "trial" || plan === "membership" ? plan : existing.plan,
          })
          .where(eq(businesses.id, existing.id));
      } else {
        welcomeBusinessName = businessName || "New business";
        welcomeContactName = contactName || "Owner";
        const [created] = await db
          .insert(businesses)
          .values({
            businessName: welcomeBusinessName,
            contactName: welcomeContactName,
            email,
            phone: phone || "",
            locations,
            passwordHash,
            stripeCustomerId,
            stripeSubscriptionId,
            plan: plan === "trial" || plan === "membership" ? plan : null,
          })
          .returning({ id: businesses.id });
        if (!created) {
          return {
            ok: false,
            reason: "error",
            message: "Could not create your account. Please try again.",
          };
        }
        businessId = created.id;
      }

      // Best-effort: a failed welcome email should never block account
      // creation. Dormant until RESEND_API_KEY is configured, same as the
      // rest of the messaging pipeline.
      if (isResendConfigured()) {
        const result = await sendEmail(
          email,
          welcomeEmailSubject(),
          welcomeEmailHtml(welcomeBusinessName, welcomeContactName),
          UPTREND_SUPPORT_EMAIL,
        );
        if (!result.ok) {
          console.error("[reviews] failed to send welcome email", result.error);
        }
      }

      await createBusinessSession(businessId);
      return { ok: true };
    } catch (error) {
      console.error("[reviews] failed to claim business account", error);
      return { ok: false, reason: "error", message: "Something went wrong. Please try again." };
    }
  });

// ---- Login / logout / session --------------------------------------------

const loginInputSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export type LoginResult = { ok: true } | { ok: false; message: string };

export const loginBusiness = createServerFn({ method: "POST" })
  .validator((input: unknown) => loginInputSchema.parse(input))
  .handler(async ({ data }): Promise<LoginResult> => {
    if (!isCrmConfigured()) {
      return { ok: false, message: "Sign-in isn't switched on yet -- check back soon." };
    }

    try {
      const db = getDb();
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.email, data.email))
        .limit(1);

      if (!business?.passwordHash) {
        return { ok: false, message: "No account found with that email." };
      }

      const valid = await verifyPassword(data.password, business.passwordHash);
      if (!valid) {
        return { ok: false, message: "Incorrect email or password." };
      }

      await createBusinessSession(business.id);
      return { ok: true };
    } catch (error) {
      console.error("[reviews] failed to log in", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

export const logoutBusiness = createServerFn({ method: "POST" }).handler(async () => {
  await clearBusinessSession();
  return { ok: true };
});

export const getCurrentBusiness = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicBusiness | null> => {
    if (!isCrmConfigured()) return null;
    const businessId = await getSessionBusinessId();
    if (!businessId) return null;

    const db = getDb();
    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return business ? toPublicBusiness(business) : null;
  },
);

async function requireBusinessId(): Promise<string> {
  const businessId = await getSessionBusinessId();
  if (!businessId) throw new Error("Not signed in.");
  return businessId;
}

// ---- Forgot / reset password -----------------------------------------
// Stateless reset tokens (see auth.server.ts) -- no extra database table.
// requestPasswordReset always returns the same generic result regardless of
// whether the email matches an account, so this can't be used to check
// which emails have signed up.

const requestResetSchema = z.object({ email: z.string().trim().email() });

export type RequestResetResult =
  { ok: true } | { ok: false; reason: "not_configured"; message: string };

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: unknown) => requestResetSchema.parse(input))
  .handler(async ({ data }): Promise<RequestResetResult> => {
    if (!isCrmConfigured()) {
      return {
        ok: false,
        reason: "not_configured",
        message: "Password reset isn't switched on yet -- check back soon.",
      };
    }
    if (!isResendConfigured()) {
      return {
        ok: false,
        reason: "not_configured",
        message:
          "Automatic reset emails aren't live yet. Email hello@uptrendscaling.com and we'll reset it by hand.",
      };
    }

    try {
      const db = getDb();
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.email, data.email))
        .limit(1);

      // Always looks like success to the caller -- only actually sends when
      // there's a claimed account with that email.
      if (business?.passwordHash) {
        const token = createPasswordResetToken(business.id);
        const resetUrl = `${CANONICAL_SITE_URL}/reset-password?token=${encodeURIComponent(token)}`;
        const result = await sendEmail(
          business.email,
          resetPasswordEmailSubject(),
          resetPasswordEmailHtml(business.contactName, resetUrl),
          UPTREND_SUPPORT_EMAIL,
        );
        if (!result.ok) {
          console.error("[reviews] failed to send password reset email", result.error);
        }
      }

      return { ok: true };
    } catch (error) {
      console.error("[reviews] failed to request password reset", error);
      // Still reports success so as not to leak whether the email exists.
      return { ok: true };
    }
  });

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid_token" | "not_configured" | "error"; message: string };

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => resetPasswordSchema.parse(input))
  .handler(async ({ data }): Promise<ResetPasswordResult> => {
    if (!isCrmConfigured()) {
      return {
        ok: false,
        reason: "not_configured",
        message: "Password reset isn't switched on yet -- check back soon.",
      };
    }

    const verified = verifyPasswordResetToken(data.token);
    if (!verified) {
      return {
        ok: false,
        reason: "invalid_token",
        message: "This reset link is invalid or has expired. Request a new one.",
      };
    }

    try {
      const db = getDb();
      const passwordHash = await hashPassword(data.password);
      await db
        .update(businesses)
        .set({ passwordHash })
        .where(eq(businesses.id, verified.businessId));

      await createBusinessSession(verified.businessId);
      return { ok: true };
    } catch (error) {
      console.error("[reviews] failed to reset password", error);
      return { ok: false, reason: "error", message: "Something went wrong. Please try again." };
    }
  });

// ---- Settings --------------------------------------------------------

const updateReviewUrlSchema = z.object({
  googleReviewUrl: z.string().trim().url("Enter a valid URL").max(500),
});

export const updateGoogleReviewUrl = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateReviewUrlSchema.parse(input))
  .handler(async ({ data }) => {
    if (!isCrmConfigured()) return { ok: false as const, message: "Not configured yet." };
    try {
      const businessId = await requireBusinessId();
      const db = getDb();
      await db
        .update(businesses)
        .set({ googleReviewUrl: data.googleReviewUrl })
        .where(eq(businesses.id, businessId));
      return { ok: true as const };
    } catch (error) {
      console.error("[reviews] failed to update google review url", error);
      return { ok: false as const, message: "Something went wrong." };
    }
  });

// ---- Customers + automated sending ---------------------------------------

const addCustomerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  })
  .refine((value) => Boolean(value.phone) || Boolean(value.email), {
    message: "Add a phone number or an email so we can reach them.",
  });

export type AddCustomerResult =
  { ok: true; smsSent: boolean | null; emailSent: boolean | null } | { ok: false; message: string };

// Creates a customer AND immediately fires off their review request on
// every channel we have contact info + a live provider for. This is the
// "fully automate all of that work" entry point -- Colby never sends
// anything by hand.
export const addCustomer = createServerFn({ method: "POST" })
  .validator((input: unknown) => addCustomerSchema.parse(input))
  .handler(async ({ data }): Promise<AddCustomerResult> => {
    if (!isCrmConfigured()) {
      return { ok: false, message: "The CRM isn't switched on yet -- check back soon." };
    }

    try {
      const businessId = await requireBusinessId();
      const db = getDb();
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business) return { ok: false, message: "Your account could not be found." };

      const phone = data.phone?.trim() || null;
      const email = data.email?.trim() || null;
      const reviewToken = randomUUID();

      const [customer] = await db
        .insert(customers)
        .values({ businessId, name: data.name, phone, email, reviewToken })
        .returning();
      if (!customer) return { ok: false, message: "Could not create that customer." };

      const link = reviewLinkFor(reviewToken);
      let smsSent: boolean | null = null;
      let emailSent: boolean | null = null;

      if (phone && isTwilioConfigured()) {
        const result = await sendSms(phone, initialSmsBody(business.businessName, data.name, link));
        smsSent = result.ok;
        await db.insert(messages).values({
          businessId,
          customerId: customer.id,
          channel: "sms",
          kind: "initial",
          status: result.ok ? "sent" : "failed",
          providerMessageId: result.ok ? result.providerMessageId : null,
          errorMessage: result.ok ? null : result.error,
        });
      }

      if (email && isResendConfigured()) {
        const result = await sendEmail(
          email,
          initialEmailSubject(business.businessName),
          initialEmailHtml(business.businessName, data.name, link),
        );
        emailSent = result.ok;
        await db.insert(messages).values({
          businessId,
          customerId: customer.id,
          channel: "email",
          kind: "initial",
          status: result.ok ? "sent" : "failed",
          providerMessageId: result.ok ? result.providerMessageId : null,
          errorMessage: result.ok ? null : result.error,
        });
      }

      return { ok: true, smsSent, emailSent };
    } catch (error) {
      console.error("[reviews] failed to add customer", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

const resendInputSchema = z.object({ customerId: z.string().trim().min(1) });

export type ResendResult =
  { ok: true; smsSent: boolean | null; emailSent: boolean | null } | { ok: false; message: string };

// Manually re-fires the same review request a customer already got -- for
// the "they never saw it" case. Logged as its own "manual" message kind so
// it's distinguishable from the automatic initial send in the message log.
export const resendReviewRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => resendInputSchema.parse(input))
  .handler(async ({ data }): Promise<ResendResult> => {
    if (!isCrmConfigured()) {
      return { ok: false, message: "The CRM isn't switched on yet -- check back soon." };
    }

    try {
      const businessId = await requireBusinessId();
      const db = getDb();
      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, data.customerId), eq(customers.businessId, businessId)))
        .limit(1);
      if (!customer) return { ok: false, message: "Customer not found." };

      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business) return { ok: false, message: "Your account could not be found." };

      const link = reviewLinkFor(customer.reviewToken);
      let smsSent: boolean | null = null;
      let emailSent: boolean | null = null;

      if (customer.phone && isTwilioConfigured()) {
        const result = await sendSms(
          customer.phone,
          initialSmsBody(business.businessName, customer.name, link),
        );
        smsSent = result.ok;
        await db.insert(messages).values({
          businessId,
          customerId: customer.id,
          channel: "sms",
          kind: "manual",
          status: result.ok ? "sent" : "failed",
          providerMessageId: result.ok ? result.providerMessageId : null,
          errorMessage: result.ok ? null : result.error,
        });
      }

      if (customer.email && isResendConfigured()) {
        const result = await sendEmail(
          customer.email,
          initialEmailSubject(business.businessName),
          initialEmailHtml(business.businessName, customer.name, link),
        );
        emailSent = result.ok;
        await db.insert(messages).values({
          businessId,
          customerId: customer.id,
          channel: "email",
          kind: "manual",
          status: result.ok ? "sent" : "failed",
          providerMessageId: result.ok ? result.providerMessageId : null,
          errorMessage: result.ok ? null : result.error,
        });
      }

      if (smsSent === null && emailSent === null) {
        const hasContact = Boolean(customer.phone || customer.email);
        return {
          ok: false,
          message: hasContact
            ? "No messaging provider is connected yet -- check back soon."
            : "This customer has no phone number or email on file.",
        };
      }

      return { ok: true, smsSent, emailSent };
    } catch (error) {
      console.error("[reviews] failed to resend review request", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

export type CustomerRow = Customer & {
  smsCount: number;
  emailCount: number;
};

export const listCustomers = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerRow[]> => {
    if (!isCrmConfigured()) return [];
    const businessId = await getSessionBusinessId();
    if (!businessId) return [];

    const db = getDb();
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.businessId, businessId))
      .orderBy(desc(customers.createdAt));

    if (rows.length === 0) return [];

    const customerIds = rows.map((row) => row.id);
    const messageRows = await db
      .select()
      .from(messages)
      .where(inArray(messages.customerId, customerIds));

    return rows.map((row) => ({
      ...row,
      smsCount: messageRows.filter(
        (m) => m.customerId === row.id && m.channel === "sms" && m.status === "sent",
      ).length,
      emailCount: messageRows.filter(
        (m) => m.customerId === row.id && m.channel === "email" && m.status === "sent",
      ).length,
    }));
  },
);

const markReviewedSchema = z.object({ customerId: z.string().trim().min(1) });

export const markCustomerReviewed = createServerFn({ method: "POST" })
  .validator((input: unknown) => markReviewedSchema.parse(input))
  .handler(async ({ data }) => {
    if (!isCrmConfigured()) return { ok: false as const };
    try {
      const businessId = await requireBusinessId();
      const db = getDb();
      const [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, data.customerId), eq(customers.businessId, businessId)))
        .limit(1);
      if (!customer) return { ok: false as const };

      await db
        .update(customers)
        .set({ markedReviewedAt: customer.markedReviewedAt ? null : new Date() })
        .where(eq(customers.id, customer.id));

      return { ok: true as const };
    } catch (error) {
      console.error("[reviews] failed to toggle marked-reviewed", error);
      return { ok: false as const };
    }
  });

export type DashboardStats = {
  totalCustomers: number;
  messagesSent: number;
  messagesFailed: number;
  linkClicks: number;
  reviewedCount: number;
};

export const getDashboardStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardStats | null> => {
    if (!isCrmConfigured()) return null;
    const businessId = await getSessionBusinessId();
    if (!businessId) return null;

    const db = getDb();
    const [customerRows, messageRows] = await Promise.all([
      db.select().from(customers).where(eq(customers.businessId, businessId)),
      db.select().from(messages).where(eq(messages.businessId, businessId)),
    ]);

    return {
      totalCustomers: customerRows.length,
      messagesSent: messageRows.filter((m) => m.status === "sent").length,
      messagesFailed: messageRows.filter((m) => m.status === "failed").length,
      linkClicks: customerRows.filter((c) => c.linkClickedAt).length,
      reviewedCount: customerRows.filter((c) => c.markedReviewedAt).length,
    };
  },
);

// ---- Public review-link redirect (/r/$token) ------------------------------

const redirectInputSchema = z.object({ token: z.string().trim().min(1) });

export type ReviewRedirectResult = { url: string };

export const resolveReviewRedirect = createServerFn({ method: "GET" })
  .validator((input: unknown) => redirectInputSchema.parse(input))
  .handler(async ({ data }): Promise<ReviewRedirectResult> => {
    const fallback = "https://www.uptrendscaling.com";
    if (!isDbConfigured()) return { url: fallback };

    try {
      const db = getDb();
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.reviewToken, data.token))
        .limit(1);
      if (!customer) return { url: fallback };

      if (!customer.linkClickedAt) {
        await db
          .update(customers)
          .set({ linkClickedAt: new Date() })
          .where(eq(customers.id, customer.id));
      }

      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, customer.businessId))
        .limit(1);

      return { url: business?.googleReviewUrl || fallback };
    } catch (error) {
      console.error("[reviews] failed to resolve review redirect", error);
      return { url: fallback };
    }
  });

// ---- Automated 48-hour reminder (driven by Vercel Cron) -------------------

export type ReminderRunResult =
  { ok: true; sent: number } | { ok: false; reason: "not_configured" };

// Finds every customer who hasn't clicked their review link, hasn't already
// gotten a reminder, and was created more than 48 hours ago, and sends them
// exactly one reminder. Called by the /cron/reminders route on a schedule --
// never invoked directly by a user.
export async function sendDueReminders(): Promise<ReminderRunResult> {
  if (!isDbConfigured()) return { ok: false, reason: "not_configured" };

  const db = getDb();
  const cutoff = new Date(Date.now() - REMINDER_DELAY_MS);

  const due = await db
    .select()
    .from(customers)
    .where(
      and(
        isNull(customers.reminderSentAt),
        isNull(customers.linkClickedAt),
        isNull(customers.markedReviewedAt),
        lt(customers.createdAt, cutoff),
      ),
    );

  let sent = 0;
  for (const customer of due) {
    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, customer.businessId))
      .limit(1);
    if (!business) continue;

    const link = reviewLinkFor(customer.reviewToken);

    if (customer.phone && isTwilioConfigured()) {
      const result = await sendSms(
        customer.phone,
        reminderSmsBody(business.businessName, customer.name, link),
      );
      await db.insert(messages).values({
        businessId: business.id,
        customerId: customer.id,
        channel: "sms",
        kind: "reminder",
        status: result.ok ? "sent" : "failed",
        providerMessageId: result.ok ? result.providerMessageId : null,
        errorMessage: result.ok ? null : result.error,
      });
    }

    if (customer.email && isResendConfigured()) {
      const result = await sendEmail(
        customer.email,
        reminderEmailSubject(business.businessName),
        reminderEmailHtml(business.businessName, customer.name, link),
      );
      await db.insert(messages).values({
        businessId: business.id,
        customerId: customer.id,
        channel: "email",
        kind: "reminder",
        status: result.ok ? "sent" : "failed",
        providerMessageId: result.ok ? result.providerMessageId : null,
        errorMessage: result.ok ? null : result.error,
      });
    }

    await db
      .update(customers)
      .set({ reminderSentAt: new Date() })
      .where(eq(customers.id, customer.id));
    sent += 1;
  }

  return { ok: true, sent };
}

// Verifies the request came from our own Vercel Cron job (Vercel signs
// scheduled requests with a Bearer token matching CRON_SECRET) rather than
// from anyone who happens to find the URL.
function isCronRequestAuthorized(): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  const auth = getRequestHeader("authorization");
  return auth === `Bearer ${expected}`;
}

export type CronRunResult = ReminderRunResult | { ok: false; reason: "unauthorized" };

// Entry point for the /cron/reminders route's loader. Wrapped in
// createServerFn (rather than a plain function) so its body -- and the raw
// setResponseStatus/getRequestHeader calls it makes -- is compiled out of
// the client bundle entirely instead of just being called from one.
export const runReminderCron = createServerFn({ method: "GET" }).handler(
  async (): Promise<CronRunResult> => {
    if (!isCronRequestAuthorized()) {
      setResponseStatus(401);
      return { ok: false, reason: "unauthorized" };
    }

    const result = await sendDueReminders();
    setResponseStatus(200);
    return result;
  },
);
