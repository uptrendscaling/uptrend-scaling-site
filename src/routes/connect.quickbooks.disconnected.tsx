import { createFileRoute } from "@tanstack/react-router";
import { ThemeToggle } from "../components/theme-toggle";

// The Disconnect URL registered in the Intuit developer portal: where Intuit
// sends an owner who disconnected our app from inside QuickBooks. Nothing is
// changed here (a page load must never alter an account); the connection's
// tokens are already dead on Intuit's side, so the next paid invoice marks it
// "needs reconnect" in the dashboard by itself.
export const Route = createFileRoute("/connect/quickbooks/disconnected")({
  head: () => ({
    meta: [
      { title: "QuickBooks disconnected | UpTrend Scaling" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QuickBooksDisconnectedPage,
});

function QuickBooksDisconnectedPage() {
  return (
    <div className="site-shell start-shell">
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
          <ThemeToggle />
        </div>
      </header>

      <main className="start-main success-main">
        <div
          className="page-width"
          style={{ maxWidth: 480, marginInline: "auto" }}
        >
          <p className="eyebrow" style={{ justifyContent: "center" }}>
            <span /> QuickBooks
          </p>
          <h1 className="start-heading">QuickBooks is disconnected.</h1>
          <p className="start-lead" style={{ marginBottom: 20 }}>
            UpTrend Scaling no longer has access to your QuickBooks company, so
            paid invoices will not send review requests on their own anymore.
            Your customer list, past requests and reviews in UpTrend are not
            affected.
          </p>
          <p className="start-lead" style={{ marginBottom: 28 }}>
            Changed your mind? You can connect again any time from Settings in
            your dashboard.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <a className="button button-primary" href="/connect/quickbooks/start">
              Reconnect QuickBooks
            </a>
            <a className="button button-ghost" href="/app?tab=settings">
              Go to my dashboard
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
