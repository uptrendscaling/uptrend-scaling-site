import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GoogleStatus } from "../../lib/dashboard-types";
import { getReportsData } from "../../lib/dashboard-tabs.server";
import { DashBarChart } from "./bar-chart";
import { cx, dashButtonClass } from "./format";
import {
  DashAlert,
  DashButton,
  DashEmpty,
  DashPageHead,
  DashPanel,
  DashPill,
  DashSegmented,
  DashTable,
} from "./primitives";
import { downloadText } from "./tabs-browser";
import {
  buildReportCsv,
  fileSlug,
  todayStamp,
  weekRangeLabel,
} from "./tabs-format";
import { IconBars, IconDownload } from "./tabs-icons";
import type { ReportsData, ReportWeek } from "./tabs-types";
import type { DashboardTabProps } from "./types";

type ChartMetric = "requests" | "linksOpened" | "qrScans" | "googleReviews";

const CHART_COPY: Record<
  ChartMetric,
  { title: string; singular: string; plural: string }
> = {
  requests: {
    title: "Requests sent per week",
    singular: "request",
    plural: "requests",
  },
  linksOpened: {
    title: "Review links opened per week",
    singular: "review link opened",
    plural: "review links opened",
  },
  qrScans: {
    title: "QR code scans per week",
    singular: "scan",
    plural: "scans",
  },
  googleReviews: {
    title: "Google reviews per week",
    singular: "review",
    plural: "reviews",
  },
};

// What each column counts, shown as a tooltip on the column title.
const COLUMN_TIPS = {
  requests: "Customers we sent a first review request to.",
  reminders:
    "Customers we sent a reminder to, because their review link was still unopened after 2 days.",
  linksOpened: "Customers who opened their review link.",
  reviewed: "Customers you marked as reviewed.",
  qrScans: "Times someone scanned one of your QR codes.",
  googleReviews: "New reviews posted on your Google Business Profile.",
} as const;

// A small note for when the Google column is left out, saying why and what
// would turn it on.
function googleNote(google: GoogleStatus): {
  text: string;
  link: string | null;
} {
  if (!google.configured) {
    return {
      text: "Reviews customers post on Google will get their own column here once Google approves our connection.",
      link: null,
    };
  }
  if (google.connected && google.needsReconnect) {
    return {
      text: "Google access was lost, so the column for reviews customers post is hidden for now.",
      link: "Reconnect Google in Settings",
    };
  }
  if (google.connected && google.awaitingLocation) {
    return {
      text: "Pick your business location to add a column for the reviews customers post.",
      link: "Choose your location in Settings",
    };
  }
  if (google.connected) {
    return {
      text: "Google is connected. A column for the reviews customers post appears after the first sync.",
      link: null,
    };
  }
  return {
    text: "Connect Google to add a column for the reviews customers actually post.",
    link: "Connect Google in Settings",
  };
}

