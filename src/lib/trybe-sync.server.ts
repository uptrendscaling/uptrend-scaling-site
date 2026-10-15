// Keeps the admin Trybe tab current without anyone lifting a finger.
//
// Trybe (jointrybe.com) has a read-only Brand API. Once an hour or so (see
// vercel.json) this asks it for the creators who are active on our brand and
// copies them into the trybe_creators table the Trybe tab reads: new creators
// get a row, existing ones get fresh join date, sales and earnings, and a
// creator who has left Trybe is marked INACTIVE.
//
// It stays dormant until TRYBE_API_KEY is set in Vercel. It never throws to
// the caller, never deletes rows, and never touches the fields the daily
// growth routine owns (demo email, demo dashboard, chat notes).

import { timingSafeEqual } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeader,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "./db/client";

const TRYBE_API_BASE = "https://api.jointrybe.com/v1";
const MAX_PAGES = 20;

export function isTrybeApiConfigured(): boolean {
  return Boolean(process.env["TRYBE_API_KEY"]);
}

type TrybePerformanceRow = {
  creator: { id: string; name: string; joined_at: string | null };
  performance?: {
    earnings_cents?: number | null;
    trybe_gmv_cents?: number | null;
    new_submissions?: number | null;
  };
};

type TrybePage = {
  data: TrybePerformanceRow[];
  has_more: boolean;
  next_cursor: string | null;
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function trybeGet(path: string, attempt = 0): Promise<TrybePage> {
  const response = await fetch(`${TRYBE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env["TRYBE_API_KEY"]}` },
  });
  if (response.status === 429 && attempt < 2) {
    const wait = Math.min(Number(response.headers.get("retry-after") ?? 2), 10);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return trybeGet(path, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Trybe API answered ${response.status}`);
  }
  return (await response.json()) as TrybePage;
}

// Every active creator with their last-year performance. The API caps a
// request at 365 days, so we ask for the most recent 364 (this program is far
// younger than that, so it covers everything).
async function fetchRoster(): Promise<TrybePerformanceRow[]> {
  const end = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 363 * 24 * 60 * 60 * 1000);
  const rows: TrybePerformanceRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      start_date: isoDay(start),
      end_date: isoDay(end),
      limit: "100",
    });
    if (cursor) query.set("after", cursor);
    const result: TrybePage = await trybeGet(`/creator-performance?${query}`);
    rows.push(...result.data);
    if (!result.has_more || !result.next_cursor) return rows;
    cursor = result.next_cursor;
  }
  // More pages than we are willing to read: treat as incomplete.
  throw new Error("Trybe roster has more pages than expected");
}

type ExistingRow = {
  id: number | string;
  creator_name: string;
  trybe_creator_id: string | null;
  status: string;
  stats_synced_at: string | null;
};

export type TrybeSyncSummary =
  | {
      ok: true;
      seen: number;
      added: string[];
      updated: number;
      markedLeft: string[];
    }
  | { ok: false; reason: string };

export async function syncTrybeRoster(): Promise<TrybeSyncSummary> {
  if (!isTrybeApiConfigured()) return { ok: false, reason: "dormant" };
  if (!isDbConfigured()) return { ok: false, reason: "no_database" };
  try {
    const roster = await fetchRoster();
    const db = getDb();

    // trybe_creator_id is added once, here, so a fresh database needs no
    // separate migration step.
    await db.execute(
      sql`alter table trybe_creators add column if not exists trybe_creator_id text`,
    );

    const existingResult = await db.execute(
      sql`select id, creator_name, trybe_creator_id, status, stats_synced_at from trybe_creators`,
    );
    const existing = existingResult.rows as ExistingRow[];

    const added: string[] = [];
    let updated = 0;
    const seenRowIds = new Set<number>();

    for (const item of roster) {
      const trybeId = item.creator.id;
      const name = (item.creator.name ?? "").trim();
      if (!trybeId || !name) continue;
      const joinedAt = item.creator.joined_at;
      const earnings = Math.max(0, Math.round(item.performance?.earnings_cents ?? 0));
      const sales = Math.max(0, Math.round(item.performance?.trybe_gmv_cents ?? 0));
      const submissions = Math.max(0, Math.round(item.performance?.new_submissions ?? 0));

      const match =
        existing.find((row) => row.trybe_creator_id === trybeId) ??
        existing.find(
          (row) =>
            !row.trybe_creator_id &&
            row.creator_name.trim().toLowerCase() === name.toLowerCase(),
        );

      if (match) {
        seenRowIds.add(Number(match.id));
        await db.execute(sql`
          update trybe_creators set
            trybe_creator_id = ${trybeId},
            joined_on = coalesce(
              (${joinedAt}::timestamptz at time zone 'America/Phoenix')::date,
              joined_on
            ),
            submissions = ${submissions},
            sales_cents = ${sales},
            earnings_cents = ${earnings},
            stats_synced_at = now(),
            updated_at = now()
          where id = ${Number(match.id)}
        `);
        updated += 1;
      } else {
        const inserted = await db.execute(sql`
          insert into trybe_creators (
            creator_name, trybe_creator_id, status, joined_on, first_seen_on,
            submissions, sales_cents, earnings_cents, stats_synced_at,
            notes, updated_at
          ) values (
            ${name}, ${trybeId}, 'DEMO_EMAIL_ASKED',
            (${joinedAt}::timestamptz at time zone 'America/Phoenix')::date,
            (now() at time zone 'America/Phoenix')::date,
            ${submissions}, ${sales}, ${earnings}, now(),
            'Added automatically from the Trybe roster. Trybe''s welcome message already asked for their demo email.',
            now()
          )
          returning id
        `);
        const newId = Number((inserted.rows[0] as { id: number | string }).id);
        seenRowIds.add(newId);
        added.push(name);
      }
    }

    // Creators who were on the roster before but are not now have left.
    // Skipped when the roster came back empty (an API hiccup should never
    // wipe the table). Pending requests are never touched: only rows we have
    // already seen on the roster once (stats_synced_at set).
    const markedLeft: string[] = [];
    if (roster.length > 0) {
      for (const row of existing) {
        if (seenRowIds.has(Number(row.id))) continue;
        if (!row.stats_synced_at) continue;
        if (row.status !== "DEMO_EMAIL_ASKED" && row.status !== "DEMO_CREATED") {
          continue;
        }
        await db.execute(sql`
          update trybe_creators set
            status = 'INACTIVE',
            notes = coalesce(notes || ' | ', '') ||
              'No longer on the Trybe roster (' ||
              to_char(now() at time zone 'America/Phoenix', 'YYYY-MM-DD') ||
              '). Marked as left automatically.',
            updated_at = now()
          where id = ${Number(row.id)}
        `);
        markedLeft.push(row.creator_name);
      }
    }

    // Keep today's join count honest on the daily log.
    if (added.length > 0) {
      await db.execute(sql`
        insert into trybe_daily_log (day, new_joins, notes)
        values ((now() at time zone 'America/Phoenix')::date, ${added.length}, '')
        on conflict (day) do update set
          new_joins = trybe_daily_log.new_joins + excluded.new_joins,
          updated_at = now()
      `);
    }

    return { ok: true, seen: roster.length, added, updated, markedLeft };
  } catch (error) {
    console.error("[trybe-sync] sync failed", error);
    return { ok: false, reason: "failed" };
  }
}

// -------------------------------------------------------------------- cron

// Vercel signs scheduled requests with CRON_SECRET as a Bearer token.
function isAuthorized(authorizationHeader: string | undefined): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected || !authorizationHeader) return false;
  const given = Buffer.from(authorizationHeader);
  const wanted = Buffer.from(`Bearer ${expected}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export const runTrybeSyncCron = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrybeSyncSummary> => {
    if (!isAuthorized(getRequestHeader("authorization"))) {
      setResponseStatus(401);
      return { ok: false, reason: "unauthorized" };
    }
    const summary = await syncTrybeRoster();
    setResponseStatus(200);
    return summary;
  },
);
