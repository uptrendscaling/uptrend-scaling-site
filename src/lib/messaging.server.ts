// Low-level SMS + email sending. Talks to Twilio and Resend directly over
// fetch (no SDKs, keeps the server bundle small). Both channels follow the
// same dormant-until-configured pattern as Stripe: the app builds and runs
// fine with none of these env vars set, and every call site checks the
// matching isXConfigured() before sending.

import { CANONICAL_SITE_URL } from "./site";

// The address UpTrend Scaling's own account emails (welcome, receipts, etc.)
// send from -- distinct from RESEND_FROM_EMAIL, which is whatever address a
// signed-up business's own review-request texts/emails go out under.
export const UPTREND_SUPPORT_EMAIL = "hello@uptrendscaling.com";

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env["TWILIO_ACCOUNT_SID"] &&
    process.env["TWILIO_AUTH_TOKEN"] &&
    process.env["TWILIO_FROM_NUMBER"],
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

// Sends a single SMS via Twilio's REST API.
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!sid || !token || !from) {
    return { ok: false, error: "Twilio is not configured yet." };
  }

  try {
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      sid?: string;
      message?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        error: payload?.message ?? `Twilio responded with ${response.status}`,
      };
    }

    return { ok: true, providerMessageId: payload?.sid ?? null };
  } catch (error) {
    console.error("[messaging] failed to send SMS via Twilio", error);
    return { ok: false, error: "Network error sending SMS." };
  }
}

// Sends a single email via Resend's REST API. Pass `from` to override the
// sender for account/system emails (see UPTREND_SUPPORT_EMAIL); otherwise
// falls back to RESEND_FROM_EMAIL, the address a business's own review
// requests go out under.
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from?: string,
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
      body: JSON.stringify({ from: fromAddress, to, subject, html }),
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

// ---- Message copy --------------------------------------------------------
// Kept short and personalized. Every message includes the tracked review
// link so we know precisely when it's clicked, plus an opt-out line on SMS
// (required for A2P 10DLC compliance once Twilio is live).

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

export function welcomeEmailHtml(
  businessName: string,
  contactName: string,
): string {
  const loginUrl = `${CANONICAL_SITE_URL}/login`;
  return `<p>Hi ${contactName},</p><p>Welcome to UpTrend Scaling! Your account for ${businessName} is set up and ready to go.</p><p>Here's what to do next:</p><ul><li>Add your Google review link in your dashboard settings</li><li>Add your first customer, their review request goes out the moment you save it</li></ul><p><a href="${loginUrl}">Log in to your dashboard</a></p><p>Questions? Just reply to this email, it comes straight to us.</p><p>Thanks for signing up,<br/>The UpTrend Scaling team</p>`;
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

// Sent once, 48 hours after a cold-outreach lead's first email, if no
// response has been recorded by then. Kept short, same spirit as the
// original outreach, not pushy. See lib/leads.server.ts.
export function leadFollowUpEmailSubject(businessName: string): string {
  return `Following up, ${businessName}`;
}

export function leadFollowUpEmailHtml(businessName: string): string {
  return `<p>Hi there,</p><p>Wanted to follow up on the note I sent a couple days ago about UpTrend Scaling, we help businesses like ${businessName} turn more happy customers into Google reviews automatically, no extra work on your end.</p><p>If it's not a fit right now, no worries at all. If you're curious, just reply to this email and I'll walk you through it.</p><p>Thanks,<br/>The UpTrend Scaling team</p>`;
}
