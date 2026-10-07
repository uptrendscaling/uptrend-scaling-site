// Low-level SMS + email sending. Talks to Telnyx and Resend directly over
// fetch (no SDKs, keeps the server bundle small). Both channels follow the
// same dormant-until-configured pattern as Stripe: the app builds and runs
// fine with none of these env vars set, and every call site checks the
// matching isXConfigured() before sending.

import {
  OUTREACH_FOLLOWUP_SUBJECT,
  followUpTimingPhrase,
  renderOutreachEmail,
} from "./outreach-email";
import {
  button as emailButton,
  card as emailCard,
  emailShell,
  mutedPara as emailMutedPara,
  paraHtml as emailParaHtml,
  signoff as emailSignoff,
  steps as emailSteps,
} from "./email-layout";
import { CANONICAL_SITE_URL } from "./site";

// The address UpTrend Scaling's own account emails (welcome, receipts, etc.)
// send from -- distinct from RESEND_FROM_EMAIL, which is whatever address a
// signed-up business's own review-request texts/emails go out under.
export const UPTREND_SUPPORT_EMAIL = "hello@uptrendscaling.com";

// The unique per-business BCC address from Trustpilot's Automatic Feedback
// Service (AFS) -- see businessapp.b2b.trustpilot.com > Get reviews > Set up
// email invites. BCC'ing this address on the welcome email (the first
// "purchase experience" a newly-subscribed business has with us) tells
// Trustpilot to follow up with that business about a week later asking for
// a review. Not a secret and has no external service to be "unconfigured,"
// so it's a plain constant like UPTREND_SUPPORT_EMAIL rather than an env
// var; grab a new value from AFS's "Manage AFS" screen if it ever changes.
export const TRUSTPILOT_AFS_BCC_EMAIL =
  "uptrendscaling.com+926042d14e@invite.trustpilot.com";

export function isTelnyxConfigured(): boolean {
  return Boolean(
    process.env["TELNYX_API_KEY"] && process.env["TELNYX_FROM_NUMBER"],
  );
}

export function isResendConfigured(): boolean {
  return Boolean(
    process.env["RESEND_API_KEY"] && process.env["RESEND_FROM_EMAIL"],
  );
}

export function reviewLinkFor(token: string): string {
  return `${CANONICAL_SITE_URL}/r/${token}`;
}

export type SendResult =
  { ok: true; providerMessageId: string | null } | { ok: false; error: string };

// ---- Small text helpers --------------------------------------------------

// Customer and business names are typed in by people (or pulled from a CRM),
// so they must never be dropped raw into email HTML: a name like
// "Smith & Sons <Plumbing>" would break the layout, and a hostile one could
// inject markup into an email that goes out under a real business's name.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Collapses line breaks and runs of spaces so a name can sit inside an SMS or
// an email subject line without breaking either.
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Normalizes a US phone number to E.164 ("+16025550123"), which is the only
// format Telnyx accepts. Accepts the ways people actually type numbers:
// "(602) 555-0123", "602.555.0123", "1-602-555-0123", "+1 602 555 0123".
// Returns null when the input is empty or cannot be a real US number, and the
// caller then treats the customer as having no phone (email only).
//
// A "+" number from another country is passed through when its length is
// plausible (8 to 15 digits). US/Canada numbers (10 digits, or 11 starting
// with 1) must follow the North American numbering plan: area code and
// exchange start with 2 to 9, which rejects typos like 123-456-7890.
export function normalizeUsPhone(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // "(602) 555-0123 x45" is an office line with an extension. Drop the
  // extension; any other letters mean this is not a phone number at all.
  text = text.replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\s*$/i, "");
  if (/[a-z]/i.test(text)) return null;

  const hasPlus = text.startsWith("+");
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;

  const isNanp = (ten: string) => /^[2-9]\d{2}[2-9]\d{6}$/.test(ten);

  if (hasPlus) {
    if (digits.startsWith("1")) {
      return digits.length === 11 && isNanp(digits.slice(1))
        ? `+${digits}`
        : null;
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return isNanp(digits) ? `+1${digits}` : null;
  if (digits.length === 11 && digits.startsWith("1")) {
    return isNanp(digits.slice(1)) ? `+${digits}` : null;
  }
  return null;
}

// Light sanity check, not full RFC validation: something@something.tld with no
// spaces. Enough to stop obvious junk before it reaches (and gets rejected by)
// the email provider.
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : null;
}

