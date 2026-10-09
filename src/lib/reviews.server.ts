// The CRM itself: business accounts, customers, and the automated
// SMS/email review-request pipeline. Everything here is dormant-safe --
// every exported server function checks isDbConfigured()/isAuthConfigured()
// first and returns a friendly "not_configured" result instead of throwing,
// so the site keeps working normally before the database is provisioned.

import { randomUUID } from "node:crypto";
import { tokenToUuid } from "./short-token";

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
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
import {
  businesses,
  customers,
  messages,
  type Business,
  type Customer,
  type Message,
} from "./db/schema";
import type { CustomerSource } from "./crm/providers";
import { monthlyRequestLimit, tierById } from "./pricing";
import { CANONICAL_SITE_URL } from "./site";
import {
  initialEmailHtml,
  initialEmailSubject,
  initialSmsBody,
  isResendConfigured,
  isTelnyxConfigured,
  normalizeEmail,
  normalizeUsPhone,
  reminderEmailHtml,
  reminderEmailSubject,
  reminderSmsBody,
  resetPasswordEmailHtml,
  resetPasswordEmailSubject,
  reviewLinkFor,
  shortReviewLinkFor,
  sendEmail,
  sendSms,
  TRUSTPILOT_AFS_BCC_EMAIL,
  UPTREND_SUPPORT_EMAIL,
  welcomeEmailHtml,
  welcomeEmailSubject,
} from "./messaging.server";

