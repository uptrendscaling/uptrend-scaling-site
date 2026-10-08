import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { z } from "zod";

import {
  getAdminAnalyticsOverview,
  type AnalyticsOverview,
} from "../lib/analytics.server";
import { cx, dashButtonClass } from "../components/dashboard/format";
import { IconTrend } from "../components/dashboard/icons";
import { ThemeToggle } from "../components/theme-toggle";
import {
  DashButton,
  DashEmpty,
  DashPageHead,
  DashPanel,
  DashPill,
  DashSegmented,
  DashSelect,
  DashTable,
} from "../components/dashboard/primitives";
import { DashSpark } from "../components/dashboard/stat-card";
import { ProgressChart } from "../components/progress-chart";
import {
  getLeadsOverview,
  markLeadResponded,
  type LeadSummary,
} from "../lib/leads.server";
import {
  getAdminOverview,
  getAdminProgressSeries,
  getCurrentBusiness,
  logoutBusiness,
  type AdminBusinessSummary,
  type ProgressPoint,
} from "../lib/reviews.server";

// The three screens of the admin area, shown as tabs in the top bar (same
// idea as the client dashboard). All of the data loads once with the page, so
// switching tabs is instant.
const ADMIN_TABS = ["overview", "clients", "outreach"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

const ADMIN_NAV: ReadonlyArray<{ id: AdminTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "clients", label: "Clients" },
  { id: "outreach", label: "Outreach" },
];

const searchSchema = z.object({
  // Missing or unknown means Overview.
  tab: z.enum(ADMIN_TABS).optional().catch(undefined),
});

const EMPTY_ANALYTICS: AnalyticsOverview = {
  visitsToday: 0,
  visitsThisWeek: 0,
  clicksThisWeek: 0,
  avgSessionMinutes: 0,
  activeNow: [],
  loggedInBusinesses: [],
  topLocations: [],
};

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin | UpTrend Scaling" }],
  }),
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  loader: async () => {
    const business = await getCurrentBusiness();
    if (!business) {
      throw redirect({ to: "/login" });
    }
    const overview = await getAdminOverview();
    if (!overview.ok) {
      // Either not an admin account, or the CRM isn't configured yet --
      // either way this screen isn't for them.
      throw redirect({ to: "/app" });
    }
    const combinedSeries = await getAdminProgressSeries({ data: {} });
    const leadsOverview = await getLeadsOverview();
    const analytics = await getAdminAnalyticsOverview();
    return {
      business,
      businesses: overview.businesses,
      combinedSeries: combinedSeries.ok ? combinedSeries.series : [],
      leads: leadsOverview.ok ? leadsOverview.leads : [],
      analytics: analytics.ok ? analytics.overview : EMPTY_ANALYTICS,
    };
  },
  component: AdminDashboard,
});

// How often the "right now" panel re-checks the server while this page is
// open -- this is the "near real-time" behind "people currently on the
// site", not an instant live feed (see analytics.server.ts).
const ANALYTICS_REFRESH_MS = 25_000;

