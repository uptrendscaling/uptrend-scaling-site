import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { ThemeToggle } from "../components/theme-toggle";
import { readRefCookie } from "../lib/affiliate-config";
import { COMPARISON_PAGES, comparisonLink } from "../lib/compare-links";
import { CANONICAL_SITE_URL } from "../lib/site";

// The partner kit: ready-to-use emails, posts and answers for affiliates.
// The approval email links here with ?ref=CODE so every template already has
// the partner's own link in it. Without a code it shows a placeholder.
const searchSchema = z.object({
  ref: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]{2,32}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/affiliates_/kit")({
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Partner kit | UpTrend Scaling" },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "UpTrend Scaling partner kit" },
      {
        property: "og:image",
        content: `${CANONICAL_SITE_URL}/og-affiliates.png`,
      },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        name: "twitter:image",
        content: `${CANONICAL_SITE_URL}/og-affiliates.png`,
      },
    ],
  }),
  component: PartnerKit,
});

const PLACEHOLDER = "[your link]";

function templates(link: string) {
  return {
    pitch: [
      "UpTrend Scaling gets local businesses more Google reviews without anyone having to ask.",
      "When a customer pays (through Square or Jobber, or added by hand), UpTrend texts and emails them a one-tap Google review link, with one friendly reminder.",
      "The owner sees every request and every result in a simple dashboard, and can print QR codes for in-person asks.",
      "Plans start at $70 a month per location, with a 7-day free trial. Anyone who signs up through your link skips the $20 setup fee.",
    ],
    email: `Subject: How I'd get more Google reviews

Hi [name],

Quick one. If you're looking for more Google reviews without having to chase customers, take a look at UpTrend Scaling.

Once a customer pays, it automatically texts and emails them a one-tap link to leave a review, plus one reminder. It works with Square and Jobber, so there's nothing extra to do after a job.

There's a 7-day free trial, and through my link you skip the $20 setup fee:
${link}

Full disclosure: I earn a commission if you sign up through my link.

[your name]`,
    text: `Hey [name], if you want more Google reviews without chasing customers, check out UpTrend Scaling. It texts your customers a review link automatically after they pay. 7-day free trial, and my link skips the $20 setup fee: ${link} (I earn a commission if you sign up.)`,
    posts: [
      `Most local businesses don't have a "bad service" problem. They have a "we never ask for reviews" problem.

UpTrend Scaling fixes that. After a customer pays, it texts them a one-tap Google review link automatically, plus one reminder.

7-day free trial, and you skip the setup fee here: ${link}

I earn a commission if you sign up through my link.

#GoogleReviews #LocalBusiness #SmallBusinessMarketing #HomeServiceBusiness #ReputationManagement`,
      `If you run a service business, your next customer is reading your Google reviews right now.

The owners I see winning ask every single customer for a review. UpTrend Scaling does that for you, automatically, the moment a job is paid.

Try it free for 7 days: ${link}
(Affiliate link, I earn a commission.)

#GoogleReviews #SmallBusiness #LocalSEO #ContractorMarketing #ReputationManagement`,
      `Quick tip for business owners: timing matters more than wording when you ask for a review. Ask right after the job, while the customer is happy.

That's exactly what UpTrend Scaling automates. Check it out (setup fee waived through my link): ${link}

I earn a commission if you sign up.

#GoogleReviews #LocalBusiness #SmallBusinessTips #CustomerReviews #ReputationManagement`,
    ],
    video: [
      "Open with the problem: happy customers rarely leave reviews unless someone asks at the right moment.",
      "Show or describe how it works: the job is paid, a text with a review link goes out, and one reminder if they forget.",
      "Mention it works with Square and Jobber, plus QR codes for in-person asks.",
      "Give the offer: 7-day free trial, setup fee waived through your link (put the link in the description and pin it in the comments).",
      'Say it out loud in the video: "I earn a commission if you sign up through my link."',
    ],
  };
}

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Who is it for?",
    a: "Local service businesses that live on Google reviews: HVAC, plumbing, roofing, electrical, cleaning, landscaping, pest control, pool service, salons, pet groomers, vets and similar.",
  },
  {
    q: "What does it cost?",
    a: "Starter is $70 a month per location for up to 1,000 review requests, Growth is $100 for up to 2,500, and Pro is $200 for up to 6,000. Every plan starts with a 7-day free trial. Through your link, the one-time $20 setup fee is waived.",
  },
  {
    q: "Does it work with the software they already use?",
    a: "It connects to Square and Jobber, so paid invoices trigger review requests automatically. Customers can also be added by hand in the dashboard, and there are QR codes for in-person requests.",
  },
  {
    q: "Is it OK to text customers?",
    a: "Yes, for customers who agreed to hear from the business. Every text includes a way to opt out (reply STOP), and the business confirms consent when adding a customer by hand.",
  },
  {
    q: "Does it filter out bad reviews?",
    a: "No. Every customer gets the same honest request to leave a review on Google. Please never describe it as a way to get only 5-star reviews or hide negative ones.",
  },
  {
    q: "How and when do I get paid?",
    a: "You earn 25% of every payment each business you refer makes, for as long as they stay a customer, plus a $20 bonus when each one makes its 2nd payment. Commission on a business becomes payable after their 2nd monthly payment, and we pay monthly by PayPal once you've earned $25.",
  },
];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }
  return { copied, copy };
}