const REMINDER_DELAY_MS = 48 * 60 * 60 * 1000;
// A reminder that failed to send is retried by each daily run, but only for
// customers added within this window: a "quick reminder" a month late reads
// as spam, not as a nudge.
const REMINDER_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  isAdmin: boolean;
  accessRevoked: boolean;
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
    isAdmin: business.isAdmin,
    accessRevoked: business.accessRevoked,
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
        message: "Account setup isn't switched on yet. Check back soon.",
      };
    }

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);

      const email =
        session.customer_details?.email ?? session.customer_email ?? null;
      if (!email) {
        return {
          ok: false,
          reason: "not_found",
          message: "We couldn't find that checkout session.",
        };
      }

      const metadata = session.metadata ?? {};
      const businessName =
        typeof metadata["businessName"] === "string"
          ? metadata["businessName"]
          : "";
      const contactName =
        typeof metadata["contactName"] === "string"
          ? metadata["contactName"]
          : "";
      const phone =
        typeof metadata["phone"] === "string" ? metadata["phone"] : "";
      const locationsRaw =
        typeof metadata["locations"] === "string"
          ? Number(metadata["locations"])
          : 1;
      const locations =
        Number.isFinite(locationsRaw) && locationsRaw > 0
          ? Math.round(locationsRaw)
          : 1;
      const plan =
        typeof metadata["plan"] === "string" ? metadata["plan"] : null;
      const stripeCustomerId =
        typeof session.customer === "string" ? session.customer : null;
      const stripeSubscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;
      const tier = tierById(
        typeof metadata["tier"] === "string" ? metadata["tier"] : null,
      ).id;
      // Set when they signed up through an affiliate link (checkout.server.ts).
      const referredBy =
        typeof metadata["affiliate"] === "string" && metadata["affiliate"]
          ? metadata["affiliate"]
          : null;

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
          message:
            "This account already has a password. Try logging in instead.",
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
            referredBy: existing.referredBy ?? referredBy,
            tier,
            plan:
              plan === "trial" || plan === "membership" ? plan : existing.plan,
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
            referredBy,
            tier,
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
      // rest of the messaging pipeline. BCC'd to Trustpilot's AFS address so
      // this first "purchase experience" triggers a review invite about a
      // week later -- see TRUSTPILOT_AFS_BCC_EMAIL.
      if (isResendConfigured()) {
        const result = await sendEmail(
          email,
          welcomeEmailSubject(),
          welcomeEmailHtml(welcomeBusinessName, welcomeContactName),
          UPTREND_SUPPORT_EMAIL,
          TRUSTPILOT_AFS_BCC_EMAIL,
        );
        if (!result.ok) {
          console.error("[reviews] failed to send welcome email", result.error);
        }
      }

      // The "new subscriber" heads-up to hello@ is no longer sent from here.
      // It only fired once the client had set a password (so a signup that
      // never finished this page was never reported) and carried no amounts.
      // It now comes from the Stripe webhook the moment checkout completes,
      // with the amount due, trial dates and Stripe links: see
      // ./owner-alerts.server.ts.

      await createBusinessSession(businessId);
      return { ok: true };
    } catch (error) {
      console.error("[reviews] failed to claim business account", error);
      return {
        ok: false,
        reason: "error",
        message: "Something went wrong. Please try again.",
      };
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
      return {
        ok: false,
        message: "Sign-in isn't switched on yet. Check back soon.",
      };
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

export const logoutBusiness = createServerFn({ method: "POST" }).handler(
  async () => {
    await clearBusinessSession();
    return { ok: true };
  },
);

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
        message: "Password reset isn't switched on yet. Check back soon.",
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
          console.error(
            "[reviews] failed to send password reset email",
            result.error,
          );
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
  | {
      ok: false;
      reason: "invalid_token" | "not_configured" | "error";
      message: string;
    };

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => resetPasswordSchema.parse(input))
  .handler(async ({ data }): Promise<ResetPasswordResult> => {
    if (!isCrmConfigured()) {
      return {
        ok: false,
        reason: "not_configured",
        message: "Password reset isn't switched on yet. Check back soon.",
      };
    }

    const verified = verifyPasswordResetToken(data.token);
    if (!verified) {
      return {
        ok: false,
        reason: "invalid_token",
        message:
          "This reset link is invalid or has expired. Request a new one.",
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
      return {
        ok: false,
        reason: "error",
        message: "Something went wrong. Please try again.",
      };
    }
  });

// ---- Settings --------------------------------------------------------

const updateReviewUrlSchema = z.object({
  googleReviewUrl: z.string().trim().url("Enter a valid URL").max(500),
});

export const updateGoogleReviewUrl = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateReviewUrlSchema.parse(input))
  .handler(async ({ data }) => {
    if (!isCrmConfigured())
      return { ok: false as const, message: "Not configured yet." };
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

// Sends a review-request message on every channel we have contact info +
// a live provider for, and logs each attempt to the `messages` table. Shared
// by every entry point that needs to message a customer -- manual add,
// manual resend, the 48-hour reminder cron, and (new) a CRM webhook --  so
// the send/log logic and copy templates only live in one place.
type ReviewRequestKind = "initial" | "manual" | "reminder";

// ---- Quiet hours for texts --------------------------------------------------
//
// Review texts only go out between 10am and 7pm in the business's own time
// zone (Settings, default America/Phoenix). That keeps every text well inside
// the federal 8am to 9pm calling window and the stricter state ones, and
// nobody gets a review request at 11pm because the plumber closed out a job
// late. A text that comes due outside those hours is held on the customer row
// (heldSmsKind/heldSmsAt) and sent by the next scheduled run that lands in
// daytime for that business (see sendHeldTexts, run twice a day). Emails are
// not affected and still go out right away.
export const TEXT_WINDOW_START_HOUR = 10; // 10:00am, inclusive
export const TEXT_WINDOW_END_HOUR = 19; // 7:00pm, exclusive

// A held text older than this is dropped instead of sent: a review request
// days after the job reads as spam, and the email already went out.
const HELD_TEXT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const FALLBACK_TIME_ZONE = "America/Phoenix";

function usableTimeZone(value: string | null | undefined): string {
  const candidate = value?.trim() || FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

// The hour (0 to 23) on the wall clock in `timeZone` at `now`.
export function localHourIn(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: usableTimeZone(timeZone),
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  return Number(hour ?? 0) % 24;
}

export function isWithinTextingHours(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const hour = localHourIn(timeZone, now);
  return hour >= TEXT_WINDOW_START_HOUR && hour < TEXT_WINDOW_END_HOUR;
}

function smsBodyFor(
  kind: ReviewRequestKind,
  business: Pick<Business, "businessName">,
  customer: Pick<Customer, "name" | "reviewToken">,
): string {
  // Short link so the whole text fits in one SMS (see initialSmsBody).
  const link = shortReviewLinkFor(customer.reviewToken);
  return kind === "reminder"
    ? reminderSmsBody(business.businessName, customer.name, link)
    : initialSmsBody(business.businessName, customer.name, link);
}

// True when the business has filled in its Google review link. Without it a
// customer's tracked link (/r/:token) can only fall back to our own homepage,
// so nothing automatic may go out until the owner has set it.
export function hasReviewLink(business: Pick<Business, "googleReviewUrl">) {
  return Boolean(business.googleReviewUrl?.trim());
}

// Friendly text for the manual add-customer form and resend button (and
// anything else a person reads directly). The review link field lives in
// Settings, and on the Overview checklist while it is still missing.
export const NO_REVIEW_LINK_MESSAGE =
  "Add your Google review link first (you can do that in Settings), so your customers have somewhere to leave their review. Then try again.";

export type SendRequestOptions = {
  // A stable id for this one send, e.g. the CRM webhook's per-invoice key.
  // Becomes Resend's Idempotency-Key, so a retry after a crash can never email
  // the same person twice for the same paid invoice.
  sendKey?: string | undefined;
  // Set when this is a retry of a send an earlier attempt already started
  // (the claim was re-taken after a crash or failure). Any channel already
  // logged for this customer since this moment is NOT sent again; its logged
  // result is reported instead.
  alreadyAttemptedSince?: Date | undefined;
};

export type SendOutcome = {
  // true = sent, false = tried and failed, null = not attempted (no contact
  // info for the channel, or the provider isn't configured yet).
  smsSent: boolean | null;
  emailSent: boolean | null;
  smsError: string | null;
  emailError: string | null;
  // true = the text was not sent now because it's outside 10am to 7pm where
  // the business is; it is waiting and goes out with the next daytime run.
  smsHeld: boolean;
};

// A failed insert into the message log must never throw: by then the message
// has already left, and a throw would make a CRM webhook look failed and be
// retried, texting the customer a second time.
async function logMessage(
  db: ReturnType<typeof getDb>,
  row: typeof messages.$inferInsert,
): Promise<void> {
  try {
    await db.insert(messages).values(row);
  } catch (error) {
    console.error("[reviews] failed to log a sent message", error);
  }
}

async function sendReviewRequestAndLog(
  db: ReturnType<typeof getDb>,
  business: Business,
  customer: Pick<Customer, "id" | "name" | "phone" | "email" | "reviewToken">,
  kind: ReviewRequestKind,
  options: SendRequestOptions = {},
): Promise<SendOutcome> {
  const link = reviewLinkFor(customer.reviewToken);
  const smsBody = smsBodyFor(kind, business, customer);
  const emailSubject =
    kind === "reminder"
      ? reminderEmailSubject(business.businessName)
      : initialEmailSubject(business.businessName);
  const emailHtml =
    kind === "reminder"
      ? reminderEmailHtml(business.businessName, customer.name, link)
      : initialEmailHtml(business.businessName, customer.name, link);

  // Older rows (and hand-typed manual entries) may hold a number in any
  // format. Telnyx only accepts E.164, so normalize here; a number that can't
  // be normalized is treated as "no phone" rather than sent and rejected.
  const phone = normalizeUsPhone(customer.phone);
  const email = normalizeEmail(customer.email);

  let smsSent: boolean | null = null;
  let emailSent: boolean | null = null;
  let smsError: string | null = null;
  let emailError: string | null = null;
  let smsHeld = false;

  // Retry of an earlier, interrupted attempt: find which channels it already
  // got to, so each channel is attempted at most once per paid invoice.
  const earlier = new Map<
    "sms" | "email",
    { sent: boolean; error: string | null }
  >();
  if (options.alreadyAttemptedSince) {
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.customerId, customer.id),
          eq(messages.kind, kind),
          gte(messages.sentAt, options.alreadyAttemptedSince),
        ),
      );
    for (const row of rows) {
      const previous = earlier.get(row.channel);
      // If a channel was logged twice, "sent" wins.
      if (!previous || row.status === "sent") {
        earlier.set(row.channel, {
          sent: row.status === "sent",
          error: row.errorMessage,
        });
      }
    }
  }

  // Each channel is independent: a failed, slow or unconfigured text must
  // never stop the email, and the other way round.
  if (phone && isTelnyxConfigured()) {
    const done = earlier.get("sms");
    if (done) {
      smsSent = done.sent;
      smsError = done.error;
    } else if (!isWithinTextingHours(business.timezone)) {
      // Quiet hours: park the text for the next daytime run instead.
      smsHeld = await holdText(db, customer.id, kind);
      if (!smsHeld) {
        smsSent = false;
        smsError = "Could not schedule the text for daytime hours.";
      }
    } else {
      const result = await sendSms(phone, smsBody);
      smsSent = result.ok;
      smsError = result.ok ? null : result.error;
      await logMessage(db, {
        businessId: business.id,
        customerId: customer.id,
        channel: "sms",
        kind,
        status: result.ok ? "sent" : "failed",
        providerMessageId: result.ok ? result.providerMessageId : null,
        errorMessage: result.ok ? null : result.error,
      });
      // This text just went out, so any older one still waiting out quiet
      // hours for the same person would be a duplicate. Drop it.
      if (result.ok) await clearHeldText(db, customer.id);
    }
  }

  if (email && isResendConfigured()) {
    const done = earlier.get("email");
    if (done) {
      emailSent = done.sent;
      emailError = done.error;
    } else {
      const result = await sendEmail(
        email,
        emailSubject,
        emailHtml,
        undefined,
        undefined,
        options.sendKey
          ? { idempotencyKey: `${options.sendKey}/${kind}/email` }
          : undefined,
      );
      emailSent = result.ok;
      emailError = result.ok ? null : result.error;
      await logMessage(db, {
        businessId: business.id,
        customerId: customer.id,
        channel: "email",
        kind,
        status: result.ok ? "sent" : "failed",
        providerMessageId: result.ok ? result.providerMessageId : null,
        errorMessage: result.ok ? null : result.error,
      });
    }
  }

  return { smsSent, emailSent, smsError, emailError, smsHeld };
}

