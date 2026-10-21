import { useState } from "react";

import {
  requestSiteDomain,
  type MySiteState,
} from "../lib/site-gen/sites.server";

type Ready = Extract<MySiteState, { ok: true }>;

const STEPS = [
  { id: "details", label: "Your details" },
  { id: "building", label: "We build it" },
  { id: "review", label: "You review it" },
  { id: "live", label: "Live" },
] as const;

function stepIndex(status: Ready["status"]): number {
  if (status === "awaiting_details") return 0;
  if (status === "generating" || status === "review") return 1;
  if (status === "customer_review") return 2;
  return 3;
}

// Where a customer's website stands, what to do next, and the web address
// step once it is live. Used on the details page and in the dashboard.
export function SiteStatus({
  state,
  auth,
  detailsHref,
  onChanged,
}: {
  state: Ready;
  auth: { businessId?: string; token?: string };
  detailsHref: string;
  onChanged: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const now = stepIndex(state.status);

  async function sendDomain() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await requestSiteDomain({ data: { ...auth, domain } });
      if (result.ok) {
        setMsg({
          ok: true,
          text: `Got it. We will connect ${result.domain} and email you when it is done.`,
        });
        onChanged();
      } else {
        setMsg({ ok: false, text: result.message });
      }
    } catch {
      setMsg({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const live = state.status === "live" || state.status === "paused";

  return (
    <div className="sd-card">
      <ol className="sd-steps" aria-label="Website progress">
        {STEPS.map((step, i) => (
          <li
            key={step.id}
            className={i < now ? "done" : i === now ? "now" : ""}
          >
            {i < now ? "✓ " : ""}
            {step.label}
          </li>
        ))}
      </ol>

      {state.status === "awaiting_details" ? (
        <>
          <h2>Next: tell us about your business</h2>
          <p>
            A five-minute form is all we need to build your site: your services,
            phone number, colors, and a logo and photos if you have them.
          </p>
          <div>
            <a className="sd-btn pri" href={detailsHref}>
              Fill out the form
            </a>
          </div>
        </>
      ) : null}

      {state.status === "generating" || state.status === "review" ? (
        <>
          <h2>We are building your website</h2>
          <p>
            {state.status === "review" && state.changeRequestCount > 0
              ? "We got your change request and are updating the site. We will email you when the new version is ready."
              : "We are putting your site together now. We will email you as soon as it is ready for you to look at, usually within a day."}
          </p>
        </>
      ) : null}

      {state.status === "customer_review" && state.customerPreviewUrl ? (
        <>
          <h2>Your website is ready to look at</h2>
          <p>
            Open the preview, click around on your phone and your computer, then
            approve it or ask for changes.
          </p>
          <div>
            <a
              className="sd-btn pri"
              href={state.customerPreviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open my website preview
            </a>
          </div>
        </>
      ) : null}

      {live && state.liveUrl ? (
        <>
          <h2>
            {state.status === "paused"
              ? "Your free address has ended"
              : "Your website is live"}
          </h2>
          <p>
            <a href={state.liveUrl} target="_blank" rel="noreferrer">
              {state.liveUrl}
            </a>
          </p>

          {state.customDomain ? (
            <div className="sd-note ok">
              Your own web address is connected: {state.customDomain}
            </div>
          ) : state.domainRequested ? (
            <div className="sd-note ok">
              We got your web address and are connecting it. We will email you
              when it is done.
            </div>
          ) : state.maintenanceActive ? (
            <div className="sd-note">
              Your upkeep plan keeps this address running. You can still add
              your own web address any time below.
            </div>
          ) : (
            <div
              className={
                state.daysLeft !== null && state.daysLeft <= 2
                  ? "sd-note bad"
                  : "sd-note"
              }
            >
              {state.status === "paused"
                ? "Enter your own web address below and we will bring your site back at it."
                : `This free address stays up for ${state.daysLeft ?? 7} more ${
                    state.daysLeft === 1 ? "day" : "days"
                  }. Enter the web address you want (like yourbusiness.com) and we will connect it for you.`}
            </div>
          )}

          {!state.customDomain && !state.domainRequested ? (
            <div className="sd-row">
              <input
                type="text"
                inputMode="url"
                placeholder="yourbusiness.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                aria-label="Your web address"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <button
                className="sd-btn pri"
                type="button"
                disabled={busy || !domain.trim()}
                onClick={sendDomain}
              >
                {busy ? "Sending..." : "Send my web address"}
              </button>
            </div>
          ) : null}
          {msg ? (
            <div className={msg.ok ? "sd-note ok" : "sd-note bad"}>
              {msg.text}
            </div>
          ) : null}
          <p>
            Do not own a web address yet? You can buy one at any domain seller
            (usually about $12 a year), then enter it here.
          </p>
        </>
      ) : null}
    </div>
  );
}
