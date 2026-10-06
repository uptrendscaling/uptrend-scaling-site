// Low-level SMS + email sending. Talks to Telnyx and Resend directly over
// fetch (no SDKs, keeps the server bundle small). Both channels follow the
// same dormant-until-configured pattern as Stripe: the app builds and runs
// fine with none of these env vars set, and every call site checks the
// matching isXConfigured() before sending.

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

// Sends a single SMS via Telnyx's REST API.
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
    });

    const payload = (await response.json().catch(() => null)) as {
      data?: { id?: string };
      errors?: { title?: string; detail?: string }[];
    } | null;

    if (!response.ok) {
      const firstError = payload?.errors?.[0];
      return {
        ok: false,
        error:
          firstError?.detail ??
          firstError?.title ??
          `Telnyx responded with ${response.status}`,
      };
    }

    return { ok: true, providerMessageId: payload?.data?.id ?? null };
  } catch (error) {
    console.error("[messaging] failed to send SMS via Telnyx", error);
    return { ok: false, error: "Network error sending SMS." };
  }
}

// Sends a single email via Resend's REST API. Pass `from` to override the
// sender for account/system emails (see UPTREND_SUPPORT_EMAIL); otherwise
// falls back to RESEND_FROM_EMAIL, the address a business's own review
// requests go out under. Pass `bcc` to also blind-copy an address (see
// TRUSTPILOT_AFS_BCC_EMAIL) -- omitted from the request entirely when not
// given, so every existing call site is unaffected.
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from?: string,
  bcc?: string,
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
      },
      body: JSON.stringify({
        from: fromAddress,
        to,
        subject,
        html,
        ...(bcc ? { bcc } : {}),
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        error: payload?.message ?? `Resend responded with ${response.status}`,
      };
    }

    return { ok: true, providerMessageId: payload?.id ?? null };
  } catch (error) {
    console.error("[messaging] failed to send email via Resend", error);
    return { ok: false, error: "Network error sending email." };
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

export type OutreachEmail = { to: string; subject: string; text: string };

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

// Sends up to 100 plain-text emails in one request. Never throws. Strict
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
          reply_to: UPTREND_SUPPORT_EMAIL,
          headers: {
            "List-Unsubscribe": `<mailto:${UPTREND_SUPPORT_EMAIL}?subject=unsubscribe>`,
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

export function initialSmsBody(
  businessName: string,
  customerName: string,
  link: string,
): string {
  return `Hi ${customerName}, thanks for choosing ${businessName}! Mind leaving us a quick review? ${link} Reply STOP to opt out.`;
}

export function reminderSmsBody(
  businessName: string,
  customerName: string,
  link: string,
): string {
  return `Hi ${customerName}, quick reminder from ${businessName} — if you have 30 seconds, a review means a lot to us: ${link} Reply STOP to opt out.`;
}

export function initialEmailSubject(businessName: string): string {
  return `How did we do? — ${businessName}`;
}

export function initialEmailHtml(
  businessName: string,
  customerName: string,
  link: string,
): string {
  return `<p>Hi ${customerName},</p><p>Thanks for choosing ${businessName}! If you have a moment, we'd really appreciate a quick review:</p><p><a href="${link}">${link}</a></p><p>Thank you,<br/>${businessName}</p>`;
}

export function reminderEmailSubject(businessName: string): string {
  return `Quick reminder — ${businessName}`;
}

export function reminderEmailHtml(
  businessName: string,
  customerName: string,
  link: string,
): string {
  return `<p>Hi ${customerName},</p><p>Just a quick reminder, if you have 30 seconds we'd love your feedback:</p><p><a href="${link}">${link}</a></p><p>Thank you,<br/>${businessName}</p>`;
}

// Sent once, the moment a business finishes signing up (sets their password
// on /start/success after checkout) -- their welcome to UpTrend Scaling
// itself, not a review request. Always goes out from UPTREND_SUPPORT_EMAIL.
export function welcomeEmailSubject(): string {
  return "Welcome to UpTrend Scaling";
}

// Two static images (generated once, not per-send) live in /public/email and
// ship with the site deploy, so they're served from our own domain at a
// stable URL -- required for a transactional email, since inline data: URIs
// are stripped by most inboxes and an artifact-hosted image isn't reachable
// by an email client at all. Regenerate both with
// /tmp/welcome-email/generate_hero.py and dashboard_mock.html (see repo
// history) if the brand mark or dashboard layout ever changes.
const WELCOME_HERO_IMAGE_URL = `${CANONICAL_SITE_URL}/email/welcome-hero.png`;
const WELCOME_DASHBOARD_PREVIEW_URL = `${CANONICAL_SITE_URL}/email/welcome-dashboard-preview.png`;

export function welcomeEmailHtml(
  businessName: string,
  contactName: string,
): string {
  const loginUrl = `${CANONICAL_SITE_URL}/login`;

  // Table-based layout with inline styles throughout -- the only way to get
  // consistent rendering across Gmail, Apple Mail, and Outlook, none of
  // which reliably support a <style> block or modern CSS (flexbox/grid) in
  // email. Body background is kept light/neutral on purpose: the two
  // exported PNGs already carry the brand's dark look, and a dark email
  // body risks looking broken under Gmail/Apple Mail's automatic dark-mode
  // color inversion.
  return `<div style="background:#f4f4f5;padding:32px 16px;font-family:'Poppins','Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <tr>
      <td style="padding:0;">
        <img src="${WELCOME_HERO_IMAGE_URL}" width="600" alt="Welcome to UpTrend Scaling" style="display:block;width:100%;max-width:600px;height:auto;" />
      </td>
    </tr>
    <tr>
      <td style="padding:36px 36px 8px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#18181b;">Hi ${contactName},</p>
        <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#18181b;">Your account for <strong>${businessName}</strong> is set up and ready to go. Here's how to start turning happy customers into 5-star Google reviews, automatically.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="36" valign="top" style="padding-bottom:20px;">
              <div style="width:26px;height:26px;border-radius:50%;background:#18181b;color:#ffffff;font-size:13px;font-weight:700;line-height:26px;text-align:center;font-family:'Poppins',Arial,sans-serif;">1</div>
            </td>
            <td valign="top" style="padding-bottom:20px;padding-left:12px;">
              <p style="margin:0;font-size:15px;line-height:1.55;color:#18181b;"><strong>Add your Google review link</strong><br/><span style="color:#6b6b70;">In your dashboard settings, this is where every customer gets sent after they click their personal review link.</span></p>
            </td>
          </tr>
          <tr>
            <td width="36" valign="top" style="padding-bottom:20px;">
              <div style="width:26px;height:26px;border-radius:50%;background:#18181b;color:#ffffff;font-size:13px;font-weight:700;line-height:26px;text-align:center;font-family:'Poppins',Arial,sans-serif;">2</div>
            </td>
            <td valign="top" style="padding-bottom:20px;padding-left:12px;">
              <p style="margin:0;font-size:15px;line-height:1.55;color:#18181b;"><strong>Add your first customer</strong><br/><span style="color:#6b6b70;">Their review request goes out the moment you save it, no extra step.</span></p>
            </td>
          </tr>
          <tr>
            <td width="36" valign="top" style="padding-bottom:8px;">
              <div style="width:26px;height:26px;border-radius:50%;background:#18181b;color:#ffffff;font-size:13px;font-weight:700;line-height:26px;text-align:center;font-family:'Poppins',Arial,sans-serif;">3</div>
            </td>
            <td valign="top" style="padding-bottom:8px;padding-left:12px;">
              <p style="margin:0;font-size:15px;line-height:1.55;color:#18181b;"><strong>Connect Jobber or Square (optional)</strong><br/><span style="color:#6b6b70;">Review requests go out automatically the moment an invoice is paid, no manual entry needed.</span></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:12px 36px 36px;">
        <a href="${loginUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:8px;font-family:'Poppins',Arial,sans-serif;">Log in to your dashboard</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 36px 12px;">
        <p style="margin:0 0 14px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#8b8b90;text-transform:uppercase;">What your dashboard looks like</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 36px;">
        <img src="${WELCOME_DASHBOARD_PREVIEW_URL}" width="528" alt="Example UpTrend Scaling dashboard, showing customers, messages sent, review link clicks, and reviews marked complete" style="display:block;width:100%;max-width:528px;height:auto;border-radius:10px;border:1px solid #e4e4e7;" />
        <p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#a0a0a6;">Example account shown for illustration, yours will fill in as you add customers.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 36px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;border-left:3px solid #18181b;border-radius:0 8px 8px 0;">
          <tr>
            <td style="padding:20px 22px;">
              <p style="margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:0.02em;color:#8b8b90;text-transform:uppercase;">A note from Colby, our Founder</p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#18181b;">I started UpTrend Scaling because I kept seeing good local businesses lose customers over nothing more than an empty Google reviews page. I can't wait to see your account grow and more traffic come to your business. If you ever get stuck, have a question, or just want to say hi, reply to this email, it comes straight to me.</p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#18181b;">Thanks for giving us a shot!<br/>Colby</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 36px 32px;border-top:1px solid #e4e4e7;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#a0a0a6;">UpTrend Scaling LLC &middot; Glendale, AZ</p>
      </td>
    </tr>
  </table>
</div>`;
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
  return `<p>Hi ${contactName},</p><p>We got a request to reset your UpTrend Scaling password. Click below to choose a new one:</p><p><a href="${resetUrl}">Reset my password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email, your password won't change.</p><p>Thanks,<br/>The UpTrend Scaling team</p>`;
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
  return `<p>A new business just subscribed.</p><ul><li>Business: ${businessName}</li><li>Contact: ${contactName}</li><li>Email: ${email}</li><li>Phone: ${phone || "Not provided"}</li><li>Plan: ${plan ?? "Not set"}</li></ul>`;
}

// Sent once, two days after a cold-outreach lead's first email, if no
// response has been recorded by then. Plain text, short, and it refers back
// to the first email instead of repeating it. See lib/leads.server.ts.
export function leadFollowUpEmailSubject(): string {
  return "Following up on my note";
}

// Uses the owner's first name only when we actually have a clean one;
// otherwise a plain "Hi there,".
export function leadFirstName(ownerName: string | null): string | null {
  const first = ownerName?.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z][A-Za-z'’-]{1,20}$/.test(first) ? first : null;
}

export function leadFollowUpEmailText(
  businessName: string,
  ownerName: string | null,
): string {
  const first = leadFirstName(ownerName);
  return [
    `Hi ${first ?? "there"},`,
    "",
    `Quick follow up on my note from a couple of days ago about getting more Google reviews for ${businessName} on autopilot.`,
    "",
    `If it's not a priority right now, no problem at all. If you'd like to see how it works, just reply "yes" and I'll send over a short walkthrough, or take a look at uptrendscaling.com.`,
    "",
    "Colby",
    "UpTrend Scaling",
    "",
    `P.S. If this isn't a fit, reply "no thanks" and I won't email you again.`,
  ].join("\n");
}
