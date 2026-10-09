import { useEffect, useState, type FormEvent } from "react";

import {
  getMyReferral,
  saveMyPayPal,
  type MyReferralResult,
} from "../../lib/affiliates.server";
import { COMPARISON_PAGES, comparisonLink } from "../../lib/compare-links";
import { DashButton, DashInput, DashPanel } from "./primitives";

type Loaded = Extract<MyReferralResult, { ok: true }>;

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// "Refer a business" on the Overview page. Every paying customer has a
// referral link on the same terms as affiliates: 25% of every payment for as
// long as the referred business stays, plus $20 on its 2nd payment. Loads on
// its own after the page so it never slows the dashboard down, and simply
// doesn't show for demo and admin accounts.
export function ReferralPanel() {
  const [data, setData] = useState<Loaded | null>(null);
  const [copied, setCopied] = useState(false);
  const [paypal, setPaypal] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMyReferral()
      .then((result) => {
        if (!alive || !result.ok) return;
        setData(result);
        setPaypal(result.paypalEmail ?? "");
      })
      .catch(() => {
        // Optional panel: if it can't load, the dashboard just doesn't show it.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNote(null);
    try {
      const result = await saveMyPayPal({ data: { paypalEmail: paypal } });
      setNote(
        result.ok
          ? "Saved. Payouts will go to this PayPal."
          : (result.message ?? "Please check the email."),
      );
    } catch {
      setNote("Enter the email on your PayPal account.");
    } finally {
      setSaving(false);
    }
  }

  const owed = Math.max(0, data.earnedCents - data.paidOutCents);

  return (
    <DashPanel
      title="Refer a business, earn every month"
      hint="25% of every payment for as long as they stay, plus $20"
    >
      <div className="ref-panel">
        <p className="ref-lead">
          Know another business owner who needs more Google reviews? Share your
          link. They skip the $20 setup fee, and you earn 25% of every payment
          they make for as long as they stay, plus a $20 bonus on their 2nd
          payment. Paid monthly by PayPal once you've earned $25.
        </p>
        <div className="ref-link">
          <code>{data.link}</code>
          <DashButton size="sm" variant="primary" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy link"}
          </DashButton>
        </div>
        <div className="ref-stats">
          <div>
            <span>Signed up</span>
            <strong>{data.referrals}</strong>
          </div>
          <div>
            <span>Paying</span>
            <strong>{data.payingReferrals}</strong>
          </div>
          <div>
            <span>Earned</span>
            <strong>{dollars(data.earnedCents)}</strong>
          </div>
          <div>
            <span>Owed to you</span>
            <strong>{dollars(owed)}</strong>
          </div>
        </div>
        <form className="ref-paypal" onSubmit={(e) => void save(e)}>
          <DashInput
            type="email"
            placeholder="Your PayPal email, for payouts"
            value={paypal}
            onChange={(e) => setPaypal(e.target.value)}
            aria-label="PayPal email for referral payouts"
          />
          <DashButton size="sm" variant="ghost" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </DashButton>
        </form>
        {note ? <p className="ref-note">{note}</p> : null}
        <p className="ref-note ref-compare">
          Comparison pages with your link built in:{" "}
          {COMPARISON_PAGES.map((page, i) => (
            <span key={page.slug}>
              <a
                href={comparisonLink(
                  page.slug,
                  new URL(data.link).searchParams.get("ref"),
                )}
                target="_blank"
                rel="noreferrer"
              >
                vs {page.name}
              </a>
              {i < COMPARISON_PAGES.length - 1 ? ", " : ""}
            </span>
          ))}
          . Right-click to copy a link and share it.
        </p>
        <p className="ref-note">
          Mention that you earn a reward when you share your link. Ready-made
          emails and posts are in the{" "}
          <a
            href={`/affiliates/kit?ref=${new URL(data.link).searchParams.get("ref") ?? ""}`}
            target="_blank"
            rel="noreferrer"
          >
            partner kit
          </a>
          .
        </p>
      </div>
    </DashPanel>
  );
}
