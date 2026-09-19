import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service | UpTrend Scaling" },
      { name: "description", content: "Terms of Service for UpTrend Scaling." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
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
          <h1>Terms of Service</h1>
          <p className="legal-updated">Last updated: September 19, 2026</p>

          <p>
            These Terms of Service ("Terms") govern access to and use of the UpTrend Scaling
            website, dashboard, and related services (the "Service"), provided by UpTrend Scaling,
            LLC ("UpTrend Scaling," "we," "us," or "our"). By creating an account, starting a free
            trial, or otherwise using the Service, you agree to these Terms on behalf of yourself
            and the business you represent ("you" or "your").
          </p>

          <h2>1. The Service</h2>
          <p>
            UpTrend Scaling helps local businesses request Google reviews from their customers via
            SMS text message, email, and QR codes, and provides reporting on those requests. You
            provide the contact information for your own customers; we send the messages and track
            engagement on your behalf.
          </p>

          <h2>2. Accounts</h2>
          <p>
            You must provide accurate information when signing up and keep your login credentials
            confidential. You're responsible for all activity that happens under your account.
            Accounts are single business, single user for now; let us know if you need more than one
            person accessing your dashboard.
          </p>

          <h2>3. Your customer data and consent</h2>
          <p>
            You represent that you have the right to share your customers' names, phone numbers, and
            email addresses with us, and that you have a lawful basis (such as an existing business
            relationship) to contact them about leaving a review. You are responsible for complying
            with all applicable laws governing commercial text messages and emails, including the
            Telephone Consumer Protection Act (TCPA), the CAN-SPAM Act, and any state equivalents.
            Every message we send on your behalf includes a clear opt-out mechanism, and we will
            honor opt-out requests.
          </p>

          <h2>4. No fake or incentivized reviews</h2>
          <p>
            The Service is built to help you ask real customers for honest feedback. You agree not
            to use the Service to solicit reviews from people who didn't actually do business with
            you, to offer payment or discounts in exchange for a positive review, to filter or
            suppress requests based on anticipated review sentiment, or otherwise to violate
            Google's review policies or any other review platform's guidelines.
          </p>

          <h2>5. Subscriptions, billing, and cancellation</h2>
          <p>
            Paid plans are billed monthly per location, plus a one-time setup fee, through our
            payment processor, Stripe. If you start a free trial, you won't be charged until the
            trial period ends, and you can cancel any time before then at no cost. Subscriptions are
            month-to-month with no long-term contract; you may cancel at any time, effective at the
            end of your current billing period, by emailing hello@uptrendscaling.com. We don't
            provide refunds for partial billing periods except where required by law.
          </p>

          <h2>6. Acceptable use</h2>
          <p>
            You agree not to use the Service to send unlawful, harassing, or deceptive messages; to
            attempt to interfere with or disrupt the Service; to reverse-engineer or resell the
            Service without our written permission; or to use the Service in a way that violates the
            rights of any third party.
          </p>

          <h2>7. Third-party services</h2>
          <p>
            The Service relies on third-party providers to operate, including Stripe for payments,
            Twilio for SMS delivery, and Resend for email delivery. Your use of the Service is also
            subject to the applicable terms of those providers where relevant to the features they
            power.
          </p>

          <h2>8. Termination</h2>
          <p>
            We may suspend or terminate access to the Service if these Terms are violated, if
            payment is not received, or if we reasonably believe the Service is being used to send
            unlawful or unsolicited messages. You may stop using the Service and cancel your account
            at any time.
          </p>

          <h2>9. Disclaimers and limitation of liability</h2>
          <p>
            The Service is provided "as is" without warranties of any kind, express or implied. We
            don't guarantee any specific number of reviews, response rate, or business outcome. To
            the fullest extent permitted by law, UpTrend Scaling won't be liable for any indirect,
            incidental, or consequential damages arising from use of the Service, and our total
            liability for any claim is limited to the amount you paid us in the three months before
            the claim arose.
          </p>

          <h2>10. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. If we make material changes, we'll let you
            know by email or by posting a notice in the dashboard. Continued use of the Service
            after changes take effect means you accept the updated Terms.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
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
