import { useCallback, useEffect, useState } from "react";

import { WEBSITE_OPTIONS } from "../../lib/pricing";
import {
  getMySiteState,
  type MySiteState,
} from "../../lib/site-gen/sites.server";
import { SiteStatus } from "../site-status";
import { cx } from "./format";
import { DashPanel, DashPill, DashText } from "./primitives";
import type { DashboardShell } from "./types";

type Business = DashboardShell["business"];

const STEPS = [
  {
    id: "ordered",
    label: "Ordered",
    detail: "We have your order and are getting started.",
  },
  {
    id: "building",
    label: "Building",
    detail: "We are designing and building your site.",
  },
  { id: "live", label: "Live", detail: "Your site is published." },
] as const;

// The build progress and web-address step, for orders that include a new site.
// Styled by ../../site-details.css, loaded by the dashboard route.
function SiteBuildSection() {
  const [state, setState] = useState<MySiteState | null>(null);
  const load = useCallback(() => {
    getMySiteState({ data: {} })
      .then(setState)
      .catch(() => setState(null));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!state || !state.ok) return null;
  return (
    <div className="sd" style={{ padding: 0, maxWidth: "none" }}>
      <SiteStatus
        state={state}
        auth={{}}
        detailsHref="/site-details"
        onChanged={load}
      />
    </div>
  );
}

// "Your website" on the dashboard: which option they bought, how far along the
// build is, and whether maintenance is running. Colby moves the status along in
// the admin Websites view.
export function WebsitePanel({ business }: { business: Business }) {
  const option = WEBSITE_OPTIONS.find((o) => o.id === business.websitePlan);
  if (!option) return null;

  const buildsNewSite = option.buildCents > 0;
  const status = business.websiteStatus ?? (buildsNewSite ? "ordered" : "live");
  const activeIndex = STEPS.findIndex((s) => s.id === status);
  const active = STEPS[activeIndex] ?? STEPS[0];

  return (
    <DashPanel
      title="Your website"
      hint={option.name}
      actions={
        business.maintenanceActive ? (
          <DashPill tone="ok">Maintenance on</DashPill>
        ) : option.monthlyCents > 0 ? (
          <DashPill tone="muted">Maintenance ended</DashPill>
        ) : null
      }
    >
      {buildsNewSite ? (
        <ol className="web-steps" aria-label="Website progress">
          {STEPS.map((step, index) => (
            <li
              key={step.id}
              className={cx(
                "web-step",
                index < activeIndex && "is-done",
                index === activeIndex && "is-current",
              )}
            >
              <span className="web-step-dot" aria-hidden="true">
                {index < activeIndex ? "✓" : index + 1}
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : null}
      <DashText>
        {buildsNewSite
          ? active.detail
          : "We host and look after your site for you."}{" "}
        {status === "live" && business.websiteUrl ? (
          <>
            See it at{" "}
            <a
              href={
                /^https?:\/\//i.test(business.websiteUrl)
                  ? business.websiteUrl
                  : `https://${business.websiteUrl}`
              }
              target="_blank"
              rel="noreferrer"
            >
              {business.websiteUrl}
            </a>
            .
          </>
        ) : null}
      </DashText>
      {buildsNewSite ? <SiteBuildSection /> : null}
      <DashText>
        {business.maintenanceActive
          ? "Need a change to your site? Reply to any email from us or write to hello@uptrendscaling.com and we will handle it."
          : "Questions about your site? Write to hello@uptrendscaling.com."}
      </DashText>
    </DashPanel>
  );
}
