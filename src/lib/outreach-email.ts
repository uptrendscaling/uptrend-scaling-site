// The two cold-outreach emails (first email + 48-hour follow-up), built from
// one shared layout so they always look like the same sender. Pure functions
// with no server-only imports, so the same code can also be run from a script
// to produce the static HTML pasted into the Resend broadcast for the first
// email (merge tags like {{{FIRST_NAME|there}}} are passed in as the name
// values and simply flow through).
//
// Layout notes: table-based with inline styles (the only thing that renders
// consistently in Gmail, Apple Mail and Outlook), a light body so Gmail and
// Apple Mail dark-mode inversion can't break it, two small hosted images, and
// a plain-text version that goes out alongside the HTML.

import { CANONICAL_SITE_URL } from "./site";

export type OutreachEmailKind = "first" | "followup";

export type OutreachEmailInput = {
  kind: OutreachEmailKind;
  // "Dana", "there", or a merge tag such as {{{FIRST_NAME|there}}}.
  greetingName: string;
  // The lead's business name, or a merge tag.
  businessName: string;
  // Follow-up only: how long ago the first email went out, in words.
  timingPhrase?: string;
  // Where the Unsubscribe button points.
  unsubscribeUrl: string;
  // Override only for local previews; production images are served from the
  // live site (they ship in /public/email).
  assetBaseUrl?: string;
};

export type OutreachEmailContent = {
  subject: string;
  html: string;
  text: string;
};

export const OUTREACH_FIRST_SUBJECT = "Quick question about your Google reviews";
export const OUTREACH_FOLLOWUP_SUBJECT = "Following up on my note";

const HEADER_IMAGE = "/email/uptrend-email-header.png";
const MOMENTUM_IMAGE = "/email/uptrend-email-momentum.png";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "a couple of days ago" for a normal 2-day follow-up; honest wording when a
// follow-up goes out late (for example the backlog that missed its send).
export function followUpTimingPhrase(
  contactedAt: Date | null,
  now: Date = new Date(),
): string {
  if (!contactedAt) return "a couple of days ago";
  const days = Math.floor((now.getTime() - contactedAt.getTime()) / 86_400_000);
  if (days <= 4) return "a couple of days ago";
  if (days <= 9) return "last week";
  return "a little while ago";
}

type Copy = {
  preheader: string;
  intro: string[];
  question: string[];
  signoff: string[];
  ps: string;
};

function copyFor(input: OutreachEmailInput): Copy {
  const business = input.businessName;
  if (input.kind === "first") {
    return {
      preheader:
        "A quick idea for getting more Google reviews without chasing anyone.",
      intro: [
        "I run UpTrend Scaling. We text your customers a one-tap Google review link right after a job is done, plus one reminder if they forget, so reviews come in without you chasing anyone.",
      ],
      question: [
        `Would it be worth a quick look at how this would work for ${business}? There's a free 7-day trial and I'll help you set it up.`,
      ],
      signoff: ["Colby", "UpTrend Scaling | uptrendscaling.com"],
      ps: `P.S. Not a fit? Reply "no thanks" and I won't email again.`,
    };
  }
  const timing = input.timingPhrase ?? "a couple of days ago";
  return {
    preheader: "Just a quick follow up, no pressure.",
    intro: [
      `Quick follow up on my note from ${timing} about getting more Google reviews for ${business} on autopilot.`,
    ],
    question: [
      `If it's not a priority right now, no problem at all. If you'd like to see how it works, just reply "yes" and I'll send over a short walkthrough, or take a look at uptrendscaling.com.`,
    ],
    signoff: ["Colby", "UpTrend Scaling"],
    ps: `P.S. If this isn't a fit, reply "no thanks" and I won't email you again.`,
  };
}

export function renderOutreachEmail(
  input: OutreachEmailInput,
): OutreachEmailContent {
  const copy = copyFor(input);
  const subject =
    input.kind === "first" ? OUTREACH_FIRST_SUBJECT : OUTREACH_FOLLOWUP_SUBJECT;
  const assets = input.assetBaseUrl ?? CANONICAL_SITE_URL;
  const campaign = input.kind === "first" ? "first" : "followup";
  const ctaUrl = `${CANONICAL_SITE_URL}/?utm_source=cold_email&utm_medium=email&utm_campaign=${campaign}_v2`;

  const font =
    "'Poppins','Segoe UI',Helvetica,Arial,sans-serif";
  const paraHtml = (innerHtml: string, bottom = 16) =>
    `<p style="margin:0 0 ${bottom}px;font-family:${font};font-size:16px;line-height:1.65;color:#18181b;">${innerHtml}</p>`;
  const para = (text: string, bottom = 16) => paraHtml(escapeHtml(text), bottom);

  const greeting = escapeHtml(input.greetingName);
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(copy.preheader)}</div>
<div style="background:#f4f4f5;padding:24px 12px;font-family:${font};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <tr>
      <td style="padding:0;">
        <a href="${CANONICAL_SITE_URL}" style="text-decoration:none;"><img src="${assets}${HEADER_IMAGE}" width="600" alt="UpTrend Scaling" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></a>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 36px 8px;">
        ${paraHtml(`Hi ${greeting},`)}
        ${copy.intro.map((line) => para(line)).join("\n        ")}
      </td>
    </tr>
    <tr>
      <td style="padding:8px 36px 12px;">
        <img src="${assets}${MOMENTUM_IMAGE}" width="528" alt="Chart of Google reviews climbing over time" style="display:block;width:100%;max-width:528px;height:auto;border:0;border-radius:10px;">
      </td>
    </tr>
    <tr>
      <td style="padding:12px 36px 8px;">
        ${copy.question.map((line) => para(line)).join("\n        ")}
      </td>
    </tr>
    <tr>
      <td align="left" style="padding:4px 36px 24px;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-family:${font};font-weight:600;font-size:15px;padding:14px 30px;border-radius:8px;">See how it works</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 36px 8px;">
        <p style="margin:0;font-family:${font};font-size:16px;line-height:1.5;color:#18181b;"><strong>${escapeHtml(copy.signoff[0] ?? "")}</strong><br><span style="color:#6b6b70;font-size:14px;">${escapeHtml(copy.signoff[1] ?? "")}</span></p>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 36px 28px;">
        <p style="margin:0;font-family:${font};font-size:13px;line-height:1.6;color:#6b6b70;">${escapeHtml(copy.ps)}</p>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:22px 36px 28px;border-top:1px solid #e4e4e7;background:#fafafa;">
        <p style="margin:0 0 12px;font-family:${font};font-size:12px;line-height:1.5;color:#8b8b90;">Not interested in hearing from us?</p>
        <a href="${unsubscribeUrl}" style="display:inline-block;background:#ffffff;color:#3f3f46;text-decoration:none;font-family:${font};font-weight:600;font-size:13px;padding:10px 22px;border-radius:8px;border:1px solid #d4d4d8;">Unsubscribe</a>
      </td>
    </tr>
  </table>
</div>
</body>
</html>`;

  const text = [
    `Hi ${input.greetingName},`,
    "",
    ...copy.intro.flatMap((line) => [line, ""]),
    ...copy.question.flatMap((line) => [line, ""]),
    ...copy.signoff,
    "",
    copy.ps,
    "",
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
