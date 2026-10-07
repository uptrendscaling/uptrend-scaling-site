import { useState } from "react";

import { cx, relativeShort } from "./format";
import {
  IconAlert,
  IconCheck,
  IconLink,
  IconMail,
  IconQr,
  IconRefresh,
  IconStar,
} from "./icons";
import { DashEmpty, DashPanel, DashSegmented } from "./primitives";
import type { ActivityIcon, ActivityItem } from "./types";

function ActivityGlyph({ icon }: { icon: ActivityIcon }) {
  switch (icon) {
    case "star":
      return <IconStar size={14} />;
    case "mail":
      return <IconMail size={15} />;
    case "refresh":
      return <IconRefresh size={15} />;
    case "qr":
      return <IconQr size={15} />;
    case "alert":
      return <IconAlert size={15} />;
    case "link":
      return <IconLink size={15} />;
    case "check":
      return <IconCheck size={15} />;
  }
}

// One row of the feed: a small square icon tile, a bold title with a muted
// relative time, and a muted second line. `highlight` is the newest row.
export function DashActivityRow({
  item,
  nowMs,
  highlight,
}: {
  item: ActivityItem;
  nowMs: number;
  highlight?: boolean;
}) {
  return (
    <li
      className={cx(
        "dash-activity-row",
        highlight && "is-new",
        item.warn && "is-warn",
      )}
    >
      <span className="dash-activity-tile">
        <ActivityGlyph icon={item.icon} />
      </span>
      <div className="dash-activity-body">
        <div className="dash-activity-title">
          <strong>{item.title}</strong>
          <time dateTime={item.at}>{relativeShort(item.at, nowMs)}</time>
        </div>
        <div className="dash-activity-detail">{item.detail}</div>
      </div>
    </li>
  );
}

type Filter = "all" | "reviews";

export function DashActivityFeed({
  items,
  nowMs,
}: {
  items: ActivityItem[];
  nowMs: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible =
    filter === "reviews" ? items.filter((i) => i.reviewsOnly) : items;

  return (
    <DashPanel
      title="Live activity"
      className="dash-activity"
      bodyClassName="dash-activity-panel-body"
      actions={
        <DashSegmented<Filter>
          label="Filter activity"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "reviews", label: "Reviews" },
          ]}
        />
      }
    >
      <div className="dash-activity-scroll">
        {visible.length === 0 ? (
          <DashEmpty
            compact
            title={filter === "reviews" ? "No reviews yet." : "Nothing yet."}
          >
            {filter === "reviews"
              ? "New Google reviews and opened review links show up here."
              : "When a customer pays an invoice, the request shows up here."}
          </DashEmpty>
        ) : (
          <ul className="dash-activity-list">
            {visible.map((item, index) => (
              <DashActivityRow
                key={item.id}
                item={item}
                nowMs={nowMs}
                highlight={index === 0}
              />
            ))}
          </ul>
        )}
      </div>
    </DashPanel>
  );
}
