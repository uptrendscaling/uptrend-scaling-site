import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ProgressPoint } from "../lib/reviews.server";

// Shared by the business dashboard (its own progress) and the admin master
// view (one client's progress, or every client combined) -- same shape of
// data either way, so one chart component covers both.

function formatWeekLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ProgressChart({ series }: { series: ProgressPoint[] }) {
  const hasData = series.some(
    (point) =>
      point.cumulativeCustomers > 0 ||
      point.messagesSent > 0 ||
      point.linkClicks > 0 ||
      point.reviewed > 0,
  );

  if (!hasData) {
    return (
      <p className="app-panel-hint">
        Not enough data yet to chart — add a customer to get started.
      </p>
    );
  }

  const data = series.map((point) => ({ ...point, label: formatWeekLabel(point.weekStart) }));

  return (
    <div className="progress-chart">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="customersFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.97 0 0)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="oklch(0.97 0 0)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="oklch(0.28 0 0)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="oklch(0.7 0 0)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="oklch(0.7 0 0)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "oklch(0.19 0 0)",
              border: "1px solid oklch(0.28 0 0)",
              borderRadius: 4,
              fontSize: 12,
            }}
            labelStyle={{ color: "oklch(0.97 0 0)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="cumulativeCustomers"
            name="Total customers"
            stroke="oklch(0.97 0 0)"
            fill="url(#customersFill)"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="messagesSent"
            name="Messages sent"
            stroke="oklch(0.7 0.14 200)"
            strokeWidth={1.6}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="linkClicks"
            name="Link clicks"
            stroke="oklch(0.75 0.16 140)"
            strokeWidth={1.6}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="reviewed"
            name="Marked reviewed"
            stroke="oklch(0.75 0.18 60)"
            strokeWidth={1.6}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
