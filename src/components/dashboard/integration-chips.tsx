import { Link } from "@tanstack/react-router";

import { agoPhrase, cx } from "./format";
import type { IntegrationChip } from "./types";
import { useNow } from "./use-now";

function chipText(chip: IntegrationChip, nowMs: number): string {
  if (chip.since && chip.sincePrefix) {
    return `${chip.sincePrefix} ${agoPhrase(chip.since, nowMs)}`;
  }
  return chip.detail;
}

// The row of small bordered status chips under the top bar: Square, Jobber,
// SMS, Email and Google Business Profile, each with a real status.
export function DashChips({
  chips,
  generatedAt,
}: {
  chips: IntegrationChip[];
  generatedAt: string;
}) {
  const nowMs = useNow(generatedAt);
  if (chips.length === 0) return null;

  return (
    <div className="dash-chips-row">
      <div className="dash-container">
        <ul className="dash-chips" aria-label="Connections">
          {chips.map((chip) => {
            const body = (
              <>
                <i
                  className={cx("dash-chip-dot", `is-${chip.tone}`)}
                  aria-hidden="true"
                />
                <strong>{chip.label}</strong>
                <span>{chipText(chip, nowMs)}</span>
              </>
            );
            return (
              <li key={chip.key}>
                {chip.opensSettings ? (
                  <Link
                    to="/app"
                    search={{ tab: "settings" }}
                    className={cx("dash-chip is-link", `is-${chip.tone}`)}
                  >
                    {body}
                  </Link>
                ) : (
                  <span className={cx("dash-chip", `is-${chip.tone}`)}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
