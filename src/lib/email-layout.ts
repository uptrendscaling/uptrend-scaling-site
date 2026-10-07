// One shared look for every email UpTrend Scaling sends about the account
// itself: the welcome email to a new client, and the heads-up emails to the
// owner when someone starts a free trial or pays. It is the same design as the
// cold-outreach emails (see ./outreach-email.ts): a dark wordmark header, a
// white card on a light grey page, Poppins type, a dark button, a plain
// sign-off and a quiet footer.
//
// Pure functions with no server-only imports, so the same code can be run from
// a script to preview the emails.
//
// Layout notes (same reasons as the outreach emails): table-based with inline
// styles, which is the only thing that renders consistently in Gmail, Apple
// Mail and Outlook; a light body so automatic dark-mode inversion cannot break
// it; and deliberately NO images, because many inboxes block remote images from
// senders they do not know and the old logo and screenshot turned into empty
// boxes. Everything here is plain text and colored table cells.

import { CANONICAL_SITE_URL } from "./site";

export const EMAIL_FONT = "'Poppins','Segoe UI',Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A paragraph. `innerHtml` must already be escaped or be markup we wrote.
export function paraHtml(innerHtml: string, bottom = 16): string {
  return `<p style="margin:0 0 ${bottom}px;font-family:${EMAIL_FONT};font-size:16px;line-height:1.65;color:#18181b;">${innerHtml}</p>`;
}

// A paragraph from plain text (escaped for you).
export function para(text: string, bottom = 16): string {
  return paraHtml(escapeHtml(text), bottom);
}

// The small grey line under a headline or inside a note.
export function mutedPara(text: string, bottom = 12): string {
  return `<p style="margin:0 0 ${bottom}px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.6;color:#52525b;">${escapeHtml(text)}</p>`;
}

// Small spaced-out capital label, like "REVIEW MOMENTUM" in the outreach email.
export function eyebrow(text: string, bottom = 10): string {
  return `<p style="margin:0 0 ${bottom}px;font-family:${EMAIL_FONT};font-size:11px;line-height:1.4;letter-spacing:2px;color:#6b6b70;font-weight:600;">${escapeHtml(text.toUpperCase())}</p>`;
}

// The big dark button ("primary") or the quieter outlined one ("secondary").
export function button(
  label: string,
  url: string,
  variant: "primary" | "secondary" = "primary",
): string {
  const look =
    variant === "primary"
      ? "background:#18181b;color:#ffffff;font-size:15px;padding:14px 30px;"
      : "background:#ffffff;color:#3f3f46;font-size:14px;padding:11px 24px;border:1px solid #d4d4d8;";
  return `<a href="${escapeHtml(url)}" style="display:inline-block;${look}text-decoration:none;font-family:${EMAIL_FONT};font-weight:600;border-radius:8px;">${escapeHtml(label)}</a>`;
}

// The light grey bordered box used for the chart in the outreach email. Holds
// anything: pass already-built table rows or markup as `innerHtml`.
export function card(label: string | null, innerHtml: string): string {
  const heading = label
    ? `<tr>
            <td style="padding:16px 20px 6px;font-family:${EMAIL_FONT};font-size:11px;line-height:1.4;letter-spacing:2px;color:#6b6b70;font-weight:600;">${escapeHtml(label.toUpperCase())}</td>
          </tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f5" style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:10px;">
          ${heading}
          <tr>
            <td style="padding:${label ? "6px" : "16px"} 20px 16px;">
              ${innerHtml}
            </td>
          </tr>
        </table>`;
}

export type DetailRow = { label: string; value: string };