// Parks a text until daytime. Never throws: returns false if the row could not
// be updated, so the caller can report the text as not sent.
async function holdText(
  db: ReturnType<typeof getDb>,
  customerId: string,
  kind: ReviewRequestKind,
): Promise<boolean> {
  try {
    const rows = await db
      .update(customers)
      .set({ heldSmsKind: kind, heldSmsAt: new Date() })
      .where(eq(customers.id, customerId))
      .returning({ id: customers.id });
    return rows.length > 0;
  } catch (error) {
    console.error("[reviews] failed to hold a text for quiet hours", error);
    return false;
  }
}

async function clearHeldText(
  db: ReturnType<typeof getDb>,
  customerId: string,
): Promise<void> {
  try {
    await db
      .update(customers)
      .set({ heldSmsKind: null, heldSmsAt: null })
      .where(
        and(eq(customers.id, customerId), isNotNull(customers.heldSmsKind)),
      );
  } catch (error) {
    console.error("[reviews] failed to clear a held text", error);
  }
}

// ---- Monthly review request limit (set by the membership level) -----------
// A "review request" is one ask sent to one customer: the automatic first ask
// or a manual resend. The text and email that make up one ask, and the one
// follow-up reminder, all count as that single request. Counted per calendar
// month in the business's own timezone. Admin accounts are never limited.

