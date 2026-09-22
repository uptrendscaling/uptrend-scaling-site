import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { ProgressChart } from "../components/progress-chart";
import {
  disconnectConnection,
  listConnectionsForBusiness,
  type ConnectionSummary,
  type CrmProvider,
} from "../lib/crm/connections.server";
import {
  addCustomer,
  getCurrentBusiness,
  getCustomerProgressSeries,
  getDashboardStats,
  listCustomers,
  logoutBusiness,
  markCustomerReviewed,
  resendReviewRequest,
  updateGoogleReviewUrl,
  type CustomerRow,
  type DashboardStats,
  type ProgressPoint,
  type PublicBusiness,
} from "../lib/reviews.server";

const searchSchema = z.object({
  // Set by /connect/{provider}/callback when the OAuth handshake fails.
  crmError: z.enum(["jobber", "square"]).optional(),
});

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [{ title: "Dashboard | UpTrend Scaling" }],
  }),
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  loader: async () => {
    const business = await getCurrentBusiness();
    if (!business) {
      throw redirect({ to: "/login" });
    }
    // Canceled/unpaid subscription (set by the Stripe webhook) -- show the
    // paused-access panel instead of pulling their customer data.
    if (business.accessRevoked) {
      return {
        business,
        stats: null,
        customers: [],
        series: [],
        connections: [],
      };
    }
    const [stats, customerRows, series, connections] = await Promise.all([
      getDashboardStats(),
      listCustomers(),
      getCustomerProgressSeries(),
      listConnectionsForBusiness(),
    ]);
    return { business, stats, customers: customerRows, series, connections };
  },
  component: Dashboard,
});

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Dashboard() {
  const initial = Route.useLoaderData();
  const { crmError } = Route.useSearch();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<PublicBusiness>(initial.business);
  const [stats, setStats] = useState<DashboardStats | null>(initial.stats);
  const [customers, setCustomers] = useState<CustomerRow[]>(initial.customers);
  const [series, setSeries] = useState<ProgressPoint[]>(initial.series);
  const [connections, setConnections] = useState<ConnectionSummary[]>(
    initial.connections,
  );

  async function refresh() {
    const [nextStats, nextCustomers, nextSeries] = await Promise.all([
      getDashboardStats(),
      listCustomers(),
      getCustomerProgressSeries(),
    ]);
    setStats(nextStats);
    setCustomers(nextCustomers);
    setSeries(nextSeries);
  }

  async function refreshConnections() {
    setConnections(await listConnectionsForBusiness());
  }

  async function handleLogout() {
    await logoutBusiness();
    void navigate({ to: "/" });
  }

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
            <span className="app-business-name">{business.businessName}</span>
            {business.isAdmin && (
              <a className="button button-ghost nav-cta" href="/admin">
                Admin
              </a>
            )}
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
        {business.accessRevoked ? (
          <div className="page-width app-grid">
            <AccessPausedPanel />
          </div>
        ) : (
          <div className="page-width app-grid">
            <StatsPanel stats={stats} />
            <section className="app-panel app-panel-wide">
              <h2>Your progress</h2>
              <p className="app-panel-hint">
                Customers added, messages sent, link clicks, and reviews marked
                complete, by week.
              </p>
              <ProgressChart series={series} />
            </section>
            <SettingsPanel business={business} onUpdated={setBusiness} />
            <ConnectionsPanel
              connections={connections}
              crmError={crmError}
              onChanged={refreshConnections}
            />
            <AddCustomerPanel onAdded={refresh} />
            <CustomerTable customers={customers} onToggleReviewed={refresh} />
          </div>
        )}
      </main>
    </div>
  );
}

function AccessPausedPanel() {
  return (
    <section className="app-panel app-panel-wide">
      <h2>Your subscription has ended</h2>
      <p className="app-panel-hint">
        Your dashboard is paused because your UpTrend Scaling subscription was
        canceled. Your customer data is safe, and everything comes right back
        once your subscription is active again. Email{" "}
        <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>{" "}
        if you would like to reactivate or have questions about your billing.
      </p>
    </section>
  );
}

