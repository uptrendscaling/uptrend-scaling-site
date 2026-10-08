import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRequestsLog } from "../../lib/dashboard-tabs.server";
import { cx, dashButtonClass } from "./format";
import { IconAlert, IconMail } from "./icons";
import {
  DashAlert,
  DashButton,
  DashEmpty,
  DashPageHead,
  DashPanel,
  DashPill,
  DashTable,
} from "./primitives";
import { IconChat } from "./tabs-icons";
import { fullStamp, shortStamp, whenLabel } from "./tabs-format";
import type {
  AttentionItem,
  RequestChannel,
  RequestKind,
  RequestLogRow,
  RequestSource,
  RequestStatus,
  RequestsLogInput,
} from "./tabs-types";
import type { DashboardTabProps } from "./types";
import { useNow } from "./use-now";

const CHANNEL_LABEL: Record<RequestChannel, string> = {
  sms: "Text",
  email: "Email",
};
const KIND_LABEL: Record<RequestKind, string> = {
  initial: "Request",
  reminder: "Reminder",
  manual: "Resent by you",
};
const SOURCE_LABEL: Record<RequestSource, string> = {
  square: "Square",
  quickbooks: "QuickBooks",
  jobber: "Jobber",
  zapier: "Zapier",
  manual: "Added by you",
};

type Filters = {
  channel: "all" | RequestChannel;
  status: "all" | RequestStatus;
  kind: "all" | RequestKind;
};
const NO_FILTERS: Filters = { channel: "all", status: "all", kind: "all" };

function toInput(filters: Filters, cursor?: string): RequestsLogInput {
  const input: RequestsLogInput = {};
  if (filters.channel !== "all") input.channel = filters.channel;
  if (filters.status !== "all") input.status = filters.status;
  if (filters.kind !== "all") input.kind = filters.kind;
  if (cursor) input.cursor = cursor;
  return input;
}

const LOAD_ERROR =
  "We couldn't load your requests just now. Please refresh and try again.";

// ----------------------------------------------------------------- filters

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="dash-filter-group" role="group" aria-label={label}>
      <span className="dash-filter-label">{label}</span>
      <div className="dash-filter-chips">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cx(
              "dash-chip-btn",
              option.value === value && "is-active",
            )}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  return (
    <div className="dash-filters">
      <FilterGroup
        label="Channel"
        value={filters.channel}
        onChange={(channel) => onChange({ ...filters, channel })}
        options={[
          { value: "all", label: "All" },
          { value: "sms", label: "Texts" },
          { value: "email", label: "Emails" },
        ]}
      />
      <FilterGroup
        label="Result"
        value={filters.status}
        onChange={(status) => onChange({ ...filters, status })}
        options={[
          { value: "all", label: "All" },
          { value: "sent", label: "Sent" },
          { value: "failed", label: "Failed" },
        ]}
      />
      <FilterGroup
        label="Type"
        value={filters.kind}
        onChange={(kind) => onChange({ ...filters, kind })}
        options={[
          { value: "all", label: "All" },
          { value: "initial", label: "Requests" },
          { value: "reminder", label: "Reminders" },
          { value: "manual", label: "Resent" },
        ]}
      />
    </div>
  );
}

// --------------------------------------------------------- needs attention

function AttentionRow({
  item,
  nowMs,
  timeZone,
}: {
  item: AttentionItem;
  nowMs: number;
  timeZone: string;
}) {
  return (
    <li className="dash-attn-row">
      <span className="dash-attn-icon">
        <IconAlert size={15} />
      </span>
      <div className="dash-attn-body">
        <div className="dash-attn-top">
          <strong>{item.customer ?? "A paid invoice"}</strong>
          <DashPill>{item.provider}</DashPill>
          <time
            dateTime={item.at}
            title={fullStamp(item.at, timeZone)}
            className="dash-attn-time"
          >
            {whenLabel(item.at, nowMs, timeZone)}
          </time>
        </div>
        <p className="dash-attn-what">{item.headline}</p>
        {item.detail ? <p className="dash-attn-detail">{item.detail}</p> : null}
        <p className="dash-attn-fix">{item.fix}</p>
      </div>
      {item.action === "settings" ? (
        <Link
          to="/app"
          search={{ tab: "settings" }}
          className={dashButtonClass("ghost", "sm", "dash-attn-action")}
        >
          Open Settings
        </Link>
      ) : item.action === "customers" ? (
        <Link
          to="/app"
          search={{ tab: "customers" }}
          className={dashButtonClass("ghost", "sm", "dash-attn-action")}
        >
          Open Customers
        </Link>
      ) : null}
    </li>
  );
}

