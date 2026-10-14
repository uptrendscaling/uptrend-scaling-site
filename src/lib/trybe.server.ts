// The "Trybe" tab in the admin area. Trybe (jointrybe.com) is the creator
// affiliate platform UpTrend recruits partners on. Those partners earn only
// through Trybe, so they are deliberately kept apart from the site's own
// affiliates table (no referral codes, no stacked commissions).
//
// Two small tables hold everything this tab shows. Both are filled in by the
// daily growth routine (not by this site): trybe_creators has one row per
// Trybe creator, and trybe_daily_log has one row per day of invite activity.
// This file only reads them. It never writes, never calls Trybe, and never
// throws, so a missing table just means an empty tab.

import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "./db/client";
import { requireAdminBusiness } from "./reviews.server";

// Demo accounts for Trybe creators start with this locked placeholder
// password hash (nobody knows the password it came from). Once the creator
// picks their own password the hash changes, which is how this tab tells
// "demo made, waiting on them" apart from "they logged in and set a password".
const PLACEHOLDER_PASSWORD_HASH =
  "$2b$12$EO8CZkg0NV.OUAC.4HFpBefGip2jZysT6l68yEXaiv5q0CcFuwfXS";

export type TrybeDemoState = "none" | "waiting" | "active";

export type TrybeCreatorSummary = {
  id: number;
  name: string;
  handle: string | null;
  status: string;
  demoEmail: string | null;
  demoState: TrybeDemoState;
  joinedOn: string | null;
  submissions: number;
  salesCents: number;
  earningsCents: number;
  lastMessageOn: string | null;
  notes: string | null;
  updatedAt: string | null;
};

export type TrybeDayLog = {
  day: string;
  invitesSent: number;
  creditsLeft: number | null;
  newJoins: number;
  repliesSent: number;
  demosCreated: number;
  notes: string | null;
};

export type TrybeOverview = {
  creators: TrybeCreatorSummary[];
  days: TrybeDayLog[];
  totalInvited: number;
  lastSyncedAt: string | null;
};

export type TrybeOverviewResult =
  { ok: true; overview: TrybeOverview } | { ok: false; message: string };

const EMPTY_OVERVIEW: TrybeOverview = {
  creators: [],
  days: [],
  totalInvited: 0,
  lastSyncedAt: null,
};

type CreatorRow = {
  id: number | string;
  creator_name: string;
  trybe_handle: string | null;
  status: string;
  demo_email: string | null;
  joined_on: string | null;
  submissions: number | string | null;
  sales_cents: number | string | null;
  earnings_cents: number | string | null;
  last_message_on: string | null;
  notes: string | null;
  updated_at: string | null;
  demo_password_hash: string | null;
  has_demo: boolean | null;
};

type DayRow = {
  day: string;
  invites_sent: number | string | null;
  credits_left: number | string | null;
  new_joins: number | string | null;
  replies_sent: number | string | null;
  demos_created: number | string | null;
  notes: string | null;
};

function toInt(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function demoStateOf(row: CreatorRow): TrybeDemoState {
  if (!row.has_demo) return "none";
  return row.demo_password_hash &&
    row.demo_password_hash !== PLACEHOLDER_PASSWORD_HASH
    ? "active"
    : "waiting";
}

export const getTrybeOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrybeOverviewResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      const db = getDb();
      const creatorResult = await db.execute(sql`
        select
          c.id,
          c.creator_name,
          c.trybe_handle,
          c.status,
          c.demo_email,
          to_char(c.joined_on, 'YYYY-MM-DD') as joined_on,
          c.submissions,
          c.sales_cents,
          c.earnings_cents,
          to_char(c.last_message_on, 'YYYY-MM-DD') as last_message_on,
          c.notes,
          to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at,
          b.password_hash as demo_password_hash,
          (b.id is not null) as has_demo
        from trybe_creators c
        left join businesses b on b.id = c.demo_business_id
        order by c.joined_on desc nulls last, c.id desc
      `);
      const dayResult = await db.execute(sql`
        select
          to_char(day, 'YYYY-MM-DD') as day,
          invites_sent,
          credits_left,
          new_joins,
          replies_sent,
          demos_created,
          notes
        from trybe_daily_log
        order by day desc
        limit 30
      `);
      const syncResult = await db.execute(sql`
        select to_char(max(stats_synced_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as synced
        from trybe_creators
      `);
      const totalResult = await db.execute(
        sql`select coalesce(sum(invites_sent), 0) as total from trybe_daily_log`,
      );

      const creators = (creatorResult.rows as CreatorRow[]).map(
        (row): TrybeCreatorSummary => ({
          id: toInt(row.id),
          name: row.creator_name,
          handle: row.trybe_handle,
          status: row.status,
          demoEmail: row.demo_email,
          demoState: demoStateOf(row),
          joinedOn: row.joined_on,
          submissions: toInt(row.submissions),
          salesCents: toInt(row.sales_cents),
          earningsCents: toInt(row.earnings_cents),
          lastMessageOn: row.last_message_on,
          notes: row.notes,
          updatedAt: row.updated_at,
        }),
      );
      const days = (dayResult.rows as DayRow[]).map((row): TrybeDayLog => ({
        day: row.day,
        invitesSent: toInt(row.invites_sent),
        creditsLeft:
          row.credits_left === null || row.credits_left === undefined
            ? null
            : toInt(row.credits_left),
        newJoins: toInt(row.new_joins),
        repliesSent: toInt(row.replies_sent),
        demosCreated: toInt(row.demos_created),
        notes: row.notes,
      }));
      const synced = (
        syncResult.rows[0] as { synced: string | null } | undefined
      )?.synced;
      const total = (
        totalResult.rows[0] as { total: number | string } | undefined
      )?.total;
      return {
        ok: true,
        overview: {
          creators,
          days,
          totalInvited: toInt(total),
          lastSyncedAt: synced ?? null,
        },
      };
    } catch (error) {
      console.error("[trybe] failed to load the Trybe overview", error);
      return { ok: true, overview: EMPTY_OVERVIEW };
    }
  },
);
