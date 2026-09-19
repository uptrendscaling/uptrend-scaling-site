import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ProgressChart } from "../components/progress-chart";
import {
  getAdminOverview,
  getAdminProgressSeries,
  getCurrentBusiness,
  logoutBusiness,
  type AdminBusinessSummary,
  type ProgressPoint,
} from "../lib/reviews.server";

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
    return {
      business,
      businesses: overview.businesses,
      combinedSeries: combinedSeries.ok ? combinedSeries.series : [],
    };
  },
  component: AdminDashboard,
});

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function AdminDashboard() {
  const initial = Route.useLoaderData();
  const navigate = useNavigate();

  const [businesses] = useState<AdminBusinessSummary[]>(initial.businesses);
  const [combinedSeries] = useState<ProgressPoint[]>(initial.combinedSeries);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<ProgressPoint[] | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(false);

  const selected = businesses.find((b) => b.id === selectedId) ?? null;

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
            <button className="button button-ghost nav-cta" type="button" onClick={handleLogout}>
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

          <section className="app-panel app-panel-wide">
            <div className="admin-chart-head">
              <div>
                <h2>
                  {selected ? `${selected.businessName}'s progress` : "All clients, combined"}
                </h2>
                <p className="app-panel-hint">
                  {selected
                    ? "Customers added, messages sent, link clicks, and reviews marked complete, by week."
                    : "Every signed-up business added together, by week."}
                </p>
              </div>
              {selected && (
                <button type="button" className="toggle-pill" onClick={() => setSelectedId(null)}>
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
            <p className="app-panel-hint">Click a business to see its own progress above.</p>
            {businesses.length === 0 ? (
              <p className="app-panel-hint">No businesses have signed up yet.</p>
            ) : (
              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>Plan</th>
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
                        className={b.id === selectedId ? "admin-row admin-row-active" : "admin-row"}
                        onClick={() => setSelectedId(b.id === selectedId ? null : b.id)}
                      >
                        <td>
                          <div className="customer-name">{b.businessName}</div>
                          <div className="customer-contact">{b.email}</div>
                        </td>
                        <td>{b.plan ?? "—"}</td>
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
        </div>
      </main>
    </div>
  );
}
