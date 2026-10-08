import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { DashActivityFeed } from "./activity-feed";
import { DashBarChart } from "./bar-chart";
import { DashEmpty, DashPanel, DashSegmented } from "./primitives";
import { DashSetupChecklist } from "./setup-checklist";
import { DashStatCard } from "./stat-card";
import type { DashboardOverview, DashboardShell } from "./types";
import { useNow } from "./use-now";

type Range = "4W" | "12W" | "YTD";

const RANGE_HINT: Record<Range, string> = {
  "4W": "last 4 weeks",
  "12W": "last 12 weeks",
  YTD: "year to date",
};

function ChartPanel({ chart }: { chart: DashboardOverview["chart"] }) {
  const [range, setRange] = useState<Range>("12W");
  const count = range === "4W" ? 4 : range === "12W" ? 12 : chart.ytdWeeks;
  const weeks = chart.weeks.slice(-count);
  const hasData = weeks.some((week) => week.count > 0);

  return (
    <DashPanel
      title={chart.title}
      hint={RANGE_HINT[range]}
      className="dash-chart-panel"
      actions={
        <DashSegmented<Range>
          label="Time range"
          value={range}
          onChange={setRange}
          options={[
            { value: "4W", label: "4W" },
            { value: "12W", label: "12W" },
            { value: "YTD", label: "YTD" },
          ]}
        />
      }
    >
      <div className="dash-chart-wrap">
        <DashBarChart
          key={range}
          weeks={weeks}
          unitSingular={chart.unitSingular}
          unitPlural={chart.unitPlural}
        />
        {!hasData ? (
          <div className="dash-chart-empty">
            <DashEmpty compact title="Nothing to chart yet.">
              {chart.source === "google"
                ? "New Google reviews show up here as they come in."
                : "Weeks fill in as customers open their review links."}
            </DashEmpty>
          </div>
        ) : null}
      </div>
      {chart.note ? (
        <p className="dash-chart-note">
          {chart.note}
          {chart.noteOpensSettings ? (
            <>
              {" "}
              <Link to="/app" search={{ tab: "settings" }}>
                Connect Google
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </DashPanel>
  );
}

// The Overview tab: greeting, setup checklist (only while something is
// left), five stat cards, the weekly chart and the live activity feed.
export function OverviewTab({
  shell,
  overview,
  refresh,
}: {
  shell: DashboardShell;
  overview: DashboardOverview;
  refresh: () => void;
}) {
  const nowMs = useNow(shell.generatedAt);

  return (
    <div className="dash-overview">
      <section className="dash-hello">
        <div>
          <h1 className="dash-greeting">{overview.greeting}</h1>
          <p className="dash-subline">
            <strong>{overview.subline.strong}</strong>
            {overview.subline.rest}
          </p>
        </div>
        <div className="dash-hello-meta">
          <span>{overview.dateLine}</span>
          {overview.weeklyNote ? <span>{overview.weeklyNote}</span> : null}
        </div>
      </section>

      <DashSetupChecklist
        todos={shell.todos}
        quickbooksOffered={shell.quickbooksOffered}
        onChanged={refresh}
      />

      <section className="dash-stats" aria-label="Key numbers">
        {overview.stats.map((card) => (
          <DashStatCard key={card.id} data={card} />
        ))}
      </section>

      <section className="dash-main-grid">
        <ChartPanel chart={overview.chart} />
        <DashActivityFeed items={overview.activity} nowMs={nowMs} />
      </section>
    </div>
  );
}
