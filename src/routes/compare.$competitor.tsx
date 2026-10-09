import { createFileRoute, notFound } from "@tanstack/react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { CANONICAL_SITE_URL } from "../lib/site";

// Comparison pages: /compare/nicejob, /compare/podium, /compare/birdeye.
// Written to make the case for UpTrend, but every competitor fact here comes
// from their own website or a public pricing report (linked at the bottom),
// because a wrong claim about another company is both a legal risk and the
// fastest way to lose a reader's trust. Check and refresh the facts every few
// months: prices change. Last checked October 2026.

type Cell = { text: string; good?: boolean };

type Competitor = {
  slug: string;
  name: string;
  headline: string;
  summary: string;
  rows: Array<{ label: string; us: Cell; them: Cell }>;
  reasons: Array<{ title: string; detail: string }>;
  fairNote: string;
  faq: Array<{ q: string; a: string }>;
  sources: Array<{ label: string; url: string }>;
};

const SHARED_ROWS = {
  requests: {
    label: "Review requests by text and email",
    us: { text: "Yes, both, from one tap", good: true },
  },
  qr: {
    label: "QR codes for in-person reviews",
    us: { text: "Included", good: true },
  },
  gating: {
    label: "Same honest link for every customer",
    us: { text: "Yes, no review gating", good: true },
  },
};

