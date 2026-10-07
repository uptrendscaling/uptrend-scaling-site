import {
  createFileRoute,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

import { AccessPausedPanel } from "../components/dashboard/access-paused";
import { CustomersTab } from "../components/dashboard/customers-tab";
import { DashChips } from "../components/dashboard/integration-chips";
import { OverviewTab } from "../components/dashboard/overview-tab";
import { QrTab } from "../components/dashboard/qr-tab";
import { ReportsTab } from "../components/dashboard/reports-tab";
import { RequestsTab } from "../components/dashboard/requests-tab";
import { SettingsView } from "../components/dashboard/settings-view";
import { DashTopBar } from "../components/dashboard/top-bar";
import {
  DASHBOARD_TABS,
  type DashboardOverview,
  type DashboardShell,
  type DashboardTab,
} from "../components/dashboard/types";
import type { GoogleLocationOption } from "../lib/dashboard-types";
import {
  getDashboardOverview,
  getDashboardShell,
} from "../lib/dashboard.server";
import { listGoogleLocations } from "../lib/google.server";
import { listCustomers, type CustomerRow } from "../lib/reviews.server";

const searchSchema = z.object({
  // Which part of the dashboard to show. Missing or unknown means Overview.
  tab: z.enum(DASHBOARD_TABS).optional().catch(undefined),
  // Set by /connect/{provider}/callback when the OAuth handshake fails.
  crmError: z.enum(["jobber", "square", "google"]).optional().catch(undefined),
});

type DashboardLoaderData = {
  tab: DashboardTab;
  shell: DashboardShell;
  overview: DashboardOverview | null;
  customers: CustomerRow[] | null;
  locations: GoogleLocationOption[] | null;
  locationsError: string | null;
};

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [{ title: "Dashboard | UpTrend Scaling" }],
  }),
  validateSearch: (search: Record<string, unknown>) =>
    searchSchema.parse(search),
  // A failed connection redirects here with ?crmError=...; show Settings so
  // the message and the reconnect button are right in front of the owner.
  loaderDeps: ({ search }): { tab: DashboardTab } => ({
    tab: search.tab ?? (search.crmError ? "settings" : "overview"),
  }),
  loader: async ({ deps }): Promise<DashboardLoaderData> => {
    const tab = deps.tab;
    const empty = {
      tab,
      overview: null,
      customers: null,
      locations: null,
      locationsError: null,
    };

    if (tab === "overview") {
      const result = await getDashboardOverview();
      if (result) {
        return { ...empty, shell: result.shell, overview: result.overview };
      }
    }

    const shell = await getDashboardShell();
    if (!shell) {
      throw redirect({ to: "/login" });
    }
    // Canceled/unpaid subscription (set by the Stripe webhook): show the
    // paused-access panel instead of pulling any customer data.
    if (shell.business.accessRevoked) {
      return { ...empty, shell };
    }

    if (tab === "customers") {
      return { ...empty, shell, customers: await listCustomers() };
    }
    if (tab === "settings" && shell.google.awaitingLocation) {
      const result = await listGoogleLocations();
      return result.ok
        ? { ...empty, shell, locations: result.locations }
        : { ...empty, shell, locationsError: result.message };
    }
    return { ...empty, shell };
  },
  component: Dashboard,
});

function Dashboard() {
  const { tab, shell, overview, customers, locations, locationsError } =
    Route.useLoaderData();
  const { crmError } = Route.useSearch();
  const router = useRouter();
  const isLoading = useRouterState({ select: (state) => state.isLoading });
  const refresh = useCallback(() => {
    void router.invalidate();
  }, [router]);

  const { business } = shell;
  const paused = business.accessRevoked;
  const tabProps = { business, shell, refresh };

  let content;
  if (paused) {
    content = <AccessPausedPanel />;
  } else if (tab === "overview" && overview) {
    content = (
      <OverviewTab shell={shell} overview={overview} refresh={refresh} />
    );
  } else if (tab === "customers") {
    content = <CustomersTab customers={customers ?? []} onChanged={refresh} />;
  } else if (tab === "requests") {
    content = <RequestsTab {...tabProps} />;
  } else if (tab === "qr") {
    content = <QrTab {...tabProps} />;
  } else if (tab === "reports") {
    content = <ReportsTab {...tabProps} />;
  } else if (tab === "settings") {
    content = (
      <SettingsView
        shell={shell}
        crmError={crmError}
        locations={locations}
        locationsError={locationsError}
        refresh={refresh}
      />
    );
  } else {
    content = <AccessPausedPanel />;
  }

  return (
    <div className="dash-root">
      <DashTopBar
        businessName={business.businessName}
        email={business.email}
        isAdmin={business.isAdmin}
        activeTab={tab}
        live={shell.live}
        todoCount={shell.todos.length}
        paused={paused}
      />
      {paused ? null : (
        <DashChips chips={shell.chips} generatedAt={shell.generatedAt} />
      )}
      <main className={isLoading ? "dash-main is-loading" : "dash-main"}>
        <div className="dash-container">{content}</div>
      </main>
    </div>
  );
}