function StatsPanel({ stats }: { stats: DashboardStats | null }) {
  if (!stats) return null;
  const clickRate =
    stats.totalCustomers > 0
      ? Math.round((stats.linkClicks / stats.totalCustomers) * 100)
      : 0;

  return (
    <section className="stat-grid">
      <div className="stat-card">
        <span>Customers</span>
        <strong>{stats.totalCustomers}</strong>
      </div>
      <div className="stat-card">
        <span>Messages sent</span>
        <strong>{stats.messagesSent}</strong>
      </div>
      <div className="stat-card">
        <span>Review link clicks</span>
        <strong>
          {stats.linkClicks} <small>({clickRate}%)</small>
        </strong>
      </div>
      <div className="stat-card">
        <span>Marked reviewed</span>
        <strong>{stats.reviewedCount}</strong>
      </div>
    </section>
  );
}

function SettingsPanel({
  business,
  onUpdated,
}: {
  business: PublicBusiness;
  onUpdated: (business: PublicBusiness) => void;
}) {
  const [url, setUrl] = useState(business.googleReviewUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateGoogleReviewUrl({
        data: { googleReviewUrl: url },
      });
      if (result.ok) {
        onUpdated({ ...business, googleReviewUrl: url });
        setMessage("Saved.");
      } else {
        setMessage(result.message ?? "Could not save.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Could not save. Check the URL and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="app-panel">
      <h2>Your Google review link</h2>
      <p className="app-panel-hint">
        Every review request points customers here after they click their
        personal link.
      </p>
      <form className="app-inline-form" onSubmit={handleSave}>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://g.page/r/your-business/review"
          required
        />
        <button
          className="button button-primary"
          type="submit"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      {message && <p className="app-panel-message">{message}</p>}
    </section>
  );
}

const CRM_PROVIDERS: readonly CrmProvider[] = ["jobber", "square"];
const PROVIDER_LABELS: Record<CrmProvider, string> = {
  jobber: "Jobber",
  square: "Square",
};

function ConnectionsPanel({
  connections,
  crmError,
  onChanged,
}: {
  connections: ConnectionSummary[];
  crmError: CrmProvider | undefined;
  onChanged: () => void;
}) {
  const [disconnectingProvider, setDisconnectingProvider] =
    useState<CrmProvider | null>(null);
  const byProvider = new Map(
    connections.map((connection) => [connection.provider, connection]),
  );

  async function handleDisconnect(provider: CrmProvider) {
    setDisconnectingProvider(provider);
    try {
      await disconnectConnection({ data: { provider } });
      onChanged();
    } catch (err) {
      console.error(err);
    } finally {
      setDisconnectingProvider(null);
    }
  }

  return (
    <section className="app-panel app-panel-wide">
      <h2>Connect your invoicing/CRM</h2>
      <p className="app-panel-hint">
        Connect Jobber or Square and we&rsquo;ll automatically send a review
        request the moment an invoice is paid — no manual entry needed.
      </p>
      {crmError && (
        <p className="app-panel-message app-panel-message-error">
          Couldn&rsquo;t connect {PROVIDER_LABELS[crmError]}. Please try again.
        </p>
      )}
      <div className="crm-connection-list">
        {CRM_PROVIDERS.map((provider) => {
          const connection = byProvider.get(provider);
          return (
            <div className="crm-connection-row" key={provider}>
              <div>
                <div className="crm-connection-name">
                  {PROVIDER_LABELS[provider]}
                </div>
                {connection ? (
                  connection.lastErrorMessage ? (
                    <span className="status-pill status-pill-warning">
                      Needs reconnect
                    </span>
                  ) : (
                    <span className="status-pill status-pill-success">
                      Connected
                    </span>
                  )
                ) : (
                  <span className="status-pill">Not connected</span>
                )}
              </div>
              {connection ? (
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => handleDisconnect(provider)}
                  disabled={disconnectingProvider === provider}
                >
                  {disconnectingProvider === provider
                    ? "Disconnecting…"
                    : "Disconnect"}
                </button>
              ) : (
                <a
                  className="button button-primary"
                  href={`/connect/${provider}/start`}
                >
                  Connect
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AddCustomerPanel({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    if (!name.trim() || (!phone.trim() && !email.trim())) {
      setMessage("Add a name plus a phone number or email.");
      setIsError(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await addCustomer({
        data: { name, phone: phone || undefined, email: email || undefined },
      });
      if (result.ok) {
        const parts: string[] = [];
        if (result.smsSent === true) parts.push("text sent");
        if (result.smsSent === false) parts.push("text failed");
        if (result.emailSent === true) parts.push("email sent");
        if (result.emailSent === false) parts.push("email failed");
        setMessage(
          parts.length > 0 ? `Added — ${parts.join(", ")}.` : "Added.",
        );
        setName("");
        setPhone("");
        setEmail("");
        onAdded();
      } else {
        setMessage(result.message);
        setIsError(true);
      }
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong. Please try again.");
      setIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="app-panel">
      <h2>Add a customer</h2>
      <p className="app-panel-hint">
        Their review request goes out the moment you save this — no extra step.
      </p>
      <form className="app-add-form" onSubmit={handleSubmit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Customer name"
          required
        />
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Phone (optional)"
        />
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email (optional)"
        />
        <button
          className="button button-primary"
          type="submit"
          disabled={submitting}
        >
          {submitting ? "Sending…" : "Add + send"}
        </button>
      </form>
      {message && (
        <p
          className={
            isError
              ? "app-panel-message app-panel-message-error"
              : "app-panel-message"
          }
        >
          {message}
        </p>
      )}
    </section>
  );
}

function CustomerTable({
  customers,
  onToggleReviewed,
}: {
  customers: CustomerRow[];
  onToggleReviewed: () => void;
}) {
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);

  async function toggle(customerId: string) {
    await markCustomerReviewed({ data: { customerId } });
    onToggleReviewed();
  }

  async function resend(customerId: string) {
    setResendingId(customerId);
    setResendMessage(null);
    try {
      const result = await resendReviewRequest({ data: { customerId } });
      if (result.ok) {
        const parts: string[] = [];
        if (result.smsSent === true) parts.push("text sent");
        if (result.smsSent === false) parts.push("text failed");
        if (result.emailSent === true) parts.push("email sent");
        if (result.emailSent === false) parts.push("email failed");
        setResendMessage({
          id: customerId,
          text: parts.length > 0 ? parts.join(", ") : "Sent.",
        });
        onToggleReviewed();
      } else {
        setResendMessage({ id: customerId, text: result.message });
      }
    } catch (err) {
      console.error(err);
      setResendMessage({ id: customerId, text: "Something went wrong." });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <section className="app-panel app-panel-wide">
      <h2>Customers</h2>
      {customers.length === 0 ? (
        <p className="app-panel-hint">
          No customers yet — add your first one above.
        </p>
      ) : (
        <div className="customer-table-wrap">
          <table className="customer-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Added</th>
                <th>Sent</th>
                <th>Clicked</th>
                <th>Reviewed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div className="customer-name">{customer.name}</div>
                    <div className="customer-contact">
                      {customer.phone || customer.email}
                    </div>
                  </td>
                  <td>{formatDate(customer.createdAt)}</td>
                  <td>
                    {customer.smsCount > 0 && (
                      <span className="status-pill">
                        SMS ×{customer.smsCount}
                      </span>
                    )}
                    {customer.emailCount > 0 && (
                      <span className="status-pill">
                        Email ×{customer.emailCount}
                      </span>
                    )}
                    {customer.smsCount === 0 && customer.emailCount === 0 && (
                      <span>—</span>
                    )}
                  </td>
                  <td>
                    {customer.linkClickedAt ? (
                      <span className="status-pill status-pill-success">
                        Clicked {formatDate(customer.linkClickedAt)}
                      </span>
                    ) : (
                      <span className="status-pill">Not yet</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={
                        customer.markedReviewedAt
                          ? "toggle-pill toggle-pill-active"
                          : "toggle-pill"
                      }
                      onClick={() => toggle(customer.id)}
                    >
                      {customer.markedReviewedAt
                        ? "Reviewed ✓"
                        : "Mark reviewed"}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="toggle-pill"
                      onClick={() => resend(customer.id)}
                      disabled={resendingId === customer.id}
                    >
                      {resendingId === customer.id ? "Sending…" : "Resend"}
                    </button>
                    {resendMessage && resendMessage.id === customer.id && (
                      <div className="resend-message">{resendMessage.text}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
