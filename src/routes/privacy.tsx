import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | UpTrend Scaling" },
      { name: "description", content: "Privacy Policy for UpTrend Scaling." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="site-shell">
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
          <a className="button button-ghost nav-cta" href="/">
            Back to site
          </a>
        </div>
      </header>

      <main className="legal-main">
        <div className="page-width legal-page">
          <p className="eyebrow">
            <span /> Legal
          </p>
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Last updated: September 19, 2026</p>

          <p>
            This Privacy Policy explains how UpTrend Scaling, LLC ("UpTrend Scaling," "we," "us," or
            "our") collects, uses, and shares information through the UpTrend Scaling website and
            dashboard (the "Service").
          </p>

          <h2>1. Information we collect</h2>
          <p>
            <strong>From businesses who sign up.</strong> When you create an account, we collect
            your business name, your name, work email, phone number, number of locations, and
            billing information (handled directly by Stripe, we don't store full card numbers).
          </p>
          <p>
            <strong>From your customers, on your behalf.</strong> When you add a customer to send a
            review request, we collect the name, phone number, and/or email address you give us for
            that person, along with a record of the messages sent to them and whether they clicked
            their review link. This information is provided by you, the business, not collected by
            us directly from your customers.
          </p>
          <p>
            <strong>Automatically.</strong> Like most websites, we collect basic technical
            information such as IP address, browser type, and pages visited, to keep the Service
            secure and working correctly.
          </p>

          <h2>2. How we use information</h2>
          <p>
            We use this information to operate the Service: to send the SMS and email review
            requests you request on your customers' behalf, to track link clicks so we can show you
            accurate reporting, to bill your subscription, to provide customer support, and to keep
            the Service secure and improve it over time. We do not sell your data or your customers'
            data to third parties.
          </p>

          <h2>3. Who we share it with</h2>
          <p>
            We share information with the service providers that power specific features of the
            Service, and only as needed for them to perform that function:
          </p>
          <ul>
            <li>
              <strong>Stripe</strong> — processes subscription payments and stores billing details.
            </li>
            <li>
              <strong>Twilio</strong> — delivers the SMS text messages sent through the Service.
            </li>
            <li>
              <strong>Resend</strong> — delivers the emails sent through the Service.
            </li>
            <li>
              <strong>Neon / Vercel</strong> — host our database and application infrastructure.
            </li>
          </ul>
          <p>
            We may also disclose information if required by law, or to protect the rights, safety,
            or property of UpTrend Scaling, our users, or others.
          </p>

          <h2>4. SMS and email consent</h2>
          <p>
            Businesses using the Service are responsible for having a lawful basis to text or email
            their own customers. Every message sent through the Service includes a clear way to opt
            out (replying STOP for SMS, or an unsubscribe path for email), and we honor those
            requests promptly. Phone numbers and consent information collected for SMS messaging are
            never shared with third parties for their own marketing purposes.
          </p>

          <h2>5. Data retention</h2>
          <p>
            We retain account and customer data for as long as your account is active, so your
            reporting stays accurate. If you close your account, we'll delete or anonymize your data
            within a reasonable period, except where we need to keep records for legal, billing, or
            security reasons.
          </p>

          <h2>6. Your choices</h2>
          <p>
            If you're a business using the Service, you can update or delete customer records from
            your dashboard, and you can close your account at any time by emailing us. If you're a
            customer who received a review request and want your information removed, ask the
            business that sent it, or contact us directly and we'll help.
          </p>

          <h2>7. Security</h2>
          <p>
            We use industry-standard measures to protect information, including encrypted
            connections, hashed passwords, and access controls limiting who can see your data. No
            system is perfectly secure, but we take reasonable steps to protect what you share with
            us.
          </p>

          <h2>8. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. If we make material changes, we'll
            let you know by email or by posting a notice in the dashboard.
          </p>

          <h2>9. Contact</h2>
          <p>
            Questions about this policy or your data? Email{" "}
            <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>.
          </p>
        </div>
      </main>

      <footer className="site-footer">
        <div className="page-width footer-inner">
          <div>
            <a className="brand footer-brand" href="/">
              <span className="brand-mark">
                <svg viewBox="0 0 28 28">
                  <path d="M4 20 11 13l4 4 9-10M17 7h7v7" />
                </svg>
              </span>
              <span>
                UpTrend <em>Scaling</em>
              </span>
            </a>
            <p>Google review automation for local businesses.</p>
          </div>
          <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>
          <span>
            © 2026 UpTrend Scaling, LLC. All rights reserved. · <a href="/terms">Terms</a> ·{" "}
            <a href="/privacy">Privacy</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
