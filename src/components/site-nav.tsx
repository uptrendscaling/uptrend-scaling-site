import { ThemeToggle } from "./theme-toggle";

// The same top menu as the homepage, for the inner pages (Websites, the sample
// viewer, the website landing pages). On the homepage the section links are
// in-page anchors; from any other page they point back to those sections.
const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/websites", label: "Websites" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteNav() {
  return (
    <div className="lp-root lp-nav-wrap">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <a className="lp-brand" href="/" aria-label="UpTrend Scaling home">
            <span className="lp-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 28 28">
                <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
              </svg>
            </span>
            <span>
              UpTrend <em>Scaling</em>
            </span>
          </a>
          <nav className="lp-nav-links" aria-label="Main navigation">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="lp-nav-actions">
            <ThemeToggle />
            <a className="lp-btn lp-btn-quiet lp-nav-login" href="/login">
              Log in
            </a>
            <a
              className="lp-btn lp-btn-primary lp-btn-sm"
              href="/start?plan=trial"
            >
              Start free trial
            </a>
          </div>
        </div>
      </header>
    </div>
  );
}