const COMPETITORS: Record<string, Competitor> = {
  nicejob: {
    slug: "nicejob",
    name: "NiceJob",
    headline: "UpTrend Scaling vs NiceJob",
    summary:
      "Both send automatic Google review requests. UpTrend is the focused option: it does one job, getting you more Google reviews, starting at $70 a month, with clear request limits and one friendly reminder instead of a long follow-up sequence.",
    rows: [
      {
        label: "Starting price",
        us: { text: "$70 / month", good: true },
        them: { text: "$75 / month (Starter)" },
      },
      {
        label: "Price of the next plan up",
        us: { text: "$100 / month (2,500 requests)", good: true },
        them: { text: "$125 / month (Pro)" },
      },
      {
        label: "What you're paying for",
        us: { text: "Google review requests, done really well", good: true },
        them: {
          text: "Reviews plus widgets, social posting, referral and marketing tools",
        },
      },
      {
        label: "Follow-ups to your customers",
        us: { text: "One friendly reminder, then we stop", good: true },
        them: { text: "Follow-up texts and emails over about 14 days" },
      },
      { ...SHARED_ROWS.requests, them: { text: "Yes" } },
      {
        label: "Jobber and Square",
        us: {
          text: "Yes, review request goes out when the invoice is paid",
          good: true,
        },
        them: { text: "Yes, plus many more integrations" },
      },
      { ...SHARED_ROWS.qr, them: { text: "Yes" } },
      {
        label: "Contract",
        us: { text: "Month to month, cancel anytime", good: true },
        them: { text: "Month to month" },
      },
    ],
    reasons: [
      {
        title: "Pay for reviews, not a marketing suite",
        detail:
          "NiceJob bundles extra marketing tools like widgets and social posting, and its $125 plan adds more. If what you want is more Google reviews, UpTrend does exactly that and costs less.",
      },
      {
        title: "Your customers don't get pestered",
        detail:
          "One request and one reminder. Happy customers leave a review, and nobody gets a week of follow-ups from your business.",
      },
      {
        title: "Know exactly what you get",
        detail:
          "Every plan says how many review requests it includes (1,000, 2,500 or 6,000 a month per location), so there are no surprises as you grow.",
      },
      {
        title: "Set up in minutes",
        detail:
          "Connect Jobber or Square, add your Google review link, and every paid invoice turns into a review request automatically.",
      },
    ],
    fairNote:
      "Need website review widgets, social posting or referral campaigns in the same tool? NiceJob includes those. If you just want more Google reviews for less, UpTrend is the simpler pick.",
    faq: [
      {
        q: "Is UpTrend cheaper than NiceJob?",
        a: "UpTrend starts at $70 a month per location. NiceJob's published plans are $75 (Starter) and $125 (Pro) a month.",
      },
      {
        q: "Can I switch from NiceJob to UpTrend?",
        a: "Yes. Start a 7-day free trial, connect Jobber or Square, and add your Google review link. Requests start going out with your next paid invoice.",
      },
    ],
    sources: [
      { label: "NiceJob pricing", url: "https://get.nicejob.com/pricing" },
      {
        label: "NiceJob review campaigns",
        url: "https://help.nicejob.com/en/articles/3133773-what-is-a-nicejob-campaign",
      },
    ],
  },
  podium: {
    slug: "podium",
    name: "Podium",
    headline: "UpTrend Scaling vs Podium",
    summary:
      "Podium is a big all-in-one messaging, payments and AI platform with sales-call pricing. UpTrend is built for local service businesses that just want more Google reviews: $70 a month, month to month, set up yourself in minutes.",
    rows: [
      {
        label: "Starting price",
        us: { text: "$70 / month", good: true },
        them: { text: "About $399 / month (reported)" },
      },
      {
        label: "Prices on the website",
        us: { text: "Yes, every plan", good: true },
        them: { text: "No, talk to sales" },
      },
      {
        label: "Sign up without a sales call",
        us: { text: "Yes, in minutes", good: true },
        them: { text: "Demo first" },
      },
      {
        label: "Free trial",
        us: { text: "7 days", good: true },
        them: { text: "No free trial listed" },
      },
      {
        label: "Contract",
        us: { text: "Month to month, cancel anytime", good: true },
        them: { text: "Reviewers report 12-month auto-renewing terms" },
      },
      { ...SHARED_ROWS.requests, them: { text: "Text invites" } },
      {
        label: "Jobber and Square",
        us: { text: "Both, connect in one click", good: true },
        them: { text: "Jobber on certain packages, set up with their team" },
      },
      {
        label: "Built for",
        us: { text: "Local service businesses", good: true },
        them: { text: "An all-in-one messaging, payments and AI platform" },
      },
    ],
    reasons: [
      {
        title: "A fraction of the price",
        detail:
          "Podium's plans are reported to start around $399 a month. UpTrend starts at $70, and every price is on our website.",
      },
      {
        title: "No sales call, no long contract",
        detail:
          "Sign up yourself in a few minutes and cancel anytime. Podium reviewers frequently mention yearly contracts that renew automatically.",
      },
      {
        title: "Built for reviews, not everything",
        detail:
          "You don't pay for an inbox, payments and AI phone tools you may never use. UpTrend does one job: more Google reviews, on autopilot.",
      },
      {
        title: "Works with Jobber and Square out of the box",
        detail:
          "Every paid invoice sends a review request automatically, no extra package needed.",
      },
    ],
    fairNote:
      "If you need two-way texting with customers, website chat and payments in one platform, Podium covers all of that. If your goal is more Google reviews, UpTrend gets you there for much less.",
    faq: [
      {
        q: "How much does Podium cost compared to UpTrend?",
        a: "Podium doesn't publish prices. Third-party reports put its plans at about $399 and $599 a month. UpTrend is $70, $100 or $200 a month per location, published on our site.",
      },
      {
        q: "Do I have to sign a contract with UpTrend?",
        a: "No. UpTrend is month to month and you can cancel anytime.",
      },
    ],
    sources: [
      { label: "Podium pricing page", url: "https://www.podium.com/pricing" },
      {
        label: "Podium reported pricing (CostBench)",
        url: "https://costbench.com/software/review-management/podium/",
      },
      {
        label: "Podium reviews on Trustpilot",
        url: "https://www.trustpilot.com/review/podium.com",
      },
      {
        label: "Podium and Jobber",
        url: "https://www.podium.com/marketplace/jobber",
      },
    ],
  },
  birdeye: {
    slug: "birdeye",
    name: "Birdeye",
    headline: "UpTrend Scaling vs Birdeye",
    summary:
      "Birdeye is an enterprise reputation platform built for multi-location brands, sold through demos, with annual contracts reported by customers. UpTrend gives local service businesses automatic Google review requests for $70 a month, month to month.",
    rows: [
      {
        label: "Starting price",
        us: { text: "$70 / month", good: true },
        them: { text: "About $299 / month per location (reported)" },
      },
      {
        label: "Prices on the website",
        us: { text: "Yes, every plan", good: true },
        them: { text: "No, request a quote" },
      },
      {
        label: "Sign up without a sales call",
        us: { text: "Yes, in minutes", good: true },
        them: { text: "Demo first" },
      },
      {
        label: "Free trial",
        us: { text: "7 days", good: true },
        them: { text: "No free trial listed" },
      },
      {
        label: "Contract",
        us: { text: "Month to month, cancel anytime", good: true },
        them: { text: "Annual contract (reported)" },
      },
      { ...SHARED_ROWS.requests, them: { text: "Yes" } },
      {
        label: "Jobber and Square",
        us: { text: "Yes", good: true },
        them: { text: "Yes, plus many more" },
      },
      { ...SHARED_ROWS.qr, them: { text: "Yes" } },
      {
        label: "Built for",
        us: { text: "Local service businesses", good: true },
        them: { text: "Multi-location brands and larger companies" },
      },
    ],
    reasons: [
      {
        title: "About a quarter of the price",
        detail:
          "Birdeye is reported to start around $299 a month per location, on an annual contract. UpTrend starts at $70 a month with no contract.",
      },
      {
        title: "Simple enough to set up today",
        detail:
          "No demo, no onboarding calls. Connect Jobber or Square, add your Google review link, and you're live.",
      },
      {
        title: "Made for owner-operators",
        detail:
          "Birdeye is built for big multi-location teams. UpTrend is built for the plumber, the cleaner and the roofer who just want more 5-star reviews.",
      },
      {
        title: "Cancel anytime",
        detail:
          "Birdeye reviewers often mention auto-renewing contracts and long cancellation notice. With UpTrend you can cancel whenever you want.",
      },
    ],
    fairNote:
      "If you run many locations and need monitoring across 150+ review sites, surveys and enterprise reporting, Birdeye is built for that. For a local business that wants more Google reviews, UpTrend is the faster, cheaper choice.",
    faq: [
      {
        q: "How much does Birdeye cost compared to UpTrend?",
        a: "Birdeye doesn't publish prices. Third-party reports put its plans at about $299 to $449 a month per location, billed annually. UpTrend is $70, $100 or $200 a month per location, month to month.",
      },
      {
        q: "Does UpTrend work with Jobber and Square like Birdeye?",
        a: "Yes. When an invoice is paid in Jobber or Square, UpTrend texts and emails that customer a review request automatically.",
      },
    ],
    sources: [
      { label: "Birdeye pricing page", url: "https://birdeye.com/pricing/" },
      {
        label: "Birdeye reported pricing (CostBench)",
        url: "https://costbench.com/software/review-management/birdeye",
      },
      {
        label: "Birdeye reviews on Trustpilot",
        url: "https://www.trustpilot.com/review/birdeye.com",
      },
      {
        label: "Birdeye and Jobber",
        url: "https://birdeye.com/integration/jobber/",
      },
    ],
  },
};

