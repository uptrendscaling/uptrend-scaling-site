import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import {
  getAdminAnalyticsOverview,
  type AnalyticsOverview,
} from "../lib/analytics.server";
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
    <div className="outreach-map-wrap">
      <div className="outreach-map-controls">
        <select
          className="outreach-industry-select"
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
        >
          {INDUSTRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="outreach-legend">
          <span className="outreach-legend-item">
            <span
              className="outreach-dot"
              style={{ background: STATUS_COLOR.contacted }}
            />
            Contacted ({counts.contacted})
          </span>
          <span className="outreach-legend-item">
            <span
              className="outreach-dot"
              style={{ background: STATUS_COLOR.followed_up }}
            />
            Follow-up sent ({counts.followed_up})
          </span>
          <span className="outreach-legend-item">
            <span
              className="outreach-dot"
              style={{ background: STATUS_COLOR.responded }}
            />
            Responded ({counts.responded})
          </span>
        </div>
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
                        className="button button-ghost outreach-popup-button"
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

// ---- Site analytics panel (inlined here, not a separate component file,
// same reasoning as the outreach map above) ---------------------------------

function AnalyticsPanel({ analytics }: { analytics: AnalyticsOverview }) {
  const activeCount = analytics.activeNow.length;

  return (
    <section className="app-panel app-panel-wide">
      <div className="admin-chart-head">
        <div>
          <h2>Site analytics</h2>
          <p className="app-panel-hint">
            Visits, clicks, and who&rsquo;s on the site right now. Updates
            automatically every 25 seconds while this page is open.
          </p>
        </div>
      </div>

      <section className="stat-grid">
        <div className="stat-card">
          <span>Visits today</span>
          <strong>{analytics.visitsToday}</strong>
        </div>
        <div className="stat-card">
          <span>Visits (7 days)</span>
          <strong>{analytics.visitsThisWeek}</strong>
        </div>
        <div className="stat-card">
          <span>Clicks (7 days)</span>
          <strong>{analytics.clicksThisWeek}</strong>
        </div>
        <div className="stat-card">
          <span>Avg. time on site</span>
          <strong>{formatMinutes(analytics.avgSessionMinutes)}</strong>
        </div>
      </section>

      <div className="analytics-live-grid">
        <div>
          <h3 className="analytics-subhead">
            <span className="live-dot" aria-hidden="true" />
            Active right now ({activeCount})
          </h3>
          {activeCount === 0 ? (
            <p className="app-panel-hint">No one on the site right now.</p>
          ) : (
            <ul className="analytics-list">
              {analytics.activeNow.map((visitor) => (
                <li key={visitor.sessionId} className="analytics-list-row">
                  <span>
                    {visitor.businessName ? (
                      <span className="status-pill status-pill-success">
                        {visitor.businessName}
                      </span>
                    ) : (
                      <span className="status-pill">Visitor</span>
                    )}{" "}
                    on <code>{visitor.path}</code>
                  </span>
                  <span className="outreach-lead-table-cell-muted">
                    {[visitor.city, visitor.region]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="analytics-subhead">
            Businesses logged in right now (
            {analytics.loggedInBusinesses.length})
          </h3>
          {analytics.loggedInBusinesses.length === 0 ? (
            <p className="app-panel-hint">
              No business is logged in right now.
            </p>
          ) : (
            <ul className="analytics-list">
              {analytics.loggedInBusinesses.map((biz) => (
                <li key={biz.id} className="analytics-list-row">
                  <span>{biz.businessName}</span>
                  <span className="outreach-lead-table-cell-muted">
                    <code>{biz.path}</code>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="analytics-subhead">Where visits come from (7 days)</h3>
          {analytics.topLocations.length === 0 ? (
            <p className="app-panel-hint">No located visits yet this week.</p>
          ) : (
            <ul className="analytics-list">
              {analytics.topLocations.map((row) => (
                <li key={row.label} className="analytics-list-row">
                  <span>{row.label}</span>
                  <span className="outreach-lead-table-cell-muted">
                    {row.visits}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminDashboard() {
  const initial = Route.useLoaderData();
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

  const selected = businesses.find((b) => b.id === selectedId) ?? null;

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

  const totals = businesses.reduce(
    (acc, b) => ({
      customers: acc.customers + b.totalCustomers,
      messages: acc.messages + b.messagesSent,
      clicks: acc.clicks + b.linkClicks,
      reviewed: acc.reviewed + b.reviewedCount,
    }),
    { customers: 0, messages: 0, clicks: 0, reviewed: 0 },
  );

  return (
    <div className="site-shell app-shell">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="/" aria-label="UpTrend Scaling home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28">
                <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
              </svg>
            </span>
            <span>
              UpTrend <em>Scaling</em>
            </span>
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span className="app-business-name">Admin</span>
            <a className="button button-ghost nav-cta" href="/app">
              Your dashboard
            </a>
            <button
              className="button button-ghost nav-cta"
              type="button"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="page-width app-grid">
          <section className="stat-grid">
            <div className="stat-card">
              <span>Clients</span>
              <strong>{businesses.length}</strong>
            </div>
            <div className="stat-card">
              <span>Total customers</span>
              <strong>{totals.customers}</strong>
            </div>
            <div className="stat-card">
              <span>Messages sent</span>
              <strong>{totals.messages}</strong>
            </div>
            <div className="stat-card">
              <span>Reviews marked</span>
              <strong>{totals.reviewed}</strong>
            </div>
          </section>

          <AnalyticsPanel analytics={analytics} />

          <section className="app-panel app-panel-wide">
            <div className="admin-chart-head">
              <div>
                <h2>
                  {selected
                    ? `${selected.businessName}'s progress`
                    : "All clients, combined"}
                </h2>
                <p className="app-panel-hint">
                  {selected
                    ? "Customers added, messages sent, link clicks, and reviews marked complete, by week."
                    : "Every signed-up business added together, by week."}
                </p>
              </div>
              {selected && (
                <button
                  type="button"
                  className="toggle-pill"
                  onClick={() => setSelectedId(null)}
                >
                  ← Back to combined
                </button>
              )}
            </div>
            {selected ? (
              loadingSeries || !selectedSeries ? (
                <p className="app-panel-hint">Loading…</p>
              ) : (
                <ProgressChart series={selectedSeries} />
              )
            ) : (
              <ProgressChart series={combinedSeries} />
            )}
          </section>

          <section className="app-panel app-panel-wide">
            <h2>Clients</h2>
            <p className="app-panel-hint">
              Click a business to see its own progress above.
            </p>
            {businesses.length === 0 ? (
              <p className="app-panel-hint">
                No businesses have signed up yet.
              </p>
            ) : (
              <div className="customer-table-wrap">
                <table className="customer-table">
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
                    {businesses.map((b) => (
                      <tr
                        key={b.id}
                        className={
                          b.id === selectedId
                            ? "admin-row admin-row-active"
                            : "admin-row"
                        }
                        onClick={() =>
                          setSelectedId(b.id === selectedId ? null : b.id)
                        }
                      >
                        <td>
                          <div className="customer-name">{b.businessName}</div>
                          <div className="customer-contact">{b.email}</div>
                        </td>
                        <td>{b.plan ?? "—"}</td>
                        <td>
                          {b.accessRevoked ? (
                            <span className="status-pill">Revoked</span>
                          ) : (
                            <span className="status-pill status-pill-success">
                              Active
                            </span>
                          )}
                        </td>
                        <td>{formatDate(b.createdAt)}</td>
                        <td>{b.totalCustomers}</td>
                        <td>{b.messagesSent}</td>
                        <td>{b.linkClicks}</td>
                        <td>{b.reviewedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="app-panel app-panel-wide">
            <div className="admin-chart-head">
              <div>
                <h2>Cold outreach map</h2>
                <p className="app-panel-hint">
                  Every business emailed so far, {leadTotals.contacted}{" "}
                  contacted, {leadTotals.followedUp} followed up,{" "}
                  {leadTotals.responded} responded. Click a pin for details.
                </p>
              </div>
            </div>
            {leads.length === 0 ? (
              <p className="app-panel-hint">
                No leads loaded yet, the outreach campaign hasn&apos;t been
                imported into the CRM.
              </p>
            ) : (
              <OutreachMap
                leads={leads}
                onMarkResponded={handleMarkResponded}
                markingId={markingId}
              />
            )}
          </section>

          {leads.length > 0 && (
            <section className="app-panel app-panel-wide">
              <h2>Leads</h2>
              <p className="app-panel-hint">
                Same list as the map, in table form.
              </p>
              <div className="customer-table-wrap">
                <table className="customer-table">
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
                      <tr key={lead.id} className="admin-row">
                        <td>
                          <div className="customer-name">
                            {lead.businessName}
                          </div>
                          <div className="customer-contact">{lead.email}</div>
                        </td>
                        <td className="outreach-lead-table-cell-muted">
                          {industryLabel(lead.industry)}
                        </td>
                        <td className="outreach-lead-table-cell-muted">
                          {lead.city ?? "—"}
                        </td>
                        <td className="outreach-lead-table-cell-muted">
                          {formatDate(lead.contactedAt)}
                        </td>
                        <td>
                          {!lead.contactedAt ? (
                            <span className="status-pill">
                              Not yet contacted
                            </span>
                          ) : lead.respondedAt ? (
                            <span className="status-pill status-pill-success">
                              Responded
                            </span>
                          ) : lead.followUpSentAt ? (
                            <span className="status-pill">Follow-up sent</span>
                          ) : (
                            <span className="status-pill">Contacted</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
