// Demo accounts for affiliate partners. A partner gets a real login to a real
// dashboard, filled with sample customers and review activity, so they can
// show UpTrend to the businesses they refer. Nothing is ever texted or emailed
// from a demo account: sendReviewRequestAndLog() checks businesses.isDemo and
// only logs the request (each real text or email costs us money). There is no
// Stripe customer or subscription, so no billing either.
//
// Created automatically when Colby approves an affiliate, or from the
// "Create demo" button on the Affiliates tab for partners approved earlier.

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { createPasswordResetToken } from "./auth.server";
import { getDb } from "./db/client";
import { businesses, customers, messages } from "./db/schema";
import { CANONICAL_SITE_URL } from "./site";

const DEMO_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DAY_MS = 24 * 60 * 60 * 1000;

// Made-up people. Phone numbers are 555-0100 to 555-0199, the range reserved
// for fiction, and emails use example.com, so none can reach a real person
// (and demo accounts never send anyway).
const SAMPLE_CUSTOMERS: Array<{
  name: string;
  daysAgo: number;
  clicked: boolean;
  reviewed: boolean;
  reminded: boolean;
}> = [
  {
    name: "Maria Lopez",
    daysAgo: 1,
    clicked: true,
    reviewed: true,
    reminded: false,
  },
  {
    name: "James Carter",
    daysAgo: 1,
    clicked: false,
    reviewed: false,
    reminded: false,
  },
  {
    name: "Aisha Brown",
    daysAgo: 2,
    clicked: true,
    reviewed: true,
    reminded: false,
  },
  {
    name: "Tom Nguyen",
    daysAgo: 3,
    clicked: true,
    reviewed: false,
    reminded: false,
  },
  {
    name: "Rachel Kim",
    daysAgo: 4,
    clicked: true,
    reviewed: true,
    reminded: true,
  },
  {
    name: "Daniel Ortiz",
    daysAgo: 5,
    clicked: false,
    reviewed: false,
    reminded: true,
  },
  {
    name: "Emily Davis",
    daysAgo: 6,
    clicked: true,
    reviewed: true,
    reminded: false,
  },
  {
    name: "Chris Walker",
    daysAgo: 8,
    clicked: true,
    reviewed: true,
    reminded: true,
  },
  {
    name: "Priya Shah",
    daysAgo: 9,
    clicked: false,
    reviewed: false,
    reminded: true,
  },
  {
    name: "Mike Johnson",
    daysAgo: 11,
    clicked: true,
    reviewed: true,
    reminded: false,
  },
  {
    name: "Sarah Mitchell",
    daysAgo: 13,
    clicked: true,
    reviewed: true,
    reminded: true,
  },
  {
    name: "Kevin Reyes",
    daysAgo: 15,
    clicked: true,
    reviewed: false,
    reminded: true,
  },
  {
    name: "Laura Chen",
    daysAgo: 18,
    clicked: true,
    reviewed: true,
    reminded: false,
  },
  {
    name: "Brian Foster",
    daysAgo: 20,
    clicked: true,
    reviewed: true,
    reminded: true,
  },
];

export type DemoAccountResult =
  | { ok: true; businessId: string; setupUrl: string; created: boolean }
  | { ok: false; message: string };

// A one-time "set your password" link for the demo login (valid 7 days).
export function demoSetupUrlFor(businessId: string): string {
  const token = createPasswordResetToken(businessId, DEMO_LINK_TTL_MS);
  return `${CANONICAL_SITE_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

// Creates (or finds) the demo account for a partner. The login email is the
// partner's own email, so it fails if a real customer account already uses
// that address.
export async function ensureDemoAccount(partner: {
  name: string;
  email: string;
}): Promise<DemoAccountResult> {
  const db = getDb();
  const email = partner.email.trim().toLowerCase();

  const [existing] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.email, email))
    .limit(1);
  if (existing) {
    if (!existing.isDemo) {
      return {
        ok: false,
        message:
          "That email already belongs to a real customer account, so no demo was created.",
      };
    }
    return {
      ok: true,
      businessId: existing.id,
      setupUrl: demoSetupUrlFor(existing.id),
      created: false,
    };
  }

  const now = Date.now();
  const [business] = await db
    .insert(businesses)
    .values({
      businessName: "Sunrise Plumbing & Air (demo)",
      contactName: partner.name.trim() || "Partner",
      email,
      phone: "(602) 555-0100",
      locations: 1,
      plan: "membership",
      tier: "growth",
      googleReviewUrl: `${CANONICAL_SITE_URL}/?demo=review`,
      isDemo: true,
      weeklySummaryEnabled: false,
    })
    .returning({ id: businesses.id });
  if (!business) return { ok: false, message: "Could not create the demo." };

  for (const [index, sample] of SAMPLE_CUSTOMERS.entries()) {
    const sentAt = new Date(
      now - sample.daysAgo * DAY_MS - index * 37 * 60_000,
    );
    const [customer] = await db
      .insert(customers)
      .values({
        businessId: business.id,
        name: sample.name,
        phone: `+1602555${String(100 + index).padStart(4, "0")}`,
        email: `${sample.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        reviewToken: randomUUID(),
        reminderSentAt: sample.reminded
          ? new Date(sentAt.getTime() + 2 * DAY_MS)
          : null,
        linkClickedAt: sample.clicked
          ? new Date(sentAt.getTime() + (sample.reminded ? 2.2 : 0.1) * DAY_MS)
          : null,
        markedReviewedAt: sample.reviewed
          ? new Date(sentAt.getTime() + (sample.reminded ? 2.3 : 0.2) * DAY_MS)
          : null,
        createdAt: sentAt,
      })
      .returning({ id: customers.id });
    if (!customer) continue;

    const rows: Array<typeof messages.$inferInsert> = [];
    for (const channel of ["sms", "email"] as const) {
      rows.push({
        businessId: business.id,
        customerId: customer.id,
        channel,
        kind: "initial",
        status: "sent",
        providerMessageId: "demo",
        sentAt,
      });
      if (sample.reminded) {
        rows.push({
          businessId: business.id,
          customerId: customer.id,
          channel,
          kind: "reminder",
          status: "sent",
          providerMessageId: "demo",
          sentAt: new Date(sentAt.getTime() + 2 * DAY_MS),
        });
      }
    }
    await db.insert(messages).values(rows);
  }

  return {
    ok: true,
    businessId: business.id,
    setupUrl: demoSetupUrlFor(business.id),
    created: true,
  };
}

// The demo business for a partner's email, if one exists.
export async function findDemoAccount(email: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.email, email.trim().toLowerCase()),
        eq(businesses.isDemo, true),
      ),
    )
    .limit(1);
  return row ?? null;
}