export const Route = createFileRoute("/compare/$competitor")({
  loader: ({ params }) => {
    const competitor = COMPETITORS[params.competitor.toLowerCase()];
    if (!competitor) throw notFound();
    return { slug: competitor.slug };
  },
  head: ({ params }) => {
    const c = COMPETITORS[params.competitor.toLowerCase()];
    if (!c) return { meta: [{ title: "Compare | UpTrend Scaling" }] };
    // Browser tab / Google result title keeps the "pricing and features"
    // words. The share title has no colon, because iMessage cuts everything
    // before a colon off some link previews.
    const title = `UpTrend Scaling vs ${c.name}: pricing and features compared`;
    const shareTitle = `UpTrend Scaling vs ${c.name}`;
    const description = `Comparing UpTrend Scaling and ${c.name} for Google review requests: price, contract, setup and features. UpTrend starts at $70 a month, month to month.`;
    const image = `${CANONICAL_SITE_URL}/og-compare-${c.slug}.png`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: shareTitle },
        { property: "og:description", content: description },
        {
          property: "og:url",
          content: `${CANONICAL_SITE_URL}/compare/${c.slug}`,
        },
        { property: "og:image", content: image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: shareTitle },
        { name: "twitter:title", content: shareTitle },
        { name: "twitter:image", content: image },
      ],
      links: [
        { rel: "canonical", href: `${CANONICAL_SITE_URL}/compare/${c.slug}` },
      ],
    };
  },
  component: ComparePage,
});

