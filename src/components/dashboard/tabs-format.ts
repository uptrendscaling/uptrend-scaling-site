// Small pure helpers for the Requests, Reports and QR codes tabs: time labels,
// the CSV for the report download and a few file-name helpers. No React, no
// server code, nothing that touches the browser, so they are easy to test.

import { relativeShort } from "./format";
import type { ReportsData } from "./tabs-types";

// "Just now", "14m ago", "3h ago", "2d ago", then a short date in the
// business's own timezone ("Oct 3", or "Oct 3, 2025" for another year).
export function whenLabel(
  iso: string,
  nowMs: number,
  timeZone: string,
): string {
  const short = relativeShort(iso, nowMs);
  if (short === "now") return "Just now";
  if (/^\d+[mhd]$/.test(short)) return `${short} ago`;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const sameYear =
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(
      then,
    ) ===
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(
      new Date(nowMs),
    );
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(then);
}

// "Oct 6, 9:31 AM" for the second line under the relative time.
export function shortStamp(iso: string, timeZone: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(then);
}

// "Tuesday, October 6, 2026 at 9:31 AM MST" for the hover tooltip.
export function fullStamp(iso: string, timeZone: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(then);
}

function monthDay(utcMs: number): string {
  return new Date(utcMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// "Oct 5 to Oct 11" for the week that starts on the given Monday
// (YYYY-MM-DD). The dates are calendar dates, so no timezone is involved.
export function weekRangeLabel(weekStart: string): string {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  if (!Number.isFinite(start)) return weekStart;
  return `${monthDay(start)} to ${monthDay(start + 6 * 24 * 60 * 60 * 1000)}`;
}

// ------------------------------------------------------------------- CSV

// A CSV cell. Numbers and dates need no quoting, but text containing a
// comma, a quote or a line break does.
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// The weekly table as a CSV, in the same order as on screen (newest week
// first) with the same columns. The Google column is only there when the
// table shows it.
export function buildReportCsv(data: ReportsData): string {
  const header = [
    "Week starting (Monday)",
    "Requests sent",
    "Reminders sent",
    "Review links opened",
    "Marked reviewed",
    "QR scans",
    ...(data.hasGoogle ? ["Google reviews posted"] : []),
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const week of data.weeks) {
    const cells: Array<string | number> = [
      week.weekStart,
      week.requests,
      week.reminders,
      week.linksOpened,
      week.reviewed,
      week.qrScans,
    ];
    if (data.hasGoogle) cells.push(week.googleReviews ?? 0);
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// "ace-plumbing-drain" for use in a file name.
export function fileSlug(text: string, fallback = "uptrend"): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

// YYYY-MM-DD for "today" in the business's timezone, for file names.
export function todayStamp(timeZone: string, nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
  return parts;
}

// ------------------------------------------------------------------- QR

// The server's QR markup has a viewBox but no width or height, so it fills
// whatever box it is put in. A saved file needs a real size or it opens as a
// giant image, and a canvas needs one to draw at all.
export function svgWithSize(svg: string, pixels: number): string {
  return svg.replace(/<svg\b/, `<svg width="${pixels}" height="${pixels}"`);
}
