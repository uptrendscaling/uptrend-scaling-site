// Admin-only: move a website order along (ordered, building, live) and record
// the site's address. Shown to the customer in their dashboard.

import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, isDbConfigured } from "./db/client";
import { businesses } from "./db/schema";
import { requireAdminBusiness } from "./reviews.server";

export type WebsiteUpdateResult =
  { ok: true } | { ok: false; message: string };

export const updateWebsiteOrder = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        businessId: z.string().uuid(),
        status: z.enum(["ordered", "building", "live"]),
        websiteUrl: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<WebsiteUpdateResult> => {
    if (!isDbConfigured()) return { ok: false, message: "Not configured yet." };
    try {
      await requireAdminBusiness();
    } catch {
      return { ok: false, message: "Not authorized." };
    }
    try {
      const result = await getDb()
        .update(businesses)
        .set({
          websiteStatus: data.status,
          ...(data.websiteUrl !== undefined
            ? { websiteUrl: data.websiteUrl || null }
            : {}),
        })
        .where(eq(businesses.id, data.businessId))
        .returning({ id: businesses.id });
      if (result.length === 0) return { ok: false, message: "Business not found." };
      return { ok: true };
    } catch (error) {
      console.error("[website-admin] could not update the website order", error);
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  });
