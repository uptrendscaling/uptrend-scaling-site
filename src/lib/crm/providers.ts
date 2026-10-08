// The one list of connectors ("providers"). Safe to import from both server
// and browser code (no server-only imports). Adding a connector starts here:
// the database column enums, the dashboard's labels and the activity log
// filters all read these lists, so they can't drift apart.

// Connectors that hand us customers to message (by webhook or by our own
// API), and so write rows to crm_webhook_events and customers.source.
export const WEBHOOK_PROVIDERS = ["jobber", "square", "zapier"] as const;
export type CrmWebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

// Everything that can have a row in crm_connections. Google only reads the
// business's own rating and reviews; it never sends us customers.
export const CONNECTION_PROVIDERS = [...WEBHOOK_PROVIDERS, "google"] as const;
export type CrmProvider = (typeof CONNECTION_PROVIDERS)[number];

// Where a customer row came from.
export const CUSTOMER_SOURCES = ["manual", ...WEBHOOK_PROVIDERS] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

export const PROVIDER_LABELS: Record<CrmProvider, string> = {
  jobber: "Jobber",
  square: "Square",
  zapier: "Zapier",
  google: "Google Business Profile",
};

// Where an owner adds our app inside Zapier: the private invite link for now.
// Swap in the public listing link once Zapier approves the app. Settings hides
// the button when this is empty.
export const ZAPIER_APP_URL =
  "https://zapier.com/developer/public-invite/247421/096dab63921d064efb32740c9dd851f3/";

// Label for any provider string, including ones written by older code.
export function providerLabel(provider: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

// True for connectors that are triggered by a paid invoice in the business's
// own invoicing tool (as opposed to Zapier, where the business decides what
// the trigger is).
export function isInvoiceProvider(provider: string): boolean {
  return provider === "jobber" || provider === "square";
}