export const LIMIT_REACHED_MESSAGE =
  "You've used all of this month's review requests on your plan. Upgrade your plan or wait for next month to send more.";

export async function reviewRequestUsage(
  db: ReturnType<typeof getDb>,
  business: Pick<Business, "id" | "timezone" | "locations" | "tier">,
): Promise<{ used: number; limit: number }> {
  const limit = monthlyRequestLimit(business.locations, business.tier);
  const tz = business.timezone || "America/Phoenix";
  const [row] = await db
    .select({
      used: sql<number>`count(distinct (${messages.customerId}::text || ':' || ${messages.kind} || ':' || date_trunc('hour', ${messages.sentAt})::text))::int`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.businessId, business.id),
        inArray(messages.kind, ["initial", "manual"]),
        sql`${messages.sentAt} >= (date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`,
      ),
    );
  return { used: row?.used ?? 0, limit };
}

async function isOverRequestLimit(
  db: ReturnType<typeof getDb>,
  business: Business,
): Promise<boolean> {
  if (business.isAdmin) return false;
  try {
    const { used, limit } = await reviewRequestUsage(db, business);
    return used >= limit;
  } catch (error) {
    // Never block a real customer's review request because the count failed.
    console.error("[reviews] could not check the monthly request limit", error);
    return false;
  }
}

export type CreateCustomerAndSendInput = {
  name: string;
  phone: string | null;
  email: string | null;
  source: CustomerSource;
  // The provider's own id for this person. Null for manual entries.
  externalId: string | null;
};

export type CreateCustomerAndSendResult =
  | ({ ok: true; customerId: string } & SendOutcome)
  | {
      ok: false;
      // "no_review_link": nothing was created or sent because the business
      // has no Google review link yet. "limit_reached": this month's review
      // requests on their plan are used up. "error": the customer row could
      // not be created or found.
      reason: "no_review_link" | "limit_reached" | "error";
      message: string;
    };