// How long we wait on Telnyx or Resend before giving up. A webhook handler
// sends from inside a request that Square gives 10 seconds to answer, so an
// unresponsive provider must not be able to hold it open indefinitely.
const SEND_TIMEOUT_MS = 8_000;

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

type TelnyxPayload = {
  data?: { id?: string };
  errors?: { code?: string | number; title?: string; detail?: string }[];
} | null;

// Telnyx's own words for what went wrong, so the message log (and the owner)
// sees "The 'to' number is not a valid phone number" rather than a bare
// status code. See developers.telnyx.com, "Send a message": errors come back
// as { errors: [{ code, title, detail }] }.
function telnyxErrorText(payload: TelnyxPayload, status: number): string {
  const first = payload?.errors?.[0];
  const text = first?.detail || first?.title;
  if (text) {
    return first?.code !== undefined && first.code !== ""
      ? `${text} (Telnyx error ${first.code})`
      : text;
  }
  return `Telnyx responded with ${status}`;
}

// Sends a single SMS via Telnyx's REST API (POST /v2/messages with
// { from, to, text }). A 200 from Telnyx means "accepted and queued", not
// "delivered"; later delivery failures only show up on Telnyx's own
// delivery webhooks, which this app does not consume yet.
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const apiKey = process.env["TELNYX_API_KEY"];
  const from = process.env["TELNYX_FROM_NUMBER"];
  if (!apiKey || !from) {
    return { ok: false, error: "Telnyx is not configured yet." };
  }

  try {
    const response = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, text: body }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as TelnyxPayload;

    // Non-2xx, or a 2xx that carries an error list and no message id, both
    // mean Telnyx did not accept the message.
    if (
      !response.ok ||
      (payload?.errors?.length && !payload?.data?.id)
    ) {
      const error = telnyxErrorText(payload, response.status);
      console.error("[messaging] Telnyx did not accept the SMS:", error);
      return { ok: false, error };
    }

    return { ok: true, providerMessageId: payload?.data?.id ?? null };
  } catch (error) {
    console.error("[messaging] failed to send SMS via Telnyx", error);
    return {
      ok: false,
      error: isTimeout(error)
        ? "Telnyx did not answer in time."
        : "Network error sending SMS.",
    };
  }
}

