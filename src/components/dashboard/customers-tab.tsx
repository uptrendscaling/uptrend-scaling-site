import type { CustomerRow } from "../../lib/reviews.server";
import { AddCustomerPanel } from "./add-customer-panel";
import { CustomerTable } from "./customer-table";
import { DashPageHead } from "./primitives";

// Customers tab. Wraps the original add-customer form and customer list
// unchanged. `customers` comes from the /app loader and `onChanged` re-runs
// it after an add, a resend or a "mark reviewed".
export function CustomersTab({
  customers,
  onChanged,
}: {
  customers: CustomerRow[];
  onChanged: () => void;
}) {
  return (
    <div className="dash-stack">
      <DashPageHead
        title="Customers"
        description="Everyone we have asked for a review, and what happened next."
      />
      <AddCustomerPanel onAdded={onChanged} />
      <CustomerTable customers={customers} onToggleReviewed={onChanged} />
    </div>
  );
}