// Creates a customer (or reuses their existing row, for a person we've
// already seen via the same CRM connection) AND immediately fires off their
// review request. This is the "fully automate all of that work" entry point
// -- used both by the manual "add customer" form and by CRM webhooks.
//
// IMPORTANT: when `externalId` matches an existing customer, we reuse that
// row (so the same real person isn't duplicated in the customer list) but we
// still send -- by design, a business's customer gets a fresh review request
// every time they pay a new invoice, not just the first time ever. A CRM
// webhook handler is responsible for its OWN delivery-level dedup (so the
// same invoice-paid event, redelivered by the provider, doesn't trigger a
// second send here) before ever calling this function.
export async function createCustomerAndSendReviewRequest(
  business: Business,
  input: CreateCustomerAndSendInput,
  options: SendRequestOptions = {},
): Promise<CreateCustomerAndSendResult> {
  // No review link means every message would point at our homepage. Stop
  // before creating anything, so the caller can tell the owner what to fix.
  if (!hasReviewLink(business)) {
    return {
      ok: false,
      reason: "no_review_link",
      message: NO_REVIEW_LINK_MESSAGE,
    };
  }

  const db = getDb();
  if (await isOverRequestLimit(db, business)) {
    return { ok: false, reason: "limit_reached", message: LIMIT_REACHED_MESSAGE };
  }
  // Store the E.164 form so every later send (reminders, manual resend) uses
  // a number Telnyx accepts. An unusable number or address becomes null.
  const phone = normalizeUsPhone(input.phone);
  const email = normalizeEmail(input.email);

  const matchExisting = input.externalId
    ? and(
        eq(customers.businessId, business.id),
        eq(customers.source, input.source),
        eq(customers.externalId, input.externalId),
      )
    : null;

  let customer: Customer | undefined;
  if (matchExisting) {
    const [existing] = await db
      .select()
      .from(customers)
      .where(matchExisting)
      .limit(1);
    customer = existing;

    // The CRM is the source of truth for contact details. A repeat customer
    // may have a new phone number or have withdrawn text consent since their
    // last invoice, so the stored row follows what the CRM says now.
    if (
      customer &&
      (customer.name !== input.name ||
        customer.phone !== phone ||
        customer.email !== email)
    ) {
      const [updated] = await db
        .update(customers)
        .set({ name: input.name, phone, email })
        .where(eq(customers.id, customer.id))
        .returning();
      customer = updated ?? customer;
    }
  }

  if (!customer) {
    const reviewToken = randomUUID();
    // No conflict target on purpose: the unique index that guards CRM
    // customers is a partial one (only where external_id is set), and
    // Postgres refuses "ON CONFLICT (columns)" for a partial index unless the
    // index's WHERE clause is repeated. A bare DO NOTHING covers it, and any
    // lost race is picked up by the select below.
    const [inserted] = await db
      .insert(customers)
      .values({
        businessId: business.id,
        name: input.name,
        phone,
        email,
        reviewToken,
        source: input.source,
        externalId: input.externalId,
      })
      .onConflictDoNothing()
      .returning();
    customer = inserted;

    if (!customer) {
      // Lost a race against a concurrent duplicate delivery -- fetch the row
      // the other request just created instead of erroring.
      if (matchExisting) {
        const [raced] = await db
          .select()
          .from(customers)
          .where(matchExisting)
          .limit(1);
        customer = raced;
      }
      if (!customer) {
        return {
          ok: false,
          reason: "error",
          message: "Could not create that customer.",
        };
      }
    }
  }

  const outcome = await sendReviewRequestAndLog(
    db,
    business,
    customer,
    "initial",
    options,
  );
  return { ok: true, customerId: customer.id, ...outcome };
}

const addCustomerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    phone: z.string().trim().max(30).optional(),
    email: z
      .string()
      .trim()
      .email("Enter a valid email")
      .optional()
      .or(z.literal("")),
  })
  .refine((value) => Boolean(value.phone) || Boolean(value.email), {
    message: "Add a phone number or an email so we can reach them.",
  });

export type AddCustomerResult =
  | {
      ok: true;
      smsSent: boolean | null;
      emailSent: boolean | null;
      smsHeld: boolean;
    }
  | { ok: false; message: string };