// Label on the left, value on the right, a thin rule between rows. Goes inside
// card(). The last row has no rule under it.
export function detailRows(rows: DetailRow[]): string {
  const lastIndex = rows.length - 1;
  const body = rows
    .map((row, index) => {
      const rule = index === lastIndex ? "" : "border-bottom:1px solid #e4e4e7;";
      return `<tr>
                <td class="stack stack-label" valign="top" width="120" style="padding:9px 12px 9px 0;width:120px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;color:#6b6b70;${rule}">${escapeHtml(row.label)}</td>
                <td class="stack stack-value" valign="top" style="padding:9px 0;font-family:${EMAIL_FONT};font-size:15px;line-height:1.5;color:#18181b;word-break:break-word;${rule}">${escapeHtml(row.value)}</td>
              </tr>`;
    })
    .join("\n              ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${body}
            </table>`;
}

// Numbered steps (dark circle, bold title, grey explanation). Goes inside card().
export function steps(items: Array<{ title: string; detail: string }>): string {
  const lastIndex = items.length - 1;
  const body = items
    .map((item, index) => {
      const bottom = index === lastIndex ? 0 : 18;
      return `<tr>
                <td width="38" valign="top" style="padding:0 0 ${bottom}px;">
                  <div style="width:26px;height:26px;border-radius:13px;background:#18181b;color:#ffffff;font-family:${EMAIL_FONT};font-size:13px;font-weight:700;line-height:26px;text-align:center;">${index + 1}</div>
                </td>
                <td valign="top" style="padding:0 0 ${bottom}px;">
                  <p style="margin:0;font-family:${EMAIL_FONT};font-size:15px;line-height:1.55;color:#18181b;"><strong>${escapeHtml(item.title)}</strong><br><span style="color:#6b6b70;">${escapeHtml(item.detail)}</span></p>
                </td>
              </tr>`;
    })
    .join("\n              ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${body}
            </table>`;
}

// "Colby" in bold with a grey line under it, as at the end of the outreach email.
export function signoff(name: string, line: string): string {
  return `<p style="margin:0;font-family:${EMAIL_FONT};font-size:16px;line-height:1.5;color:#18181b;"><strong>${escapeHtml(name)}</strong><br><span style="color:#6b6b70;font-size:14px;">${escapeHtml(line)}</span></p>`;
}

export type EmailSection = {
  html: string;
  // Space above and below this block, in px. Defaults suit a run of paragraphs.
  top?: number;
  bottom?: number;
  align?: "left" | "center";
};

export type EmailShellInput = {
  // Becomes the page <title>. The real subject line is set when sending.
  subject: string;
  // The grey preview line some inboxes show next to the subject.
  preheader: string;
  // The small spaced capitals under the wordmark. The outreach emails say
  // GOOGLE REVIEWS ON AUTOPILOT; the owner alerts say what happened instead.
  tagline: string;
  sections: EmailSection[];
  // Quiet grey text in the footer strip. Plain text.
  footerLines: string[];
  // Optional full-width strip under the header (used for the Stripe test-mode
  // warning). Plain text.
  bannerText?: string | null;
};

export function emailShell(input: EmailShellInput): string {
  const sections = input.sections
    .map((section) => {
      const top = section.top ?? 8;
      const bottom = section.bottom ?? 8;
      const align = section.align ?? "left";
      return `<tr>
      <td class="pad" align="${align}" style="padding:${top}px 36px ${bottom}px;">
        ${section.html}
      </td>
    </tr>`;
    })
    .join("\n    ");

  const banner = input.bannerText
    ? `<tr>
      <td class="pad" bgcolor="#fef9c3" style="background:#fef9c3;padding:10px 36px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.5;font-weight:600;color:#713f12;">${escapeHtml(input.bannerText)}</td>
    </tr>`
    : "";

  const footer = input.footerLines
    .map(
      (line, index) =>
        `<p style="margin:${index === 0 ? "0" : "6px"} 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:#8b8b90;">${escapeHtml(line)}</p>`,
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(input.subject)}</title>
<style>
  @media only screen and (max-width: 480px) {
    .pad { padding-left: 22px !important; padding-right: 22px !important; }
    .stack { display: block !important; width: 100% !important; }
    .stack-label { padding: 9px 0 0 !important; border-bottom: 0 !important; }
    .stack-value { padding: 2px 0 9px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
<div style="background:#f4f4f5;padding:24px 12px;font-family:${EMAIL_FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <tr>
      <td class="pad" align="center" bgcolor="#0b0b0c" style="background:#0b0b0c;padding:26px 36px 24px;">
        <a href="${CANONICAL_SITE_URL}" style="text-decoration:none;font-family:${EMAIL_FONT};font-size:28px;line-height:1.2;font-weight:700;color:#fafafa;letter-spacing:-0.5px;">UpTrend <span style="font-weight:400;color:#a1a1aa;">Scaling</span></a>
        <div style="margin-top:6px;font-family:${EMAIL_FONT};font-size:11px;line-height:1.4;letter-spacing:2px;color:#8d8d93;">${escapeHtml(input.tagline.toUpperCase())}</div>
      </td>
    </tr>
    ${banner}
    ${sections}
    <tr>
      <td class="pad" align="center" style="padding:22px 36px 26px;border-top:1px solid #e4e4e7;background:#fafafa;">
        ${footer}
      </td>
    </tr>
  </table>
</div>
</body>
</html>`;
}
