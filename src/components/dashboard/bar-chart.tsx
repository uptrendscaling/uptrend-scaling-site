import type { CSSProperties } from "react";

import {
  cx,
  movingAverage,
  niceScale,
  shortWeekLabel,
  smoothPath,
} from "./format";

type Week = { weekStart: string; count: number };

// Bars with a white to grey gradient and a soft glow, faint gridlines on a
// friendly 0 to N axis, and a smooth dashed trend line (3 week moving
// average) over the top. Pure CSS layout plus one stretched SVG, so it is
// responsive without measuring anything.
export function DashBarChart({
  weeks,
  unitSingular,
  unitPlural,
  className,
}: {
  weeks: Week[];
  unitSingular: string;
  unitPlural: string;
  className?: string;
}) {
  const counts = weeks.map((week) => week.count);
  const { max, ticks } = niceScale(Math.max(0, ...counts));
  const count = weeks.length;
  const hasData = counts.some((value) => value > 0);

  const trendPoints: Array<[number, number]> = movingAverage(counts, 3).map(
    (value, index) => [
      ((index + 0.5) / Math.max(count, 1)) * 100,
      100 - (value / max) * 100,
    ],
  );
  const dense = count > 26;
  const sparse = count <= 6;

  return (
    <div
      className={cx(
        "dash-chart",
        dense && "is-dense",
        sparse && "is-sparse",
        !hasData && "is-empty",
        className,
      )}
    >
      <div className="dash-chart-axis" aria-hidden="true">
        {ticks
          .filter((tick) => tick > 0)
          .map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / max) * 100}%` }}>
              {tick}
            </span>
          ))}
      </div>
      <div className="dash-chart-plot">
        {ticks.map((tick) => (
          <div
            key={tick}
            className="dash-chart-grid"
            style={{ bottom: `${(tick / max) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <div className="dash-chart-bars">
          {weeks.map((week, index) => {
            const value = week.count;
            const label = `Week of ${shortWeekLabel(week.weekStart)}: ${value} ${value === 1 ? unitSingular : unitPlural}`;
            const edge =
              index >= count - 2 && count > 4
                ? "is-edge-right"
                : index === 0 && count > 4
                  ? "is-edge-left"
                  : undefined;
            return (
              <div
                key={week.weekStart}
                className={cx("dash-bar-col", edge)}
                role="img"
                aria-label={label}
                tabIndex={0}
                style={{ "--i": index } as CSSProperties}
              >
                <div
                  className={cx("dash-bar", value === 0 && "is-zero")}
                  style={{ height: `${(value / max) * 100}%` }}
                >
                  <span className="dash-bar-tip">
                    <span>
                      <strong>{value}</strong>{" "}
                      {value === 1 ? unitSingular : unitPlural}
                    </span>
                    <em>Week of {shortWeekLabel(week.weekStart)}</em>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {hasData && count > 1 ? (
          <svg
            className="dash-chart-trend"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d={smoothPath(trendPoints)}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
      </div>
    </div>
  );
}