// Creates a customer AND immediately fires off their review request on
// every channel we have contact info + a live provider for. This is the
// "fully automate all of that work" entry point -- Colby never sends
// anything by hand.
export const addCustomer = createServerFn({ method: "POST" })
  .validator((input: unknown) => addCustomerSchema.parse(input))
  .handler(async ({ data }): Promise<AddCustomerResult> => {
    if (!isCrmConfigured()) {
      return {
        ok: false,
        message: "The CRM isn't switched on yet. Check back soon.",
      };
    }

    // A typo'd number is caught here, while the person is still looking at
    // the form, instead of being saved and silently never texted.
    const typedPhone = data.phone?.trim() || null;
    const phone = typedPhone ? normalizeUsPhone(typedPhone) : null;
    if (typedPhone && !phone) {
      return {
        ok: false,
        message:
          "That phone number doesn't look right. Use a 10 digit US number like (602) 555-0123, or clear it and add an email instead.",
      };
    }

    try {
      const businessId = await requireBusinessId();
      const db = getDb();
      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business)
        return { ok: false, message: "Your account could not be found." };

      const result = await createCustomerAndSendReviewRequest(business, {
        name: data.name,
        phone,
        email: data.email?.trim() || null,
        source: "manual",
        externalId: null,
      });
      if (!result.ok) return { ok: false, message: result.message };
      return {
        ok: true,
        smsSent: result.smsSent,
        emailSent: result.emailSent,
        smsHeld: result.smsHeld,
      };
    } catch (error) {
      console.error("[reviews] failed to add customer", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });

const resendInputSchema = z.object({ customerId: z.string().trim().min(1) });

export type ResendResult =
  | {
      ok: true;
      smsSent: boolean | null;
      emailSent: boolean | null;
      smsHeld: boolean;
    }
  | { ok: false; message: string };

// Manually re-fires the same review request a customer already got -- for
// the "they never saw it" case. Logged as its own "manual" message kind so
// it's distinguishable from the automatic initial send in the message log.
export const resendReviewRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) => resendInputSchema.parse(input))
  .handler(async ({ data }): Promise<ResendResult> => {
    if (!isCrmConfigured()) {
      return {
        ok: false,
        message: "The CRM isn't switched on yet. Check back soon.",
      };
    }

    try {
      const businessId = await requireBusinessId();
      const db = getDb();
      const [customer] = await db
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.id, data.customerId),
            eq(customers.businessId, businessId),
          ),
        )
        .limit(1);
      if (!customer) return { ok: false, message: "Customer not found." };

      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business)
        return { ok: false, message: "Your account could not be found." };

      // Same guard as the automatic path: without the business's own Google
      // review link, the message would send people to our home page.
      if (!hasReviewLink(business)) {
        return { ok: false, message: NO_REVIEW_LINK_MESSAGE };
      }
      if (await isOverRequestLimit(db, business)) {
        return { ok: false, message: LIMIT_REACHED_MESSAGE };
      }

      const { smsSent, emailSent, smsHeld } = await sendReviewRequestAndLog(
        db,
        business,
        customer,
        "manual",
      );

      if (smsSent === null && emailSent === null && !smsHeld) {
        const hasContact = Boolean(customer.phone || customer.email);
        return {
          ok: false,
          message: hasContact
            ? "No messaging provider is connected yet. Check back soon."
            : "This customer has no phone number or email on file.",
        };
      }

      return { ok: true, smsSent, emailSent, smsHeld };
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
        (m) =>
          m.customerId === row.id && m.channel === "sms" && m.status === "sent",
      ).length,
      emailCount: messageRows.filter(
        (m) =>
          m.customerId === row.id &&
          m.channel === "email" &&
          m.status === "sent",
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
        .where(
          and(
            eq(customers.id, data.customerId),
            eq(customers.businessId, businessId),
          ),
        )
        .limit(1);
      if (!customer) return { ok: false as const };

      await db
        .update(customers)
        .set({
          markedReviewedAt: customer.markedReviewedAt ? null : new Date(),
        })
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

// ---- Progress-over-time chart data -----------------------------------
// Powers the "customer progress" graph on both the business dashboard and
// the admin master view. Buckets by calendar week (Monday start, UTC) over
// a fixed trailing window -- computed in JS rather than SQL date_trunc so
// the exact same logic can run against either one business's rows or every
// business's rows combined, with no query duplication.

const SERIES_WEEKS = 12;

export type ProgressPoint = {
  weekStart: string; // ISO date (yyyy-mm-dd), Monday of that week
  customersAdded: number;
  cumulativeCustomers: number;
  messagesSent: number;
  linkClicks: number;
  reviewed: number;
};

function startOfWeekUtc(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

type ProgressCustomerRow = Pick<
  Customer,
  "createdAt" | "linkClickedAt" | "markedReviewedAt"
>;
type ProgressMessageRow = Pick<Message, "sentAt" | "status">;

function buildWeeklySeries(
  customerRows: ProgressCustomerRow[],
  messageRows: ProgressMessageRow[],
): ProgressPoint[] {
  const now = new Date();
  const currentWeekStart = startOfWeekUtc(now);
  const weekStarts: Date[] = [];
  for (let i = SERIES_WEEKS - 1; i >= 0; i--) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - i * 7);
    weekStarts.push(weekStart);
  }

  const firstWeekStart = weekStarts[0]!;
  let cumulative = customerRows.filter(
    (c) => new Date(c.createdAt) < firstWeekStart,
  ).length;

  return weekStarts.map((weekStart) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const inWeek = (value: Date | string) => {
      const d = new Date(value);
      return d >= weekStart && d < weekEnd;
    };

    const customersAdded = customerRows.filter((c) =>
      inWeek(c.createdAt),
    ).length;
    cumulative += customersAdded;

    const linkClicks = customerRows.filter(
      (c) => c.linkClickedAt && inWeek(c.linkClickedAt),
    ).length;
    const reviewed = customerRows.filter(
      (c) => c.markedReviewedAt && inWeek(c.markedReviewedAt),
    ).length;
    const messagesSent = messageRows.filter(
      (m) => m.status === "sent" && inWeek(m.sentAt),
    ).length;

    return {
      weekStart: weekStart.toISOString().slice(0, 10),
      customersAdded,
      cumulativeCustomers: cumulative,
      messagesSent,
      linkClicks,
      reviewed,
    };
  });
}

// The logged-in business's own progress over time, for the chart on /app.
export const getCustomerProgressSeries = createServerFn({
  method: "GET",
}).handler(async (): Promise<ProgressPoint[]> => {
  if (!isCrmConfigured()) return [];
  const businessId = await getSessionBusinessId();
  if (!businessId) return [];

  const db = getDb();
  const [customerRows, messageRows] = await Promise.all([
    db.select().from(customers).where(eq(customers.businessId, businessId)),
    db.select().from(messages).where(eq(messages.businessId, businessId)),
  ]);

  return buildWeeklySeries(customerRows, messageRows);
});

// ---- Admin: every client at once ---------------------------------------
// Gated on businesses.isAdmin -- today that's Colby's own account only.
// Lets him see either the combined trend across every signed-up business,
// or drill into any one client's own progress, from a single screen.