// Sends a single email via Resend's REST API. Pass `from` to override the
// sender for account/system emails (see UPTREND_SUPPORT_EMAIL); otherwise
// falls back to RESEND_FROM_EMAIL, the address a business's own review
// requests go out under. Pass `bcc` to also blind-copy an address (see
// TRUSTPILOT_AFS_BCC_EMAIL) -- omitted from the request entirely when not
// given, so every existing call site is unaffected.
//
// `options.idempotencyKey` is Resend's Idempotency-Key header: sending the
// same key again within 24 hours returns the first result instead of sending
// a second email. Used by the CRM webhooks so that a retry after a crash can
// never email the same person twice for the same paid invoice.
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from?: string,
  bcc?: string,
  options?: { idempotencyKey?: string },
): Promise<SendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const fromAddress = from ?? process.env["RESEND_FROM_EMAIL"];
  if (!apiKey || !fromAddress) {
    return { ok: false, error: "Resend is not configured yet." };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey.slice(0, 256) }
          : {}),
      },
      body: JSON.stringify({
        from: fromAddress,
        to,
        subject,
        html,
        ...(bcc ? { bcc } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    // Resend errors look like { statusCode, name, message }.
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;

    if (!response.ok) {
      const error =
        payload?.message ||
        payload?.name ||
        `Resend responded with ${response.status}`;
      console.error("[messaging] Resend did not accept the email:", error);
      return { ok: false, error };
    }

    return { ok: true, providerMessageId: payload?.id ?? null };
  } catch (error) {
    console.error("[messaging] failed to send email via Resend", error);
    return {
      ok: false,
      error: isTimeout(error)
        ? "Resend did not answer in time."
        : "Network error sending email.",
    };
  }
}

// ---- Cold-outreach follow-up sending (batch) -----------------------------
// Resend's single-send endpoint is limited to 2 requests per second per
// team. The old follow-up job fired one request per lead back to back, so on
// 2026-10-02 and 2026-10-03 about 140 of 150 sends were rejected with a 429
// and the job still marked every lead "followed up." This sends up to 50
// emails per single request instead, and reports exactly what happened so the
// caller only marks a lead followed up when Resend actually accepted it.

// Same sender identity the cold-email broadcasts use, so a follow-up looks
// like it comes from the same person as the first email.
export const LEAD_OUTREACH_FROM =
  "Colby at UpTrend Scaling <colby@mail.uptrendscaling.com>";

// One outreach email. `html` and `text` are sent together (HTML is what the
// recipient normally sees, text is the fallback). `unsubscribeUrl` becomes the
// List-Unsubscribe header, which is what Gmail's own "Unsubscribe" link uses.
export type OutreachEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  unsubscribeUrl?: string;
};

export type BatchSendResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      status: number | null;
      // True when trying the same request again later could work (rate
      // limit, Resend outage, network blip). False for a bad request.
      retryable: boolean;
      retryAfterMs: number | null;
    };

// Sends up to 100 emails (HTML plus a plain-text copy) in one request. Never throws. Strict
// validation on Resend's side means one bad address makes the whole request
// fail with a 4xx (nothing is sent); callers should fall back to
// sendEmailPlain for that chunk.
export async function sendEmailBatch(
  emails: OutreachEmail[],
): Promise<BatchSendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return {
      ok: false,
      error: "Resend is not configured yet.",
      status: null,
      retryable: false,
      retryAfterMs: null,
    };
  }
  if (emails.length === 0) return { ok: true };

  try {
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        emails.map((email) => ({
          from: LEAD_OUTREACH_FROM,
          to: email.to,
          subject: email.subject,
          text: email.text,
          ...(email.html ? { html: email.html } : {}),
          reply_to: UPTREND_SUPPORT_EMAIL,
          headers: {
            "List-Unsubscribe": email.unsubscribeUrl
              ? `<${email.unsubscribeUrl}>, <mailto:${UPTREND_SUPPORT_EMAIL}?subject=unsubscribe>`
              : `<mailto:${UPTREND_SUPPORT_EMAIL}?subject=unsubscribe>`,
          },
        })),
      ),
    });

    if (response.ok) return { ok: true };

    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    return {
      ok: false,
      error: payload?.message ?? `Resend responded with ${response.status}`,
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs:
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : null,
    };
  } catch (error) {
    console.error("[messaging] failed to send email batch via Resend", error);
    return {
      ok: false,
      error: "Network error sending email.",
      status: null,
      retryable: true,
      retryAfterMs: null,
    };
  }
}

// Sends one plain-text outreach email. Used only as the fallback when a
// batch is rejected, so one bad address can't hold up the rest.
export async function sendEmailPlain(
  email: OutreachEmail,
): Promise<BatchSendResult> {
  return sendEmailBatch([email]);
}

// ---- Message copy --------------------------------------------------------
// Kept short and personalized. Every message includes the tracked review
// link so we know precisely when it's clicked, plus an opt-out line on SMS
// (required for toll-free SMS compliance).

