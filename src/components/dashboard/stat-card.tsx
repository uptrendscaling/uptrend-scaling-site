import { Link } from "@tanstack/react-router";

import { cx, smoothPath } from "./format";
import { dashButtonClass } from "./format";
import { DashPill } from "./primitives";
import { IconStar } from "./icons";
import type { StatCardData } from "./types";

// The little trend line at the right of a stat card. Values are plain
// numbers, oldest first; the line is scaled to fit and drawn smooth.
export function DashSpark({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  // A line of all zeros says nothing, so draw nothing.
  if (max === 0 && min === 0) return null;
  const top = 5;
  const bottom = 31;
  const points: Array<[number, number]> = values.map((value, index) => [
    (index / (values.length - 1)) * 100,
    range === 0 ? 18 : bottom - ((value - min) / range) * (bottom - top),
  ]);
  return (
    <svg
      className={cx("dash-spark", range === 0 && "is-flat", className)}
      viewBox="0 0 100 36"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={smoothPath(points)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Five small stars; `value` (0 to 5) fills them from the left, partly if
// needed (4.9 fills four and nine tenths of the fifth).
export function DashStars({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, (value / 5) * 100));
  const row = (
    <>
      {[0, 1, 2, 3, 4].map((index) => (
        <IconStar key={index} size={12} />
      ))}
    </>
  );
  return (
    <span
      className="dash-stars"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      <span className="dash-stars-base">{row}</span>
      <span className="dash-stars-fill" style={{ width: `${percent}%` }}>
        {row}
      </span>
    </span>
  );
}

// One of the five cards on Overview: tiny mono label, big number, small pill
// and a sparkline. The Google rating card turns into a "Connect Google" call
// to action (never a made-up number) when there is no real data.
export function DashStatCard({ data }: { data: StatCardData }) {
  const classes = cx(
    "dash-stat",
    data.hero && "dash-stat-hero",
    data.cta && "dash-stat-cta",
  );

  if (data.cta) {
    return (
      <article className={classes}>
        <div className="dash-stat-label">{data.label}</div>
        <div className="dash-stat-cta-body">
          <p className="dash-stat-cta-title">Not connected</p>
          <p className="dash-stat-cta-text">{data.cta.text}</p>
          {data.cta.button ? (
            <Link
              to="/app"
              search={{ tab: "settings" }}
              className={dashButtonClass("primary", "sm")}
            >
              {data.cta.button}
            </Link>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <article className={classes} title={data.tip ?? undefined}>
      <div className="dash-stat-label">{data.label}</div>
      <div className="dash-stat-main">
        {data.value !== null ? (
          <>
            <span className="dash-stat-value">{data.value}</span>
            {data.unit ? (
              <span className="dash-stat-unit">{data.unit}</span>
            ) : null}
            {data.stars !== null ? <DashStars value={data.stars} /> : null}
          </>
        ) : (
          <span className="dash-stat-empty">
            {data.emptyText ?? "No data yet"}
          </span>
        )}
      </div>
      <div className="dash-stat-foot">
        <div className="dash-stat-foot-text">
          {data.pill ? (
            <DashPill tone={data.pill.tone}>{data.pill.text}</DashPill>
          ) : null}
          {data.hint ? <p className="dash-stat-hint">{data.hint}</p> : null}
        </div>
        {data.spark ? <DashSpark values={data.spark} /> : null}
      </div>
    </article>
  );
}