export async function requireAdminBusiness(): Promise<Business> {
  const businessId = await requireBusinessId();
  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.isAdmin) throw new Error("Not authorized.");
  return business;
}

export type AdminBusinessSummary = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  plan: string | null;
  accessRevoked: boolean;
  createdAt: Date;
  totalCustomers: number;
  messagesSent: number;
  linkClicks: number;
  reviewedCount: number;
};

export type AdminOverviewResult =
  | { ok: true; businesses: AdminBusinessSummary[] }
  | { ok: false; message: string };

export const getAdminOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminOverviewResult> => {
    if (!isCrmConfigured())
      return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }

    const db = getDb();
    const [allBusinesses, allCustomers, allMessages] = await Promise.all([
      db.select().from(businesses).orderBy(desc(businesses.createdAt)),
      db.select().from(customers),
      db.select().from(messages),
    ]);

    const summaries: AdminBusinessSummary[] = allBusinesses.map((business) => {
      const bizCustomers = allCustomers.filter(
        (c) => c.businessId === business.id,
      );
      const bizMessages = allMessages.filter(
        (m) => m.businessId === business.id,
      );
      return {
        id: business.id,
        businessName: business.businessName,
        contactName: business.contactName,
        email: business.email,
        plan: business.plan,
        accessRevoked: business.accessRevoked,
        createdAt: business.createdAt,
        totalCustomers: bizCustomers.length,
        messagesSent: bizMessages.filter((m) => m.status === "sent").length,
        linkClicks: bizCustomers.filter((c) => c.linkClickedAt).length,
        reviewedCount: bizCustomers.filter((c) => c.markedReviewedAt).length,
      };
    });

    return { ok: true, businesses: summaries };
  },
);

const adminSeriesInputSchema = z.object({
  businessId: z.string().trim().min(1).optional(),
});

export type AdminSeriesResult =
  { ok: true; series: ProgressPoint[] } | { ok: false; message: string };

// Omit businessId for the combined view across every client; pass one to
// drill into that specific business's own progress.
export const getAdminProgressSeries = createServerFn({ method: "GET" })
  .validator((input: unknown) => adminSeriesInputSchema.parse(input))
  .handler(async ({ data }): Promise<AdminSeriesResult> => {
    if (!isCrmConfigured())
      return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }

    const db = getDb();
    const [customerRows, messageRows] = await Promise.all([
      data.businessId
        ? db
            .select()
            .from(customers)
            .where(eq(customers.businessId, data.businessId))
        : db.select().from(customers),
      data.businessId
        ? db
            .select()
            .from(messages)
            .where(eq(messages.businessId, data.businessId))
        : db.select().from(messages),
    ]);

    return { ok: true, series: buildWeeklySeries(customerRows, messageRows) };
  });

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
      // Texts carry a short 22-character form of the token (short-token.ts).
      const token = tokenToUuid(data.token);
      if (!token) return { url: fallback };
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.reviewToken, token))
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
  | { ok: true; sent: number; heldTextsSent: number }
  | { ok: false; reason: "not_configured" };

// Finds every customer who hasn't clicked their review link, hasn't already
// gotten a reminder, and was created more than 48 hours ago (but less than 7
// days ago), and sends them exactly one reminder. Called by the
// /cron/reminders route on a schedule, never invoked directly by a user.
//
// A customer is only marked as reminded when at least one channel really
// sent. If every attempt failed (Telnyx or Resend down, bad number), the mark
// is taken back off so tomorrow's run tries again, until the 7 day window
// closes. Businesses that are canceled or have no review link are skipped
// without marking anyone, so nothing is lost if they come back or fix it.
export async function sendDueReminders(): Promise<ReminderRunResult> {
  if (!isDbConfigured()) return { ok: false, reason: "not_configured" };

  const db = getDb();
  const now = Date.now();
  const cutoff = new Date(now - REMINDER_DELAY_MS);
  const windowStart = new Date(now - REMINDER_RETRY_WINDOW_MS);

  const due = await db
    .select()
    .from(customers)
    .where(
      and(
        isNull(customers.reminderSentAt),
        isNull(customers.linkClickedAt),
        isNull(customers.markedReviewedAt),
        lt(customers.createdAt, cutoff),
        gt(customers.createdAt, windowStart),
      ),
    );

  // Many customers share a business, so look each business up once per run.
  const businessCache = new Map<string, Business | null>();

  let sent = 0;
  for (const customer of due) {
    try {
      let business = businessCache.get(customer.businessId);
      if (business === undefined) {
        const [row] = await db
          .select()
          .from(businesses)
          .where(eq(businesses.id, customer.businessId))
          .limit(1);
        business = row ?? null;
        businessCache.set(customer.businessId, business);
      }
      if (!business) continue;
      // A canceled client's customers must not be texted, and without a
      // review link the reminder's link would only lead to our homepage.
      if (business.accessRevoked || !hasReviewLink(business)) continue;

      // Take the mark first (only if nobody else has), then send. Vercel Cron
      // can occasionally fire a job twice; with the mark taken up front the
      // second run skips this customer instead of texting them again. The
      // mark is given back below if nothing was delivered.
      const [taken] = await db
        .update(customers)
        .set({ reminderSentAt: new Date() })
        .where(
          and(eq(customers.id, customer.id), isNull(customers.reminderSentAt)),
        )
        .returning({ id: customers.id });
      if (!taken) continue;

      let delivered = false;
      try {
        const outcome = await sendReviewRequestAndLog(
          db,
          business,
          customer,
          "reminder",
        );
        // A text waiting out quiet hours counts: it is already scheduled,
        // and taking the mark back would queue a second reminder tomorrow.
        delivered =
          outcome.smsSent === true ||
          outcome.emailSent === true ||
          outcome.smsHeld;
      } finally {
        if (!delivered) {
          await db
            .update(customers)
            .set({ reminderSentAt: null })
            .where(eq(customers.id, customer.id));
        }
      }
      if (delivered) sent += 1;
    } catch (error) {
      // One customer's problem must not stop everyone else's reminder.
      console.error("[reviews] reminder failed for a customer", error);
    }
  }

  return { ok: true, sent, heldTextsSent: 0 };
}