// US carriers require STOP opt-out language on SMS (the first message to a
// number especially), so both templates carry it. No dashes or special
// punctuation in the SMS copy: it keeps the text in the plain GSM alphabet,
// where one message holds 160 characters instead of 70.
export function initialSmsBody(
  businessName: string,
  customerName: string,
  link: string,
): string {
  return `Hi ${oneLine(customerName)}, thanks for choosing ${oneLine(businessName)}! Mind leaving us a quick review? ${link} Msg&data rates may apply. Reply STOP to opt out, HELP for help.`;
}

export function reminderSmsBody(
  businessName: string,
  customerName: string,
  link: string,
): string {
  return `Hi ${oneLine(customerName)}, quick reminder from ${oneLine(businessName)}. If you have 30 seconds, a review means a lot to us: ${link} Reply STOP to opt out.`;
}

// Subjects are plain text (not HTML), so no escaping, only line breaks removed.
export function initialEmailSubject(businessName: string): string {
  return `How did we do at ${oneLine(businessName)}?`;
}

export function initialEmailHtml(
  businessName: string,
  customerName: string,
  link: string,
): string {
  const business = escapeHtml(businessName);
  return `<p>Hi ${escapeHtml(customerName)},</p><p>Thanks for choosing ${business}! If you have a moment, we'd really appreciate a quick review:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>Thank you,<br/>${business}</p>`;
}

export function reminderEmailSubject(businessName: string): string {
  return `Quick reminder from ${oneLine(businessName)}`;
}

export function reminderEmailHtml(
  businessName: string,
  customerName: string,
  link: string,
): string {
  const business = escapeHtml(businessName);
  return `<p>Hi ${escapeHtml(customerName)},</p><p>Just a quick reminder, if you have 30 seconds we'd love your feedback:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>Thank you,<br/>${business}</p>`;
}

// Sent once, the moment a business finishes signing up (sets their password
// on /start/success after checkout) -- their welcome to UpTrend Scaling
// itself, not a review request. Always goes out from UPTREND_SUPPORT_EMAIL.
export function welcomeEmailSubject(): string {
  return "Welcome to UpTrend Scaling";
}

// The welcome email uses the same design as the cold-outreach emails (dark
// wordmark header, white card, dark button, plain sign-off) and has no images,
// for the same reason: many inboxes block remote images from unknown senders,
// which turned the old hero picture and dashboard screenshot into empty boxes.
// The layout lives in ./email-layout.ts.
export function welcomeEmailHtml(
  businessName: string,
  contactName: string,
): string {
  const loginUrl = `${CANONICAL_SITE_URL}/login`;
  // Both names come from the signup form. paraHtml takes markup, so they are
  // escaped here before going in; everything else is escaped by the helpers.
  const safeBusinessName = escapeHtml(businessName);
  const safeContactName = escapeHtml(contactName);

  return emailShell({
    subject: welcomeEmailSubject(),
    preheader:
      "Your account is set up. Here is how to get your first Google reviews on autopilot.",
    tagline: "Google reviews on autopilot",
    sections: [
      {
        top: 32,
        bottom: 8,
        html: `${emailParaHtml(`Hi ${safeContactName},`)}
        ${emailParaHtml(`Your account for <strong>${safeBusinessName}</strong> is set up and ready to go. Here's how to start turning happy customers into 5-star Google reviews, automatically.`)}`,
      },
      {
        top: 8,
        bottom: 12,
        html: emailCard(
          "Get started in 3 steps",
          emailSteps([
            {
              title: "Add your Google review link",
              detail:
                "In your dashboard settings. This is where every customer lands after they tap their personal review link.",
            },
            {
              title: "Add your first customer",
              detail:
                "Their review request goes out the moment you save it, no extra step.",
            },
            {
              title: "Connect Jobber or Square (optional)",
              detail:
                "Review requests go out automatically the moment an invoice is paid, no manual entry needed.",
            },
          ]),
        ),
      },
      {
        top: 12,
        bottom: 28,
        html: emailButton("Log in to your dashboard", loginUrl),
      },
      {
        top: 4,
        bottom: 8,
        html: `${emailParaHtml(
          escapeHtml(
            "I started UpTrend Scaling because I kept seeing good local businesses lose customers over nothing more than an empty Google reviews page. I can't wait to see your account grow and more customers find your business.",
          ),
        )}
        ${emailParaHtml(escapeHtml("Thanks for giving us a shot!"), 12)}
        ${emailSignoff("Colby", "Founder, UpTrend Scaling | uptrendscaling.com")}`,
      },
      {
        top: 12,
        bottom: 28,
        html: emailMutedPara(
          "P.S. If you ever get stuck, have a question, or just want to say hi, reply to this email. It comes straight to me.",
          0,
        ),
      },
    ],
    footerLines: ["UpTrend Scaling LLC \u00b7 Glendale, AZ"],
  });
}

