import { useState } from "react";

import { cancelMembership, type CancelPart } from "../../lib/membership.server";
import { DashAlert, DashButton, DashPanel, DashText } from "./primitives";
import type { DashboardShell } from "./types";

type Business = DashboardShell["business"];

const CONFIRM_TEXT: Record<CancelPart, string> = {
  reviews:
    "Cancel your Google review plan? Review requests stop going out and your review dashboard locks right away. Your customer data is kept. Website maintenance, if you have it, keeps going.",
  maintenance:
    "Cancel website maintenance? Billing for maintenance stops right away. Your Google review plan, if you have one, keeps going.",
  both: "Cancel everything? Review requests stop, your review dashboard locks, and website maintenance billing stops. Your customer data is kept.",
};

const CONFIRM_BUTTON: Record<CancelPart, string> = {
  reviews: "Yes, cancel the review plan",
  maintenance: "Yes, cancel maintenance",
  both: "Yes, cancel both",
};

// Cancel buttons: review plan only, website maintenance only, or both. Two
// steps on purpose: the first click only asks "are you sure?", the second does
// it. Canceling takes effect right away, then the page reloads to show it.
export function PlansPanel({
  business,
  onChanged,
}: {
  business: Business;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<CancelPart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasReviews = Boolean(business.plan) && !business.accessRevoked;
  const hasMaintenance = business.maintenanceActive;

  async function handleCancel(part: CancelPart) {
    setBusy(true);
    setError(null);
    try {
      const result = await cancelMembership({ data: { part } });
      if (result.ok) {
        // Stay on "Canceling..." until the dashboard reloads with the change,
        // so a second click cannot happen.
        onChanged();
        return;
      }
      setError(result.message);
    } catch (err) {
      console.error(err);
      setError(
        "Something went wrong and nothing was changed. Please try again, or email hello@uptrendscaling.com.",
      );
    }
    setBusy(false);
  }

  if (!hasReviews && !hasMaintenance) {
    return (
      <DashPanel title="Your plans">
        <DashText>
          You have nothing billing monthly right now. To start a plan again,
          email{" "}
          <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>.
        </DashText>
      </DashPanel>
    );
  }

  const options: CancelPart[] = [];
  if (hasReviews) options.push("reviews");
  if (hasMaintenance) options.push("maintenance");
  if (hasReviews && hasMaintenance) options.push("both");

  const buttonLabel: Record<CancelPart, string> = {
    reviews: "Cancel review plan only",
    maintenance: "Cancel maintenance only",
    both: "Cancel both",
  };

  return (
    <DashPanel title={hasReviews && hasMaintenance ? "Your plans" : "Your membership"}>
      <DashText>
        {business.plan === "trial" && hasReviews
          ? "You are on the 7 day free trial. Cancel any time before it ends and you will not be charged anything. "
          : "Cancel any time. It ends right away and you will not be billed again for what you cancel. "}
        {hasReviews && hasMaintenance
          ? "You have a Google review plan and website maintenance, and you can cancel either one on its own."
          : ""}
      </DashText>
      {confirming ? (
        <>
          <DashAlert tone="warn">{CONFIRM_TEXT[confirming]}</DashAlert>
          <div className="dash-conn-actions">
            <DashButton
              variant="danger"
              onClick={() => void handleCancel(confirming)}
              disabled={busy}
            >
              {busy ? "Canceling..." : CONFIRM_BUTTON[confirming]}
            </DashButton>
            <DashButton
              variant="ghost"
              onClick={() => {
                setConfirming(null);
                setError(null);
              }}
              disabled={busy}
            >
              Keep my plan
            </DashButton>
          </div>
        </>
      ) : (
        <div className="dash-conn-actions">
          {options.map((part) => (
            <DashButton
              key={part}
              variant="danger"
              onClick={() => setConfirming(part)}
            >
              {options.length === 1 && part === "reviews"
                ? "Cancel membership"
                : options.length === 1 && part === "maintenance"
                  ? "Cancel maintenance"
                  : buttonLabel[part]}
            </DashButton>
          ))}
        </div>
      )}
      {error ? (
        <p className="dash-form-message dash-form-message-error">{error}</p>
      ) : null}
    </DashPanel>
  );
}