// How many problems show before the "Show more" button. Three is enough to
// see what is wrong without pushing the message log far down the page.
const ATTENTION_PREVIEW = 3;

function AttentionPanel({
  items,
  more,
  nowMs,
  timeZone,
}: {
  items: AttentionItem[];
  more: number;
  nowMs: number;
  timeZone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, ATTENTION_PREVIEW);
  const hidden = items.length - ATTENTION_PREVIEW;
  return (
    <DashPanel
      title="Needs attention"
      hint="Paid invoices we could not send a request for. They drop off after 30 days."
      className="dash-attn"
    >
      <ul className="dash-attn-list">
        {visible.map((item) => (
          <AttentionRow
            key={item.id}
            item={item}
            nowMs={nowMs}
            timeZone={timeZone}
          />
        ))}
      </ul>
      {hidden > 0 || more > 0 ? (
        <div className="dash-attn-foot">
          {hidden > 0 ? (
            <DashButton
              size="sm"
              variant="quiet"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? "Show fewer" : `Show ${hidden} more`}
            </DashButton>
          ) : null}
          {more > 0 ? (
            <span>Plus {more} more from the last 30 days.</span>
          ) : null}
        </div>
      ) : null}
    </DashPanel>
  );
}

// --------------------------------------------------------------- the table

function ResultCell({ row }: { row: RequestLogRow }) {
  if (row.status === "sent") {
    return (
      <td className="dash-req-result">
        <DashPill tone="ok">Sent</DashPill>
      </td>
    );
  }
  return (
    <td className="dash-req-result">
      <DashPill tone="warn" className="dash-pill-failed">
        Failed
      </DashPill>
      {row.problem ? <p className="dash-req-problem">{row.problem}</p> : null}
      {row.providerText && row.providerText !== row.problem ? (
        <p className="dash-req-provider" title={row.providerText}>
          {row.providerText}
        </p>
      ) : null}
    </td>
  );
}

function LogRow({
  row,
  nowMs,
  timeZone,
}: {
  row: RequestLogRow;
  nowMs: number;
  timeZone: string;
}) {
  const channel = CHANNEL_LABEL[row.channel];
  const kind = KIND_LABEL[row.kind];
  const source = SOURCE_LABEL[row.source];
  return (
    <tr className={cx(row.status === "failed" && "is-failed")}>
      <td className="dash-req-when">
        <time dateTime={row.sentAt} title={fullStamp(row.sentAt, timeZone)}>
          {whenLabel(row.sentAt, nowMs, timeZone)}
        </time>
        <span className="dash-cell-muted">
          {shortStamp(row.sentAt, timeZone)}
        </span>
      </td>
      <td className="dash-req-customer">
        <div className="dash-cell-strong">{row.customerName}</div>
        <div className="dash-cell-muted">
          {row.contact ??
            `No ${row.channel === "sms" ? "number" : "email"} on file`}
        </div>
      </td>
      <td className="dash-req-col">
        <span className="dash-req-channel">
          {row.channel === "sms" ? (
            <IconChat size={14} />
          ) : (
            <IconMail size={14} />
          )}
          {channel}
        </span>
      </td>
      <td className="dash-req-col">{kind}</td>
      <td className="dash-req-col dash-cell-muted">{source}</td>
      <td className="dash-req-meta">
        <span className="dash-req-channel">
          {row.channel === "sms" ? (
            <IconChat size={13} />
          ) : (
            <IconMail size={13} />
          )}
          {channel}
        </span>
        <span aria-hidden="true">·</span>
        <span>{kind}</span>
        <span aria-hidden="true">·</span>
        <span>{source}</span>
      </td>
      <ResultCell row={row} />
    </tr>
  );
}

function SkeletonRows() {
  return (
    <div className="dash-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="dash-skel-row">
          <span className="dash-skel" style={{ width: "14%" }} />
          <span className="dash-skel" style={{ width: "26%" }} />
          <span className="dash-skel" style={{ width: "12%" }} />
          <span className="dash-skel" style={{ width: "10%" }} />
        </div>
      ))}
    </div>
  );
}

type LogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      rows: RequestLogRow[];
      nextCursor: string | null;
      total: number;
    };