function CopyBlock({
  id,
  title,
  text,
  copied,
  onCopy,
}: {
  id: string;
  title: string;
  text: string;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  return (
    <div className="kit-block">
      <div className="kit-block-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="button button-ghost kit-copy"
          onClick={() => onCopy(id, text)}
        >
          {copied === id ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="kit-text">{text}</pre>
    </div>
  );
}

function PartnerKit() {
  const { ref } = Route.useSearch();
  const [code, setCode] = useState<string | null>(ref ?? null);
  const { copied, copy } = useCopy();

  useEffect(() => {
    if (!ref) setCode(readRefCookie());
  }, [ref]);

  const link = code ? `${CANONICAL_SITE_URL}/?ref=${code}` : PLACEHOLDER;
  const t = templates(link);

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
            <a className="button button-ghost nav-cta" href="/affiliates">
              Partner program
            </a>
          </div>
        </div>
      </header>

      <main className="start-main">
        <div className="page-width kit-page">
          <p className="eyebrow">
            <span /> Partner kit
          </p>
          <h1 className="start-heading">
            Everything you need to share UpTrend.
          </h1>
          <p className="start-lead">
            Copy, paste, send. Each template already includes your link
            {code ? "" : " once you open this page from your approval email"}.
            Keep the commission line in whatever you share.
          </p>

          <section className="kit-link" aria-label="Your link">
            <span>Your link</span>
            <strong>{link}</strong>
            {code ? (
              <button
                type="button"
                className="button button-primary kit-copy"
                onClick={() => void copy("link", link)}
              >
                {copied === "link" ? "Copied" : "Copy link"}
              </button>
            ) : (
              <a className="button button-ghost kit-copy" href="/affiliates">
                Not a partner yet? Apply
              </a>
            )}
          </section>

          <section className="kit-section">
            <h2>The 30-second pitch</h2>
            <ul className="kit-points">
              {t.pitch.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <section className="kit-section">
            <h2>Send to a business owner</h2>
            <CopyBlock
              id="email"
              title="Email"
              text={t.email}
              copied={copied}
              onCopy={(i, x) => void copy(i, x)}
            />
            <CopyBlock
              id="text"
              title="Text or DM"
              text={t.text}
              copied={copied}
              onCopy={(i, x) => void copy(i, x)}
            />
          </section>

          <section className="kit-section">
            <h2>Social posts</h2>
            {t.posts.map((post, index) => (
              <CopyBlock
                key={post.slice(0, 24)}
                id={`post${index}`}
                title={`Post ${index + 1}`}
                text={post}
                copied={copied}
                onCopy={(i, x) => void copy(i, x)}
              />
            ))}
          </section>

          <section className="kit-section">
            <h2>Comparison pages</h2>
            <p className="kit-lead">
              Side-by-side pages showing why businesses pick UpTrend over the
              big names. Great for a "which review tool should I use?" post,
              video or email.
              {code ? " Your link is already built into each one." : ""}
            </p>
            <div className="kit-compare">
              {COMPARISON_PAGES.map((page) => {
                const url = comparisonLink(page.slug, code);
                return (
                  <div key={page.slug} className="kit-compare-row">
                    <div>
                      <strong>UpTrend vs {page.name}</strong>
                      <span>{url}</span>
                    </div>
                    <div className="kit-compare-actions">
                      <a
                        className="button button-ghost kit-copy"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        className="button button-ghost kit-copy"
                        onClick={() => void copy(`cmp-${page.slug}`, url)}
                      >
                        {copied === `cmp-${page.slug}` ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="kit-section">
            <h2>Making a video or podcast mention</h2>
            <ul className="kit-points">
              {t.video.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <section className="kit-section">
            <h2>Common questions</h2>
            <dl className="kit-faq">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="kit-section kit-rules">
            <h2>Two rules</h2>
            <ul className="kit-points">
              <li>
                Always say you earn a commission, right next to your link (in
                videos, say it out loud). This is an FTC requirement.
              </li>
              <li>
                No spam, no bidding on "UpTrend Scaling" in search ads, and no
                promises we don't make (like a guaranteed number of reviews).
                Full terms are on the{" "}
                <a href="/affiliates#terms">program page</a>.
              </li>
            </ul>
            <p className="start-disclaimer">
              Want a post or email written for your audience? Email
              hello@uptrendscaling.com and we'll write it for you.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
