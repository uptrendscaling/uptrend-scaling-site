import { useState } from "react";

import {
  markCustomerReviewed,
  resendReviewRequest,
  type CustomerRow,
} from "../../lib/reviews.server";
import { cx } from "./format";
import { DashEmpty, DashPanel, DashPill, DashTable } from "./primitives";

function formatDate(value: Date | string | null): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// The customer list with "Mark reviewed" and "Resend". Behavior is unchanged
// from the original dashboard.
export function CustomerTable({
  customers,
  onToggleReviewed,
}: {
  customers: CustomerRow[];
  onToggleReviewed: () => void;
}) {
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);

  async function toggle(customerId: string) {
    await markCustomerReviewed({ data: { customerId } });
    onToggleReviewed();
  }

  async function resend(customerId: string) {
    setResendingId(customerId);
    setResendMessage(null);
    try {
      const result = await resendReviewRequest({ data: { customerId } });
      if (result.ok) {
        const parts: string[] = [];
        if (result.smsSent === true) parts.push("text sent");
        if (result.smsSent === false) parts.push("text failed");
        if (result.emailSent === true) parts.push("email sent");
        if (result.emailSent === false) parts.push("email failed");
        setResendMessage({
          id: customerId,
          text: parts.length > 0 ? parts.join(", ") : "Sent.",
        });
        onToggleReviewed();
      } else {
        setResendMessage({ id: customerId, text: result.message });
      }
    } catch (err) {
      console.error(err);
      setResendMessage({ id: customerId, text: "Something went wrong." });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <DashPanel
      title="Customers"
      hint={customers.length > 0 ? `${customers.length} total` : undefined}
    >
      {customers.length === 0 ? (
        <DashEmpty compact title="No customers yet.">
          Add your first one above, or connect Square or Jobber and they will
          appear on their own.
        </DashEmpty>
      ) : (
        <DashTable className="dash-customer-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Added</th>
              <th>Sent</th>
              <th>Clicked</th>
              <th>Reviewed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <div className="dash-cell-strong">{customer.name}</div>
                  <div className="dash-cell-muted">
                    {customer.phone || customer.email}
                  </div>
                </td>
                <td>{formatDate(customer.createdAt)}</td>
                <td>
                  <div className="dash-cell-pills">
                    {customer.smsCount > 0 && (
                      <DashPill>SMS ×{customer.smsCount}</DashPill>
                    )}
                    {customer.emailCount > 0 && (
                      <DashPill>Email ×{customer.emailCount}</DashPill>
                    )}
                    {customer.smsCount === 0 && customer.emailCount === 0 && (
                      <span className="dash-cell-muted">None yet</span>
                    )}
                  </div>
                </td>
                <td>
                  {customer.linkClickedAt ? (
                    <DashPill tone="ok">
                      Clicked {formatDate(customer.linkClickedAt)}
                    </DashPill>
                  ) : (
                    <DashPill>Not yet</DashPill>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className={cx(
                      "dash-chip-btn",
                      customer.markedReviewedAt && "is-active",
                    )}
                    onClick={() => void toggle(customer.id)}
                  >
                    {customer.markedReviewedAt ? "Reviewed ✓" : "Mark reviewed"}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="dash-chip-btn"
                    onClick={() => void resend(customer.id)}
                    disabled={resendingId === customer.id}
                  >
                    {resendingId === customer.id ? "Sending..." : "Resend"}
                  </button>
                  {resendMessage && resendMessage.id === customer.id && (
                    <div className="dash-resend-message">
                      {resendMessage.text}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DashTable>
      )}
    </DashPanel>
  );
}