// The Requests tab: every text and email sent for this business, newest
// first, with filters and a "Load more" button. Above it, a short list of
// paid invoices we could not send a request for and what to do about each.
export function RequestsTab({ shell }: DashboardTabProps) {
  const nowMs = useNow(shell.generatedAt);
  const timeZone = shell.timezone;

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [log, setLog] = useState<LogState>({ status: "loading" });
  const [attention, setAttention] = useState<{
    items: AttentionItem[];
    more: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Answers that arrive after the filters changed again are thrown away.
  const latest = useRef(0);

  const loadFirstPage = useCallback(async (next: Filters) => {
    const ticket = ++latest.current;
    setRefreshing(true);
    setMoreError(null);
    try {
      const result = await getRequestsLog({ data: toInput(next) });
      if (ticket !== latest.current) return;
      if (!result.ok) {
        setLog({ status: "error", message: result.message });
        return;
      }
      setLog({
        status: "ready",
        rows: result.rows,
        nextCursor: result.nextCursor,
        total: result.total ?? result.rows.length,
      });
      if (result.attention) setAttention(result.attention);
    } catch (error) {
      console.error(error);
      if (ticket === latest.current) {
        setLog({ status: "error", message: LOAD_ERROR });
      }
    } finally {
      if (ticket === latest.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFirstPage(filters);
  }, [filters, loadFirstPage]);

  async function loadMore() {
    if (log.status !== "ready" || !log.nextCursor || loadingMore) return;
    const ticket = latest.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const result = await getRequestsLog({
        data: toInput(filters, log.nextCursor),
      });
      if (ticket !== latest.current) return;
      if (!result.ok) {
        setMoreError(result.message);
        return;
      }
      setLog((previous) => {
        if (previous.status !== "ready") return previous;
        const have = new Set(previous.rows.map((row) => row.id));
        return {
          ...previous,
          rows: [
            ...previous.rows,
            ...result.rows.filter((row) => !have.has(row.id)),
          ],
          nextCursor: result.nextCursor,
        };
      });
    } catch (error) {
      console.error(error);
      setMoreError(LOAD_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered =
    filters.channel !== "all" ||
    filters.status !== "all" ||
    filters.kind !== "all";
  const noMessagesAtAll =
    log.status === "ready" && log.total === 0 && !filtered;

  return (
    <div className="dash-stack">
      <DashPageHead
        title="Requests"
        description="Every text and email we send for you, and whether it went through."
      />

      {attention ? (
        <AttentionPanel
          items={attention.items}
          more={attention.more}
          nowMs={nowMs}
          timeZone={timeZone}
        />
      ) : null}

      <DashPanel
        title="Message log"
        hint={
          log.status === "ready" && log.total > 0
            ? `${log.total.toLocaleString("en-US")} ${log.total === 1 ? "message" : "messages"}${filtered ? " match" : ""}`
            : undefined
        }
      >
        {noMessagesAtAll ? null : (
          <FilterBar filters={filters} onChange={setFilters} />
        )}

        {log.status === "loading" ? <SkeletonRows /> : null}

        {log.status === "error" ? (
          <>
            <DashAlert tone="error">{log.message}</DashAlert>
            <DashButton
              size="sm"
              onClick={() => {
                setLog({ status: "loading" });
                void loadFirstPage(filters);
              }}
            >
              Try again
            </DashButton>
          </>
        ) : null}

        {log.status === "ready" && log.rows.length === 0 ? (
          noMessagesAtAll ? (
            <DashEmpty
              icon={<IconMail size={18} />}
              title="No requests yet."
              action={
                <Link
                  to="/app"
                  search={{ tab: "customers" }}
                  className={dashButtonClass("primary")}
                >
                  Add a customer
                </Link>
              }
            >
              When a customer pays an invoice in Square or Jobber, or you add
              one on the Customers tab, their text or email shows up here.
            </DashEmpty>
          ) : (
            <DashEmpty
              compact
              title="Nothing matches those filters."
              action={
                <DashButton size="sm" onClick={() => setFilters(NO_FILTERS)}>
                  Show everything
                </DashButton>
              }
            >
              Try a different mix, or clear the filters to see every message.
            </DashEmpty>
          )
        ) : null}

        {log.status === "ready" && log.rows.length > 0 ? (
          <div className={cx("dash-req-wrap", refreshing && "is-refreshing")}>
            <DashTable className="dash-req-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Channel</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {log.rows.map((row) => (
                  <LogRow
                    key={row.id}
                    row={row}
                    nowMs={nowMs}
                    timeZone={timeZone}
                  />
                ))}
              </tbody>
            </DashTable>

            <div className="dash-req-foot">
              <span className="dash-cell-muted">
                Showing {log.rows.length.toLocaleString("en-US")} of{" "}
                {log.total.toLocaleString("en-US")}
              </span>
              {log.nextCursor ? (
                <DashButton
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </DashButton>
              ) : null}
            </div>
            {moreError ? <DashAlert tone="error">{moreError}</DashAlert> : null}
          </div>
        ) : null}
      </DashPanel>
    </div>
  );
}