function formatMinutes(value: number): string {
  if (value < 1) return "under a minute";
  if (value === 1) return "1 minute";
  return `${value} minutes`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function planLabel(plan: string | null): string {
  if (plan === "trial") return "Free trial";
  if (plan === "membership") return "Member";
  return "None";
}

// ---- Cold outreach map (inlined here, not a separate component file, to
// keep this feature's deployment to as few directories as possible) --------

// "Not yet contacted" is deliberately its own status, distinct from
// "contacted" -- a lead only earns one of the three outreach statuses below
// once it has actually been emailed (contactedAt set). Leads sourced but not
// yet emailed still show up in the CRM's full leads list, so every place
// that reads a lead's status has to branch on contactedAt first instead of
// defaulting to "contacted" for anything without a follow-up/response.
type LeadStatus = "responded" | "followed_up" | "contacted";

function leadStatus(lead: LeadSummary): LeadStatus {
  if (lead.respondedAt) return "responded";
  if (lead.followUpSentAt) return "followed_up";
  return "contacted";
}

const STATUS_COLOR: Record<LeadStatus, string> = {
  responded: "#2f9e58", // green -- replied
  followed_up: "#d98a1f", // amber -- follow-up sent, still no reply
  contacted: "#5b7fd6", // blue -- just the initial email so far
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  responded: "Responded",
  followed_up: "Follow-up sent",
  contacted: "Contacted",
};

function pinIcon(status: LeadStatus): L.DivIcon {
  const color = STATUS_COLOR[status];
  return L.divIcon({
    className: "outreach-pin-wrap",
    html: `<span class="outreach-pin" style="background:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

// Phoenix, AZ -- sensible default center/zoom for this campaign's leads.
const DEFAULT_CENTER: [number, number] = [33.48, -112.02];
const DEFAULT_ZOOM = 9;

const INDUSTRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All industries" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "both", label: "HVAC + Plumbing" },
  { value: "auto_repair", label: "Auto Repair" },
  { value: "auto_detailing", label: "Auto Detailing" },
  { value: "coffee", label: "Coffee & Cafe" },
  { value: "electrical", label: "Electrical" },
  { value: "landscaping", label: "Landscaping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "pest_control", label: "Pest Control" },
  { value: "roofing", label: "Roofing" },
  { value: "other", label: "Other" },
];

// Shared everywhere a lead's industry is displayed (dropdown, map popup,
// table) so a new industry value only needs to be added in one place above.
// Falls back to the raw value for anything not yet in the list.
function industryLabel(value: string): string {
  return INDUSTRY_OPTIONS.find((opt) => opt.value === value)?.label ?? value;
}

type OutreachMapProps = {
  leads: LeadSummary[];
  onMarkResponded: (leadId: string) => void;
  markingId: string | null;
};

function OutreachMap({ leads, onMarkResponded, markingId }: OutreachMapProps) {
  // Leaflet touches `window`/`document` at import time, which breaks
  // TanStack Start's server render -- only mount the map client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [industryFilter, setIndustryFilter] = useState("all");

  // Only a lead that has actually been emailed (contactedAt set) belongs on
  // this map at all, even if it happens to already have coordinates from
  // being geocoded ahead of a future send -- otherwise a sourced-but-not-yet-
  // emailed business would show up as a blue "Contacted" pin before anyone
  // ever contacted it.
  const pinned = useMemo(
    () =>
      leads.filter(
        (l) => l.contactedAt != null && l.lat != null && l.lng != null,
      ),
    [leads],
  );
  const filtered = useMemo(
    () =>
      industryFilter === "all"
        ? pinned
        : pinned.filter((l) => l.industry === industryFilter),
    [pinned, industryFilter],
  );

  const counts = useMemo(() => {
    const acc = { responded: 0, followed_up: 0, contacted: 0 };
    for (const lead of filtered) acc[leadStatus(lead)] += 1;
    return acc;
  }, [filtered]);

  return (
    <div className="admin-map-wrap">
      <div className="admin-map-controls">
        <div className="admin-legend">
          <span className="admin-legend-item">
            <span
              className="outreach-dot"
              style={{ background: STATUS_COLOR.contacted }}
            />
            Contacted ({counts.contacted})
          </span>
          <span className="admin-legend-item">
            <span
              className="outreach-dot"
              style={{ background: STATUS_COLOR.followed_up }}
            />
            Follow-up sent ({counts.followed_up})
          </span>
          <span className="admin-legend-item">
            <span
              className="outreach-dot"
              style={{ background: STATUS_COLOR.responded }}
            />
            Responded ({counts.responded})
          </span>
        </div>
        <DashSelect
          className="admin-industry-select"
          aria-label="Filter by industry"
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
        >
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </DashSelect>
      </div>

      {!mounted ? (
        <div className="outreach-map-loading">Loading map…</div>
      ) : (
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          className="outreach-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filtered.map((lead) => {
            const status = leadStatus(lead);
            return (
              <Marker
                key={lead.id}
                position={[lead.lat as number, lead.lng as number]}
                icon={pinIcon(status)}
              >
                <Popup>
                  <div className="outreach-popup">
                    <strong>{lead.businessName}</strong>
                    <div className="outreach-popup-line">{lead.email}</div>
                    {lead.address && (
                      <div className="outreach-popup-line">{lead.address}</div>
                    )}
                    <div className="outreach-popup-line">
                      Industry: {industryLabel(lead.industry)}
                    </div>
                    <div className="outreach-popup-line">
                      Contacted: {formatDate(lead.contactedAt)}
                    </div>
                    <div className="outreach-popup-status">
                      <span
                        className="outreach-dot"
                        style={{ background: STATUS_COLOR[status] }}
                      />
                      {STATUS_LABEL[status]}
                    </div>
                    {!lead.respondedAt && (
                      <button
                        type="button"
                        className={dashButtonClass(
                          "ghost",
                          "sm",
                          "outreach-popup-button",
                        )}
                        disabled={markingId === lead.id}
                        onClick={() => onMarkResponded(lead.id)}
                      >
                        {markingId === lead.id
                          ? "Marking…"
                          : "Mark as responded"}
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      )}
    </div>
  );
}

// ---- Small building blocks used by the three tabs ---------------------------

// One of the four number cards at the top of Overview and Outreach. Same look
// as the cards on the client dashboard (label, big number, one muted line and
// a little trend line).
function AdminStat({
  label,
  value,
  unit,
  hint,
  spark,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  hint?: string | undefined;
  spark?: number[] | undefined;
}) {
  return (
    <article className="dash-stat">
      <div className="dash-stat-label">{label}</div>
      <div className="dash-stat-main">
        <span className="dash-stat-value">{value}</span>
        {unit ? <span className="dash-stat-unit">{unit}</span> : null}
      </div>
      <div className="dash-stat-foot">
        <div className="dash-stat-foot-text">
          {hint ? <p className="dash-stat-hint">{hint}</p> : null}
        </div>
        {spark ? <DashSpark values={spark} /> : null}
      </div>
    </article>
  );
}

function visitorPlace(city: string | null, region: string | null): string {
  return [city, region].filter(Boolean).join(", ") || "—";
}

// The "right now" panel: who is on the site this minute and which clients are
// signed in. It refreshes on its own every 25 seconds (see AdminDashboard).
function LivePanel({ analytics }: { analytics: AnalyticsOverview }) {
  const activeCount = analytics.activeNow.length;
  const signedIn = analytics.loggedInBusinesses;

  return (
    <DashPanel
      title="Right now"
      hint={
        <span className="admin-live-hint">
          <i className="dash-live-dot" aria-hidden="true" />
          {activeCount === 1 ? "1 on the site" : `${activeCount} on the site`}
        </span>
      }
      className="admin-live-panel"
    >
      <h3 className="admin-subhead">On the site</h3>
      {activeCount === 0 ? (
        <p className="admin-quiet">No one on the site right now.</p>
      ) : (
        <ul className="admin-list admin-list-scroll">
          {analytics.activeNow.map((visitor) => (
            <li key={visitor.sessionId} className="admin-list-row">
              <span className="admin-list-main">
                {visitor.businessName ? (
                  <DashPill tone="ok">{visitor.businessName}</DashPill>
                ) : (
                  <DashPill tone="muted">Visitor</DashPill>
                )}
                <code className="admin-path">{visitor.path}</code>
              </span>
              <span className="admin-list-meta">
                {visitorPlace(visitor.city, visitor.region)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="admin-subhead">Signed-in businesses</h3>
      {signedIn.length === 0 ? (
        <p className="admin-quiet">No business is signed in right now.</p>
      ) : (
        <ul className="admin-list admin-list-scroll">
          {signedIn.map((biz) => (
            <li key={biz.id} className="admin-list-row">
              <span className="admin-list-main">{biz.businessName}</span>
              <code className="admin-path">{biz.path}</code>
            </li>
          ))}
        </ul>
      )}
    </DashPanel>
  );
}

function TrafficPanel({ analytics }: { analytics: AnalyticsOverview }) {
  const metrics = [
    { label: "Visits today", value: formatCount(analytics.visitsToday) },
    { label: "Visits, 7 days", value: formatCount(analytics.visitsThisWeek) },
    { label: "Clicks, 7 days", value: formatCount(analytics.clicksThisWeek) },
    {
      label: "Avg. time on site",
      value: formatMinutes(analytics.avgSessionMinutes),
    },
  ];
  return (
    <DashPanel
      title="Site traffic"
      hint="updates every 25 seconds"
      className="admin-traffic-panel"
    >
      <div className="admin-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="admin-metric">
            <div className="admin-metric-label">{metric.label}</div>
            <div className="admin-metric-value">{metric.value}</div>
          </div>
        ))}
      </div>
    </DashPanel>
  );
}

function LocationsPanel({ analytics }: { analytics: AnalyticsOverview }) {
  const rows = analytics.topLocations;
  const top = rows.reduce((max, row) => Math.max(max, row.visits), 0);
  return (
    <DashPanel title="Where visits come from" hint="last 7 days">
      {rows.length === 0 ? (
        <DashEmpty compact title="No located visits yet this week." />
      ) : (
        <ul className="admin-list">
          {rows.map((row) => (
            <li key={row.label} className="admin-bar-row">
              <div className="admin-bar-top">
                <span>{row.label}</span>
                <span className="admin-list-meta">
                  {formatCount(row.visits)}
                </span>
              </div>
              <div className="admin-bar" aria-hidden="true">
                <i
                  style={{
                    width: `${top > 0 ? Math.max(3, (row.visits / top) * 100) : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashPanel>
  );
}

function ProgressPanel({
  title,
  hint,
  series,
  loading,
  onBack,
  panelRef,
}: {
  title: string;
  hint: string;
  series: ProgressPoint[] | null;
  loading?: boolean;
  onBack?: () => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={panelRef} className="admin-scroll-anchor">
      <DashPanel
        title={title}
        hint={hint}
        actions={
          onBack ? (
            <DashButton variant="ghost" size="sm" onClick={onBack}>
              Back to all clients
            </DashButton>
          ) : undefined
        }
      >
        {loading || !series ? (
          <p className="admin-quiet">Loading…</p>
        ) : (
          <ProgressChart series={series} />
        )}
      </DashPanel>
    </div>
  );
}

// ---- The three tabs -------------------------------------------------------

type Totals = {
  customers: number;
  messages: number;
  clicks: number;
  reviewed: number;
};

function OverviewTab({
  businesses,
  totals,
  combinedSeries,
  analytics,
}: {
  businesses: AdminBusinessSummary[];
  totals: Totals;
  combinedSeries: ProgressPoint[];
  analytics: AnalyticsOverview;
}) {
  const paused = businesses.filter((b) => b.accessRevoked).length;
  const active = businesses.length - paused;

  // Trend lines: the last 12 weeks of the combined weekly numbers. For
  // clients, how many had signed up by the start of each week.
  const recent = combinedSeries.slice(-12);
  const clientsSpark = recent.map((point) => {
    // weekStart is that week's Monday, so the week ends six days later.
    const weekEnd = Date.parse(`${point.weekStart}T23:59:59Z`) + 6 * 86_400_000;
    return businesses.filter((b) => new Date(b.createdAt).getTime() <= weekEnd)
      .length;
  });

  return (
    <div className="dash-stack">
      <DashPageHead
        title="Overview"
        description="How UpTrend Scaling is doing across every client."
      />

      <section className="dash-stats dash-stats-4" aria-label="Key numbers">
        <AdminStat
          label="Clients"
          value={formatCount(businesses.length)}
          hint={
            paused > 0
              ? `${active} active, ${paused} paused`
              : businesses.length > 0
                ? "All active"
                : "None yet"
          }
          spark={clientsSpark}
        />
        <AdminStat
          label="Total customers"
          value={formatCount(totals.customers)}
          hint="Across all clients"
          spark={recent.map((p) => p.cumulativeCustomers)}
        />
        <AdminStat
          label="Messages sent"
          value={formatCount(totals.messages)}
          hint="All clients, all time"
          spark={recent.map((p) => p.messagesSent)}
        />
        <AdminStat
          label="Reviews marked"
          value={formatCount(totals.reviewed)}
          hint="Marked complete by clients"
          spark={recent.map((p) => p.reviewed)}
        />
      </section>

      <section className="dash-main-grid">
        <ProgressPanel
          title="All clients, combined"
          hint="by week"
          series={combinedSeries}
        />
        <LivePanel analytics={analytics} />
      </section>

      <section className="admin-two-col">
        <TrafficPanel analytics={analytics} />
        <LocationsPanel analytics={analytics} />
      </section>
    </div>
  );
}

function ClientsTab({
  businesses,
  selectedId,
  onSelect,
  selectedSeries,
  loadingSeries,
}: {
  businesses: AdminBusinessSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  selectedSeries: ProgressPoint[] | null;
  loadingSeries: boolean;
}) {
  const selected = businesses.find((b) => b.id === selectedId) ?? null;
  const detailRef = useRef<HTMLDivElement | null>(null);

  // Opening a client from far down the list: bring its chart into view.
  useEffect(() => {
    if (selectedId) {
      detailRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedId]);

  return (
    <div className="dash-stack">
      <DashPageHead
        title="Clients"
        description="Everyone who has signed up. Click a business to see its own progress."
      />

      {selected ? (
        <ProgressPanel
          panelRef={detailRef}
          title={`${selected.businessName}'s progress`}
          hint="by week"
          series={selectedSeries}
          loading={loadingSeries}
          onBack={() => onSelect(null)}
        />
      ) : null}

      <DashPanel
        title="All clients"
        hint={
          businesses.length === 1
            ? "1 business"
            : `${businesses.length} businesses`
        }
      >
        {businesses.length === 0 ? (
          <DashEmpty compact title="No businesses have signed up yet." />
        ) : (
          <DashTable>
            <thead>
              <tr>
                <th>Business</th>
                <th>Plan</th>
                <th>Access</th>
                <th>Signed up</th>
                <th>Customers</th>
                <th>Sent</th>
                <th>Clicks</th>
                <th>Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => {
                const toggle = () =>
                  onSelect(b.id === selectedId ? null : b.id);
                return (
                  <tr
                    key={b.id}
                    className={cx(
                      "admin-row",
                      b.id === selectedId && "is-active",
                    )}
                    tabIndex={0}
                    aria-selected={b.id === selectedId}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                  >
                    <td>
                      <div className="dash-cell-strong">{b.businessName}</div>
                      <div className="dash-cell-muted">{b.email}</div>
                    </td>
                    <td>
                      <DashPill tone="muted">{planLabel(b.plan)}</DashPill>
                    </td>
                    <td>
                      {b.accessRevoked ? (
                        <DashPill tone="warn">Paused</DashPill>
                      ) : (
                        <DashPill tone="ok">Active</DashPill>
                      )}
                    </td>
                    <td className="dash-cell-muted">
                      {formatDate(b.createdAt)}
                    </td>
                    <td>{formatCount(b.totalCustomers)}</td>
                    <td>{formatCount(b.messagesSent)}</td>
                    <td>{formatCount(b.linkClicks)}</td>
                    <td>{formatCount(b.reviewedCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </DashTable>
        )}
      </DashPanel>
    </div>
  );
}

function leadStatusPill(lead: LeadSummary) {
  if (!lead.contactedAt)
    return <DashPill tone="muted">Not yet contacted</DashPill>;
  if (lead.respondedAt) return <DashPill tone="ok">Responded</DashPill>;
  if (lead.followUpSentAt)
    return <DashPill tone="warn">Follow-up sent</DashPill>;
  return <DashPill tone="muted">Contacted</DashPill>;
}

function OutreachTab({
  leads,
  totals,
  onMarkResponded,
  markingId,
}: {
  leads: LeadSummary[];
  totals: { contacted: number; followedUp: number; responded: number };
  onMarkResponded: (leadId: string) => void;
  markingId: string | null;
}) {
  const replyRate =
    totals.contacted > 0
      ? Math.round((totals.responded / totals.contacted) * 100)
      : null;

  return (
    <div className="dash-stack">
      <DashPageHead
        title="Outreach"
        description="The cold emails sent to local businesses, and who has written back."
      />

      <section
        className="dash-stats dash-stats-4"
        aria-label="Outreach numbers"
      >
        <AdminStat
          label="Contacted"
          value={formatCount(totals.contacted)}
          hint="Businesses emailed"
        />
        <AdminStat
          label="Followed up"
          value={formatCount(totals.followedUp)}
          hint="Got a second email"
        />
        <AdminStat
          label="Responded"
          value={formatCount(totals.responded)}
          hint="Wrote back"
        />
        <AdminStat
          label="Reply rate"
          value={replyRate === null ? "—" : String(replyRate)}
          unit={replyRate === null ? undefined : "%"}
          hint="Responded out of contacted"
        />
      </section>

      <DashPanel title="Map" hint="click a pin for details">
        {leads.length === 0 ? (
          <DashEmpty compact title="No leads loaded yet.">
            The outreach campaign has not been imported into the CRM.
          </DashEmpty>
        ) : (
          <OutreachMap
            leads={leads}
            onMarkResponded={onMarkResponded}
            markingId={markingId}
          />
        )}
      </DashPanel>

      {leads.length > 0 ? (
        <DashPanel title="Leads" hint="same list as the map, as a table">
          <DashTable>
            <thead>
              <tr>
                <th>Business</th>
                <th>Industry</th>
                <th>City</th>
                <th>Contacted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div className="dash-cell-strong">{lead.businessName}</div>
                    <div className="dash-cell-muted">{lead.email}</div>
                  </td>
                  <td className="dash-cell-muted">
                    {industryLabel(lead.industry)}
                  </td>
                  <td className="dash-cell-muted">{lead.city ?? "—"}</td>
                  <td className="dash-cell-muted">
                    {formatDate(lead.contactedAt)}
                  </td>
                  <td>{leadStatusPill(lead)}</td>
                </tr>
              ))}
            </tbody>
          </DashTable>
        </DashPanel>
      ) : null}
    </div>
  );
}

// ---- The page ----------------------------------------------------------------

function AdminDashboard() {
  const initial = Route.useLoaderData();
  const { tab: tabParam } = Route.useSearch();
  const tab: AdminTab = tabParam ?? "overview";
  const navigate = useNavigate();

  const [businesses] = useState<AdminBusinessSummary[]>(initial.businesses);
  const [combinedSeries] = useState<ProgressPoint[]>(initial.combinedSeries);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<ProgressPoint[] | null>(
    null,
  );
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [leads, setLeads] = useState<LeadSummary[]>(initial.leads);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview>(
    initial.analytics,
  );

  useEffect(() => {
    const refresh = () => {
      getAdminAnalyticsOverview()
        .then((result) => {
          if (result.ok) setAnalytics(result.overview);
        })
        .catch(() => {
          // A missed refresh just means the panel stays on its last known
          // numbers until the next tick -- nothing to show the admin here.
        });
    };
    const interval = window.setInterval(refresh, ANALYTICS_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedSeries(null);
      return;
    }
    let cancelled = false;
    setLoadingSeries(true);
    getAdminProgressSeries({ data: { businessId: selectedId } })
      .then((result) => {
        if (cancelled) return;
        setSelectedSeries(result.ok ? result.series : []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSeries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function handleLogout() {
    await logoutBusiness();
    void navigate({ to: "/" });
  }

  async function handleMarkResponded(leadId: string) {
    setMarkingId(leadId);
    try {
      const result = await markLeadResponded({ data: { leadId } });
      if (result.ok) {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === leadId ? { ...l, respondedAt: new Date() } : l,
          ),
        );
      }
    } finally {
      setMarkingId(null);
    }
  }

  // Only a lead that has actually been emailed counts toward "contacted" --
  // `leads` here holds every row in the CRM (including ones sourced but not
  // yet sent to), so this has to check contactedAt rather than counting
  // every row. followedUp/responded are unaffected since those fields are
  // only ever set on a lead that was already contacted.
  const leadTotals = leads.reduce(
    (acc, l) => ({
      contacted: acc.contacted + (l.contactedAt ? 1 : 0),
      followedUp: acc.followedUp + (l.followUpSentAt ? 1 : 0),
      responded: acc.responded + (l.respondedAt ? 1 : 0),
    }),
    { contacted: 0, followedUp: 0, responded: 0 },
  );

  const totals = businesses.reduce<Totals>(
    (acc, b) => ({
      customers: acc.customers + b.totalCustomers,
      messages: acc.messages + b.messagesSent,
      clicks: acc.clicks + b.linkClicks,
      reviewed: acc.reviewed + b.reviewedCount,
    }),
    { customers: 0, messages: 0, clicks: 0, reviewed: 0 },
  );

  return (
    <div className="dash-root">
      <header className="dash-topbar">
        <div className="dash-container dash-topbar-inner">
          <a className="dash-brand" href="/" aria-label="UpTrend Scaling home">
            <span className="dash-brand-mark" aria-hidden="true">
              <IconTrend size={17} />
            </span>
            <span className="dash-brand-name">
              UpTrend <em>Scaling</em>
            </span>
          </a>
          <span className="dash-topbar-divider" aria-hidden="true" />
          <span className="dash-switcher is-static">Admin</span>
          <nav className="dash-nav" aria-label="Admin sections">
            {ADMIN_NAV.map((item) => (
              <Link
                key={item.id}
                to="/admin"
                search={item.id === "overview" ? {} : { tab: item.id }}
                className={cx("dash-nav-tab", tab === item.id && "is-active")}
                aria-current={tab === item.id ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="dash-topbar-right">
            <ThemeToggle className="is-dash" />
            <DashButton href="/app" variant="quiet" size="sm">
              Your dashboard
            </DashButton>
            <DashButton
              variant="ghost"
              size="sm"
              onClick={() => void handleLogout()}
            >
              Log out
            </DashButton>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-container">
          {tab === "clients" ? (
            <ClientsTab
              businesses={businesses}
              selectedId={selectedId}
              onSelect={setSelectedId}
              selectedSeries={selectedSeries}
              loadingSeries={loadingSeries}
            />
          ) : tab === "outreach" ? (
            <OutreachTab
              leads={leads}
              totals={leadTotals}
              onMarkResponded={(id) => void handleMarkResponded(id)}
              markingId={markingId}
            />
          ) : (
            <OverviewTab
              businesses={businesses}
              totals={totals}
              combinedSeries={combinedSeries}
              analytics={analytics}
            />
          )}
        </div>
      </main>
    </div>
  );
}
