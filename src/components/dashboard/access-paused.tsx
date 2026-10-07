import { DashPanel, DashText } from "./primitives";

// Shown instead of the dashboard when the subscription was canceled or went
// unpaid (businesses.access_revoked, set by the Stripe webhook).
export function AccessPausedPanel() {
  return (
    <DashPanel title="Your subscription has ended" className="dash-paused">
      <DashText>
        Your dashboard is paused because your UpTrend Scaling subscription was
        canceled. Your customer data is safe, and everything comes right back
        once your subscription is active again. Email{" "}
        <a href="mailto:hello@uptrendscaling.com">hello@uptrendscaling.com</a>{" "}
        if you would like to reactivate or have questions about your billing.
      </DashText>
    </DashPanel>
  );
}
