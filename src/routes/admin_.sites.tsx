import { createFileRoute, redirect } from "@tanstack/react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { getCurrentBusiness } from "../lib/reviews.server";
import { adminListSites } from "../lib/site-gen/sites.server";
import siteDetailsCss from "../site-details.css?url";

// Every customer website in one list: what stage it is at, who needs
// attention, and a link into each editor.
export const Route = createFileRoute("/admin_/sites")({
  head: () => ({
    meta: [
      { title: "Websites | UpTrend Scaling" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: siteDetailsCss }],
  }),
  loader: async () => {
    const business = await getCurrentBusiness();
    if (!business) throw redirect({ to: "/login" });
    return adminListSites();
  },
  component: SitesList,
});

const STATUS_LABEL: Record<string, string> = {
  awaiting_details: "Waiting on customer form",
  generating: "Being written",
  review: "Needs your review",
  customer_review: "With customer for approval",
  live: "Live",
  paused: "Paused",
};

// Lower number = needs you sooner.
const STATUS_ORDER: Record<string, number> = {
  review: 0,
  paused: 1,
  customer_review: 2,
  generating: 3,
  awaiting_details: 4,
  live: 5,
};

function daysLeft(iso: string | null): string {
  if (!iso) return "";
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (d <= 0) return "free address expired";
  return `${d} day${d === 1 ? "" : "s"} of free address left`;
}

function SitesList() {
  const data = Route.useLoaderData();
  return (
    <div className="site-shell start-shell">
      <header className="site-nav">
        <div className="nav-inner">
          <a className="brand" href="/admin" aria-label="Back to admin">
            <span>
              UpTrend <em>Admin</em>
            </span>
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main className="sd" style={{ maxWidth: 1000 }}>
        <p>
          <a href="/admin">&larr; Admin</a>
        </p>
        <h1>Customer websites</h1>
        {!data.ok ? (
          <div className="sd-note bad">{data.message}</div>
        ) : data.sites.length === 0 ? (
          <div className="sd-card">
            <h2>No websites yet</h2>
            <p>When a customer pays for a website build, it shows up here.</p>
          </div>
        ) : (
          [...data.sites]
            .sort(
              (a, b) =>
                (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
                b.updatedAt.localeCompare(a.updatedAt),
            )
            .map((s) => (
              <section key={s.businessId} className="sd-card">
                <h2>{s.businessName}</h2>
                <p>
                  <b>{STATUS_LABEL[s.status] ?? s.status}</b>
                  {s.changeRequests > 0
                    ? ` · ${s.changeRequests} change request${s.changeRequests === 1 ? "" : "s"}`
                    : ""}
                  {s.leads > 0
                    ? ` · ${s.leads} quote request${s.leads === 1 ? "" : "s"} received`
                    : ""}
                  {s.status === "live" || s.status === "paused"
                    ? ` · ${s.customDomain ? s.customDomain : daysLeft(s.domainDeadlineAt)}`
                    : ""}
                  {s.requestedDomain && !s.customDomain
                    ? ` · wants ${s.requestedDomain}`
                    : ""}
                </p>
                {s.lastError ? (
                  <div className="sd-note">Builder note: {s.lastError}</div>
                ) : null}
                <div className="sd-row">
                  <a
                    className="sd-btn pri"
                    href={`/admin/site/${s.businessId}`}
                  >
                    Open editor
                  </a>
                  {s.hasBrief ? (
                    <a
                      className="sd-btn"
                      href={s.previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                    </a>
                  ) : null}
                  {s.status === "live" ? (
                    <a
                      className="sd-btn"
                      href={s.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Live site
                    </a>
                  ) : null}
                </div>
              </section>
            ))
        )}
      </main>
    </div>
  );
}