function Mark({ good }: { good?: boolean | undefined }) {
  return (
    <span
      className={good ? "cmp-mark cmp-mark-good" : "cmp-mark"}
      aria-hidden="true"
    >
      {good ? "✓" : "•"}
    </span>
  );
}

function ComparePage() {
  const { slug } = Route.useLoaderData();
  const c = COMPETITORS[slug] as Competitor;
  const others = Object.values(COMPETITORS).filter((o) => o.slug !== slug);

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
          <div className="site-nav-actions">
            <ThemeToggle />
            <a
              className="button button-primary nav-cta"
              href="/start?plan=trial&utm_source=compare"
            >
              Start free trial
            </a>
          </div>
        </div>
      </header>

      <main className="start-main">
        <div className="page-width cmp-page">
          <p className="eyebrow">
            <span /> Comparison
          </p>
          <h1 className="start-heading">{c.headline}</h1>
          <p className="start-lead">{c.summary}</p>

          <div className="cmp-table-wrap">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col" className="cmp-us-head">
                    UpTrend Scaling
                  </th>
                  <th scope="col">{c.name}</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td className="cmp-us">
                      <Mark good={row.us.good} />
                      {row.us.text}
                    </td>
                    <td>
                      <Mark good={row.them.good} />
                      {row.them.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="cmp-section">
            <h2>Why local businesses choose UpTrend over {c.name}</h2>
            <div className="cmp-reasons">
              {c.reasons.map((r) => (
                <div key={r.title}>
                  <h3>{r.title}</h3>
                  <p>{r.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="cmp-cta">
            <div>
              <h2>Try UpTrend free for 7 days</h2>
              <p>
                Plans from $70 a month per location. Month to month, set up in
                minutes, no sales call.
              </p>
            </div>
            <a
              className="button button-primary"
              href={`/start?plan=trial&utm_source=compare_${c.slug}`}
            >
              Start free trial
            </a>
          </section>

          <section className="cmp-section">
            <h2>Is {c.name} ever the better fit?</h2>
            <p className="cmp-muted">{c.fairNote}</p>
          </section>

          <section className="cmp-section">
            <h2>Questions</h2>
            <dl className="kit-faq">
              {c.faq.map((item) => (
                <div key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="cmp-section">
            <h2>More comparisons</h2>
            <p className="cmp-links">
              {others.map((o) => (
                <a key={o.slug} href={`/compare/${o.slug}`}>
                  UpTrend vs {o.name}
                </a>
              ))}
            </p>
          </section>

          <p className="cmp-sources">
            {c.name} details come from their own website and public pricing
            reports, checked October 2026. Prices and features change, so check
            their site for the latest.
            {c.slug === "nicejob"
              ? " "
              : ` "Reported" prices come from third-party pricing trackers because ${c.name} doesn't publish prices. `}
            Sources:{" "}
            {c.sources.map((s, i) => (
              <span key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {s.label}
                </a>
                {i < c.sources.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            {c.name} is a trademark of its owner. UpTrend Scaling is not
            affiliated with {c.name}.
          </p>
        </div>
      </main>
    </div>
  );
}
