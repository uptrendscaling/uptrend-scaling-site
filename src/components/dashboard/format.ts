// Small pure helpers for the dashboard: relative times, initials, chart
// scales and smooth line paths. No React, no server code.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "now", "2m", "14m", "1h", "3h", "2d", then a short date for older things.
export function relativeShort(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, nowMs - then);
  if (diff < MINUTE) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// "just now", "2m ago", "3h ago", "2d ago" (for chips like "synced 2m ago").
export function agoPhrase(iso: string, nowMs: number): string {
  const short = relativeShort(iso, nowMs);
  if (short === "now") return "just now";
  if (/^\d+[mhd]$/.test(short)) return `${short} ago`;
  return `on ${short}`;
}

// First letters of the first two words: "Ace Plumbing & Drain" is "AP".
export function initialsOf(businessName: string): string {
  const words = businessName
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return letters || "U";
}

// "Sep 28" for a YYYY-MM-DD week start.
export function shortWeekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ghost" | "quiet" | "danger";

// Class names for a dash button, for links that need to look like one.
export function dashButtonClass(
  variant: ButtonVariant = "ghost",
  size: "md" | "sm" = "md",
  className?: string,
): string {
  return cx(
    "dash-btn",
    `dash-btn-${variant}`,
    size === "sm" && "dash-btn-sm",
    className,
  );
}

// ------------------------------------------------------------ chart maths

// A friendly axis: 0, 5, 10, 15, 20 for a maximum of 18.
export function niceScale(
  maxValue: number,
  targetIntervals = 4,
): { max: number; ticks: number[] } {
  const rawStep = Math.max(maxValue, 1) / targetIntervals;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceNormalized =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, niceNormalized * magnitude);
  const max = Math.max(
    step * 2,
    Math.ceil(Math.max(maxValue, 1) / step) * step,
  );
  const ticks: number[] = [];
  for (let value = 0; value <= max + 1e-9; value += step) ticks.push(value);
  return { max, ticks };
}

// Centered moving average; the ends use whatever neighbours exist.
export function movingAverage(values: number[], windowSize = 3): number[] {
  const half = Math.floor(windowSize / 2);
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = index - half; i <= index + half; i++) {
      const value = values[i];
      if (value !== undefined) {
        sum += value;
        count += 1;
      }
    }
    return count ? sum / count : 0;
  });
}

const fixed = (value: number) => value.toFixed(2);

// Smooth path through the points that never overshoots (monotone cubic).
export function smoothPath(points: Array<[number, number]>): string {
  const n = points.length;
  const first = points[0];
  if (!first) return "";
  if (n === 1) return `M${fixed(first[0])},${fixed(first[1])}`;

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const width = (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    dx.push(width);
    slope.push(width === 0 ? 0 : ((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / width);
  }

  const tangent: number[] = new Array<number>(n).fill(0);
  tangent[0] = slope[0] ?? 0;
  tangent[n - 1] = slope[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const before = slope[i - 1] ?? 0;
    const after = slope[i] ?? 0;
    tangent[i] = before * after <= 0 ? 0 : (before + after) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const m = slope[i] ?? 0;
    if (m === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = (tangent[i] ?? 0) / m;
    const b = (tangent[i + 1] ?? 0) / m;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangent[i] = tau * a * m;
      tangent[i + 1] = tau * b * m;
    }
  }

  let path = `M${fixed(first[0])},${fixed(first[1])}`;
  for (let i = 0; i < n - 1; i++) {
    const width = dx[i] ?? 0;
    const x0 = xs[i] ?? 0;
    const y0 = ys[i] ?? 0;
    const x1 = xs[i + 1] ?? 0;
    const y1 = ys[i + 1] ?? 0;
    path += ` C${fixed(x0 + width / 3)},${fixed(y0 + ((tangent[i] ?? 0) * width) / 3)} ${fixed(x1 - width / 3)},${fixed(y1 - ((tangent[i + 1] ?? 0) * width) / 3)} ${fixed(x1)},${fixed(y1)}`;
  }
  return path;
}