// Sent when a business requests a password reset from /forgot-password.
// Always goes out from UPTREND_SUPPORT_EMAIL, same as the welcome email.
export function resetPasswordEmailSubject(): string {
  return "Reset your UpTrend Scaling password";
}

export function resetPasswordEmailHtml(
  contactName: string,
  resetUrl: string,
): string {
  return `<p>Hi ${escapeHtml(contactName)},</p><p>We got a request to reset your UpTrend Scaling password. Click below to choose a new one:</p><p><a href="${escapeHtml(resetUrl)}">Reset my password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email, your password won't change.</p><p>Thanks,<br/>The UpTrend Scaling team</p>`;
}

// Sent to Colby (not the business), the moment a business finishes signing
// up -- an internal heads-up, not an account email, so it always goes out
// from UPTREND_SUPPORT_EMAIL regardless of who it's addressed to.
export function newSubscriberEmailSubject(businessName: string): string {
  return `New UpTrend Scaling subscriber: ${businessName}`;
}

export function newSubscriberEmailHtml(
  businessName: string,
  contactName: string,
  email: string,
  phone: string,
  plan: string | null,
): string {
  return `<p>A new business just subscribed.</p><ul><li>Business: ${escapeHtml(businessName)}</li><li>Contact: ${escapeHtml(contactName)}</li><li>Email: ${escapeHtml(email)}</li><li>Phone: ${escapeHtml(phone || "Not provided")}</li><li>Plan: ${escapeHtml(plan ?? "Not set")}</li></ul>`;
}

// Sent once, two days after a cold-outreach lead's first email, if no
// response has been recorded by then. Short, and it refers back to the first
// email instead of repeating it. The layout and copy live in
// ./outreach-email.ts so the first email and the follow-up share one design.
// See lib/leads.server.ts.
export function leadFollowUpEmailSubject(): string {
  return OUTREACH_FOLLOWUP_SUBJECT;
}

// Where the Unsubscribe button and the List-Unsubscribe header point. The
// lead's id is an unguessable uuid, so the link identifies exactly one lead.
export function leadUnsubscribeUrl(leadId: string): string {
  return `${CANONICAL_SITE_URL}/unsubscribe?l=${leadId}`;
}

// Uses the owner's first name only when we actually have a clean one;
// otherwise a plain "Hi there,".
export function leadFirstName(ownerName: string | null): string | null {
  const first = ownerName?.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{1,20}$/.test(first) ? first : null;
}

// Builds the complete follow-up for one lead: subject, designed HTML, the
// plain-text copy, and the unsubscribe link.
export function leadFollowUpEmail(lead: {
  id: string;
  businessName: string;
  ownerName: string | null;
  contactedAt: Date | null;
}): { subject: string; html: string; text: string; unsubscribeUrl: string } {
  const unsubscribeUrl = leadUnsubscribeUrl(lead.id);
  const content = renderOutreachEmail({
    kind: "followup",
    greetingName: leadFirstName(lead.ownerName) ?? "there",
    businessName: lead.businessName,
    timingPhrase: followUpTimingPhrase(lead.contactedAt),
    unsubscribeUrl,
  });
  return { ...content, unsubscribeUrl };
}