// Sends every text that was held for quiet hours, for businesses where it is
// now 10am to 7pm. Runs at the start of each scheduled run (twice a day, see
// vercel.json), before new reminders. Returns how many texts went out.
//
// Each held text is claimed (cleared) before it is sent, so a run that fires
// twice can't text anyone twice. Texts are dropped rather than sent when the
// client has canceled, the customer already clicked or was marked reviewed,
// the review link was removed, or the text is more than 48 hours old.
export async function sendHeldTexts(now: Date = new Date()): Promise<number> {
  if (!isDbConfigured() || !isTelnyxConfigured()) return 0;

  const db = getDb();
  const waiting = await db
    .select()
    .from(customers)
    .where(isNotNull(customers.heldSmsAt));

  const businessCache = new Map<string, Business | null>();
  let sent = 0;

  for (const customer of waiting) {
    try {
      const kind = customer.heldSmsKind;
      const heldAt = customer.heldSmsAt;
      if (!heldAt) continue;

      let business = businessCache.get(customer.businessId);
      if (business === undefined) {
        const [row] = await db
          .select()
          .from(businesses)
          .where(eq(businesses.id, customer.businessId))
          .limit(1);
        business = row ?? null;
        businessCache.set(customer.businessId, business);
      }

      // Only this exact hold is claimed or dropped: if a newer one replaced
      // it since we read the row, that newer one is left alone.
      const thisHold = and(
        eq(customers.id, customer.id),
        eq(customers.heldSmsAt, heldAt),
      );

      const phone = normalizeUsPhone(customer.phone);
      if (!kind || !phone || !business) {
        await db
          .update(customers)
          .set({ heldSmsKind: null, heldSmsAt: null })
          .where(thisHold);
        continue;
      }
      const stale =
        business.accessRevoked ||
        !hasReviewLink(business) ||
        customer.linkClickedAt !== null ||
        customer.markedReviewedAt !== null ||
        now.getTime() - heldAt.getTime() > HELD_TEXT_MAX_AGE_MS;
      if (stale) {
        await db
          .update(customers)
          .set({ heldSmsKind: null, heldSmsAt: null })
          .where(thisHold);
        continue;
      }
      if (!isWithinTextingHours(business.timezone, now)) continue;

      const [claimed] = await db
        .update(customers)
        .set({ heldSmsKind: null, heldSmsAt: null })
        .where(thisHold)
        .returning({ id: customers.id });
      if (!claimed) continue;

      const result = await sendSms(phone, smsBodyFor(kind, business, customer));
      await logMessage(db, {
        businessId: business.id,
        customerId: customer.id,
        channel: "sms",
        kind,
        status: result.ok ? "sent" : "failed",
        providerMessageId: result.ok ? result.providerMessageId : null,
        errorMessage: result.ok ? null : result.error,
      });
      if (result.ok) sent += 1;
    } catch (error) {
      // One customer's problem must not stop everyone else's text.
      console.error("[reviews] held text failed for a customer", error);
    }
  }

  return sent;
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

export type CronRunResult =
  ReminderRunResult | { ok: false; reason: "unauthorized" };

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

    // Texts held overnight go first, then today's reminders (whose own texts
    // are held in turn if it isn't daytime yet for that business).
    let heldTextsSent = 0;
    try {
      heldTextsSent = await sendHeldTexts();
    } catch (error) {
      console.error("[reviews] sending held texts failed", error);
    }
    const result = await sendDueReminders();
    setResponseStatus(200);
    return result.ok ? { ...result, heldTextsSent } : result;
  },
);
