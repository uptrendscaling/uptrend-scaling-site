import { createFileRoute } from "@tanstack/react-router";
import { ThemeToggle } from "../components/theme-toggle";

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
          <div className="site-nav-actions">
            <ThemeToggle />
            <a className="button button-ghost nav-cta" href="/">
              Back to site
            </a>
          </div>
        </div>
      </header>

      <main className="legal-main">
        <div className="page-width legal-page">
          <p className="eyebrow">
            <span /> Legal
          </p>
          <h1>Terms of Service</h1>
          <p className="legal-updated">Last updated: October 15, 2026</p>

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
            engagement on your behalf. We also design, build, host, and maintain websites for local
            businesses (the "Website Services," see sections 7 and 8).
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

          <h2>4. Text message (SMS) program</h2>
          <p>
            Program: UpTrend Scaling sends review-request text messages on behalf of the
            businesses that use the Service. Each message asks one of that business's own
            customers to leave a Google review, and is sent only after the business confirms the
            customer agreed to be contacted. A customer receives one request per completed job,
            plus at most one reminder if they haven't responded. We do not send marketing or
            promotional texts through this program.
          </p>
          <p>
            Message frequency varies with how often the business serves you, and is typically one
            or two messages per job. Message and data rates may apply. Reply STOP at any time to
            opt out and you will receive no further texts; reply HELP for help, or email
            hello@uptrendscaling.com. Carriers are not liable for delayed or undelivered
            messages. Phone numbers and consent information are never shared with third parties for
            their own marketing purposes; see our Privacy Policy for details.
          </p>

          <h2>5. No fake or incentivized reviews</h2>
          <p>
            The Service is built to help you ask real customers for honest feedback. You agree not
            to use the Service to solicit reviews from people who didn't actually do business with
            you, to offer payment or discounts in exchange for a positive review, to filter or
            suppress requests based on anticipated review sentiment, or otherwise to violate
            Google's review policies or any other review platform's guidelines.
          </p>

          <h2>6. Subscriptions, billing, and cancellation</h2>
          <p>
            The Google review plans are billed monthly per location, plus a one-time setup fee,
            through our payment processor, Stripe. If you start a free trial of a review plan, you
            won't be charged until the trial period ends, and you can cancel any time before then
            at no cost. Website Services (see section 7) are paid at checkout and have no free
            trial. Subscriptions are month-to-month with no long-term contract.
          </p>
          <p>
            You can cancel the Google review plan only, website maintenance only, or both, at any
            time from the Settings page of your dashboard, or by emailing hello@uptrendscaling.com.
            Cancellation takes effect right away: what you cancel ends and you won't be billed for
            it again, while anything you did not cancel continues. We don't provide refunds for
            partial billing periods or for a website build that has already been started, except
            where required by law.
          </p>

          <h2>7. Website Services</h2>
          <p>
            Website build ($299, one-time): we design and build a website for your business, and
            you approve it before it goes live. Website maintenance ($99 per month): hosting, small
            content updates, and email support for your site, whether we built it or you already
            had it. You can order the build alone, the build with maintenance, or maintenance only.
            Maintenance covers reasonable small updates such as text, photos, hours, and contact
            details; larger changes such as new pages or a redesign may be quoted separately.
          </p>
          <p>
            You are responsible for the accuracy and legality of the content, logos, photos, and
            claims you give us, and you confirm you have the right to use them. We will use
            reasonable efforts to keep your site online, but we do not guarantee uninterrupted
            availability, search rankings, traffic, or leads. If you cancel maintenance, we may take
            your site offline after your last paid period ends; contact us before canceling if you
            want a copy of your site's content.
          </p>

          <h2>8. Website security</h2>
          <p>
            Websites we build are published on a third-party hosting platform. Based on information
            that platform publishes about itself, published sites are served over HTTPS (plain HTTP
            requests are redirected to HTTPS and browsers are told to keep using HTTPS), have a
            valid security certificate, and are sent with browser hardening settings that help
            protect against being embedded in other sites, content type guessing, and unwanted
            access to sensitive browser features. The platform also reports checking project
            dependencies against a public vulnerability database. These protections are provided by
            the hosting platform and may change.
          </p>
          <p>
            Security is a shared effort and no website can be made completely secure. We do not
            promise that your site will never be attacked, defaced, or interrupted, and these
            platform protections are not a certification or audit of your particular site. Our
            design and customer sites are informational and do not collect payments or store
            customer accounts unless we have agreed to that in writing. Please do not send us
            passwords or payment card details by email.
          </p>

          <h2>9. Acceptable use</h2>
          <p>
            You agree not to use the Service to send unlawful, harassing, or deceptive messages; to
            attempt to interfere with or disrupt the Service; to reverse-engineer or resell the
            Service without our written permission; or to use the Service in a way that violates the
            rights of any third party.
          </p>

          <h2>10. Third-party services</h2>
          <p>
            The Service relies on third-party providers to operate, including Stripe for payments,
            Telnyx for SMS delivery, Resend for email delivery, and a third-party hosting provider for the websites we build. Your use of the Service is also
            subject to the applicable terms of those providers where relevant to the features they
            power.
          </p>

          <h2>11. Termination</h2>
          <p>
            We may suspend or terminate access to the Service if these Terms are violated, if
            payment is not received, or if we reasonably believe the Service is being used to send
            unlawful or unsolicited messages. You may stop using the Service and cancel your account
            at any time.
          </p>

          <h2>12. Disclaimers and limitation of liability</h2>
          <p>
            The Service is provided "as is" without warranties of any kind, express or implied. We
            don't guarantee any specific number of reviews, response rate, or business outcome. To
            the fullest extent permitted by law, UpTrend Scaling won't be liable for any indirect,
            incidental, or consequential damages arising from use of the Service, and our total
            liability for any claim is limited to the amount you paid us in the three months before
            the claim arose.
          </p>

          <h2>13. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. If we make material changes, we'll let you
            know by email or by posting a notice in the dashboard. Continued use of the Service
            after changes take effect means you accept the updated Terms.
          </p>

          <h2>14. Contact</h2>
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
            <a href="/privacy">Privacy</a> ·{" "}
            <a
              href="https://www.facebook.com/profile.php?id=61594598074617"
              target="_blank"
              rel="noopener noreferrer"
            >
              Facebook
            </a>{" "}
            ·{" "}
            <a href="https://www.instagram.com/uptrendscaling/" target="_blank" rel="noopener noreferrer">
              Instagram
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