function GoogleNote({
  google,
  centered,
}: {
  google: GoogleStatus;
  centered?: boolean;
}) {
  const note = googleNote(google);
  return (
    <p className={cx("dash-reports-note", centered && "is-centered")}>
      {note.text}
      {note.link ? (
        <>
          {" "}
          <Link to="/app" search={{ tab: "settings" }}>
            {note.link}
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

// --------------------------------------------------------------- the pieces

function MonthRow({ data }: { data: ReportsData }) {
  return (
    <section aria-label="This month compared with last month">
      <div className="dash-cmp-head">
        <h2>{data.thisMonthLabel} so far</h2>
        <span className="dash-panel-hint">
          compared with all of {data.lastMonthLabel}
        </span>
      </div>
      <div className="dash-cmp-grid">
        {data.comparison.map((item) => (
          <div key={item.key} className="dash-cmp">
            <span className="dash-cmp-label">{item.label}</span>
            <span className="dash-cmp-value">
              {item.thisMonth.toLocaleString("en-US")}
            </span>
            <DashPill tone={item.pill.tone}>{item.pill.text}</DashPill>
          </div>
        ))}
      </div>
    </section>
  );
}

function WeeklyChart({ data }: { data: ReportsData }) {
  const [metric, setMetric] = useState<ChartMetric>("requests");
  const copy = CHART_COPY[metric];
  // The chart wants the oldest week first.
  const weeks = useMemo(
    () =>
      [...data.weeks].reverse().map((week) => ({
        weekStart: week.weekStart,
        count: week[metric] ?? 0,
      })),
    [data.weeks, metric],
  );
  const hasData = weeks.some((week) => week.count > 0);
  const options: Array<{ value: ChartMetric; label: string }> = [
    { value: "requests", label: "Requests" },
    { value: "linksOpened", label: "Opened" },
    { value: "qrScans", label: "Scans" },
    ...(data.hasGoogle
      ? [{ value: "googleReviews" as const, label: "Reviews" }]
      : []),
  ];

  return (
    <DashPanel
      title={copy.title}
      hint="last 12 weeks"
      className="dash-chart-panel dash-reports-chart"
      actions={
        <DashSegmented<ChartMetric>
          label="What to chart"
          value={metric}
          onChange={setMetric}
          options={options}
        />
      }
    >
      <div className="dash-chart-wrap">
        <DashBarChart
          key={metric}
          weeks={weeks}
          unitSingular={copy.singular}
          unitPlural={copy.plural}
        />
        {!hasData ? (
          <div className="dash-chart-empty">
            <DashEmpty compact title="Nothing to chart for this yet.">
              Weeks fill in as the numbers come in.
            </DashEmpty>
          </div>
        ) : null}
      </div>
    </DashPanel>
  );
}

// One number in the table. The label is only used on phones, where each week
// becomes a small card and the column titles are printed beside the numbers.
function Count({ value, label }: { value: number; label: string }) {
  return (
    <td className={cx("dash-num", value === 0 && "is-zero")} data-label={label}>
      {value.toLocaleString("en-US")}
    </td>
  );
}

function WeekRow({
  week,
  current,
  showGoogle,
}: {
  week: ReportWeek;
  current: boolean;
  showGoogle: boolean;
}) {
  return (
    <tr className={cx(current && "is-current")}>
      <th scope="row" className="dash-week-cell">
        <span className="dash-cell-strong">
          {weekRangeLabel(week.weekStart)}
        </span>
        {current ? <DashPill>This week</DashPill> : null}
      </th>
      <Count value={week.requests} label="Requests sent" />
      <Count value={week.reminders} label="Reminders sent" />
      <Count value={week.linksOpened} label="Links opened" />
      <Count value={week.reviewed} label="Marked reviewed" />
      <Count value={week.qrScans} label="QR scans" />
      {showGoogle ? (
        <Count value={week.googleReviews ?? 0} label="Google reviews" />
      ) : null}
    </tr>
  );
}

function WeekTable({
  data,
  google,
}: {
  data: ReportsData;
  google: GoogleStatus;
}) {
  return (
    <DashPanel
      title="Week by week"
      hint="newest first, weeks run Monday to Sunday"
    >
      <DashTable className="dash-week-table">
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col" className="dash-num" title={COLUMN_TIPS.requests}>
              Requests sent
            </th>
            <th scope="col" className="dash-num" title={COLUMN_TIPS.reminders}>
              Reminders sent
            </th>
            <th
              scope="col"
              className="dash-num"
              title={COLUMN_TIPS.linksOpened}
            >
              Links opened
            </th>
            <th scope="col" className="dash-num" title={COLUMN_TIPS.reviewed}>
              Marked reviewed
            </th>
            <th scope="col" className="dash-num" title={COLUMN_TIPS.qrScans}>
              QR scans
            </th>
            {data.hasGoogle ? (
              <th
                scope="col"
                className="dash-num"
                title={COLUMN_TIPS.googleReviews}
              >
                Google reviews posted
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.weeks.map((week, index) => (
            <WeekRow
              key={week.weekStart}
              week={week}
              current={index === 0}
              showGoogle={data.hasGoogle}
            />
          ))}
        </tbody>
      </DashTable>
      <p className="dash-reports-note">
        Requests and reminders count customers, so someone who got both a text
        and an email counts once. Times are in your time zone,{" "}
        {data.timezone.replace(/_/g, " ")}.
      </p>
      {data.hasGoogle ? null : <GoogleNote google={google} />}
    </DashPanel>
  );
}

type ReportState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ReportsData };

function ReportsSkeleton() {
  return (
    <>
      <DashPanel>
        <div className="dash-skel-list" aria-hidden="true">
          <div className="dash-skel-row">
            <span className="dash-skel" style={{ width: "18%" }} />
            <span className="dash-skel" style={{ width: "18%" }} />
            <span className="dash-skel" style={{ width: "18%" }} />
          </div>
        </div>
      </DashPanel>
      <DashPanel>
        <div className="dash-skel-list" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="dash-skel-row">
              <span className="dash-skel" style={{ width: "22%" }} />
              <span className="dash-skel" style={{ width: "30%" }} />
            </div>
          ))}
        </div>
      </DashPanel>
    </>
  );
}

// The Reports tab: this month against last month, one weekly chart, and a
// 12 week table that can be downloaded as a CSV for a spreadsheet.
export function ReportsTab({ business, shell }: DashboardTabProps) {
  const [report, setReport] = useState<ReportState>({ status: "loading" });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getReportsData();
      setReport(
        result.ok
          ? { status: "ready", data: result.data }
          : { status: "error", message: result.message },
      );
    } catch (error) {
      console.error(error);
      setReport({
        status: "error",
        message:
          "We couldn't load your reports just now. Please refresh and try again.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const data = report.status === "ready" ? report.data : null;

  // Built in the browser from the numbers already on screen, so the file
  // always matches the table.
  function handleDownload() {
    if (!data) return;
    setDownloadError(null);
    try {
      downloadText(
        buildReportCsv(data),
        `${fileSlug(business.businessName)}-weekly-report-${todayStamp(data.timezone, Date.now())}.csv`,
        "text/csv;charset=utf-8",
      );
    } catch (error) {
      console.error(error);
      setDownloadError(
        "We couldn't make the file in this browser. Try again, or copy the numbers from the table.",
      );
    }
  }

  return (
    <div className="dash-stack">
      <DashPageHead
        title="Reports"
        description="Your results over time, in plain numbers."
        actions={
          <DashButton
            variant="ghost"
            onClick={handleDownload}
            disabled={!data || !data.hasAnyData}
          >
            <IconDownload size={15} />
            Download CSV
          </DashButton>
        }
      />

      {downloadError ? (
        <DashAlert tone="error">{downloadError}</DashAlert>
      ) : null}

      {report.status === "loading" ? <ReportsSkeleton /> : null}

      {report.status === "error" ? (
        <DashPanel>
          <DashAlert tone="error">{report.message}</DashAlert>
          <DashButton
            size="sm"
            onClick={() => {
              setReport({ status: "loading" });
              void load();
            }}
          >
            Try again
          </DashButton>
        </DashPanel>
      ) : null}

      {data && !data.hasAnyData ? (
        <DashPanel>
          <DashEmpty
            icon={<IconBars size={18} />}
            title="No results yet."
            action={
              <Link
                to="/app"
                search={{ tab: "customers" }}
                className={dashButtonClass("primary")}
              >
                Add a customer
              </Link>
            }
          >
            Once your first review requests go out, this page fills in week by
            week: requests sent, reminders, review links opened and QR code
            scans.
          </DashEmpty>
          {data.hasGoogle ? null : (
            <GoogleNote centered google={shell.google} />
          )}
        </DashPanel>
      ) : null}

      {data && data.hasAnyData ? (
        <>
          <MonthRow data={data} />
          <WeeklyChart data={data} />
          <WeekTable data={data} google={shell.google} />
        </>
      ) : null}
    </div>
  );
}
