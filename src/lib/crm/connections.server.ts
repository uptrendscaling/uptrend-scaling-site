// Provider-agnostic storage/management for a business's connected CRM
// accounts (Jobber, Square, more later). Handles encryption at rest and the
// shared DB operations; provider-specific OAuth/webhook logic lives in
// jobber.server.ts / square.server.ts.
//
// Dormant-safe like the rest of the app: isCrmFrameworkConfigured() folds in
// every prerequisite (db, auth, encryption) so callers only need one check.

import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getSessionBusinessId, isAuthConfigured } from "../auth.server";
import {
  decryptSecret,
  encryptSecret,
  isEncryptionConfigured,
} from "../crypto.server";
import { getDb, isDbConfigured } from "../db/client";
import { crmConnections, type CrmConnection } from "../db/schema";

export type CrmProvider = "jobber" | "square";

export function isCrmFrameworkConfigured(): boolean {
  return isDbConfigured() && isAuthConfigured() && isEncryptionConfigured();
}

export type ConnectionSummary = {
  provider: CrmProvider;
  connectedAt: Date;
  lastErrorMessage: string | null;
};

// GET server fn for the /app loader. Deliberately never returns the
// ciphertext columns to the client.
export const listConnectionsForBusiness = createServerFn({
  method: "GET",
}).handler(async (): Promise<ConnectionSummary[]> => {
  if (!isCrmFrameworkConfigured()) return [];
  const businessId = await getSessionBusinessId();
  if (!businessId) return [];

  const db = getDb();
  const rows = await db
    .select({
      provider: crmConnections.provider,
      connectedAt: crmConnections.connectedAt,
      lastErrorMessage: crmConnections.lastErrorMessage,
    })
    .from(crmConnections)
    .where(eq(crmConnections.businessId, businessId));

  return rows;
});

// The webhook-routing lookup: a provider's webhook carries only its own
// account id, never our businessId.
export async function findConnectionByExternalAccountId(
  provider: CrmProvider,
  externalAccountId: string,
): Promise<CrmConnection | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(crmConnections)
    .where(
      and(
        eq(crmConnections.provider, provider),
        eq(crmConnections.externalAccountId, externalAccountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type SaveConnectionInput = {
  externalAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

// Encrypts and upserts on the (businessId, provider) unique index --
// reconnecting a provider overwrites the existing row rather than creating a
// second one, and clears any prior "needs reconnect" error.
export async function saveConnection(
  businessId: string,
  provider: CrmProvider,
  input: SaveConnectionInput,
): Promise<void> {
  const db = getDb();
  const accessTokenCiphertext = encryptSecret(input.accessToken);
  const refreshTokenCiphertext = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : null;

  await db
    .insert(crmConnections)
    .values({
      businessId,
      provider,
      externalAccountId: input.externalAccountId,
      accessTokenCiphertext,
      refreshTokenCiphertext,
      accessTokenExpiresAt: input.expiresAt,
      scope: input.scope,
    })
    .onConflictDoUpdate({
      target: [crmConnections.businessId, crmConnections.provider],
      set: {
        externalAccountId: input.externalAccountId,
        accessTokenCiphertext,
        refreshTokenCiphertext,
        accessTokenExpiresAt: input.expiresAt,
        scope: input.scope,
        lastErrorMessage: null,
        lastErrorAt: null,
      },
    });
}

export function decryptAccessToken(connection: CrmConnection): string {
  return decryptSecret(connection.accessTokenCiphertext);
}

export function decryptRefreshToken(connection: CrmConnection): string | null {
  return connection.refreshTokenCiphertext
    ? decryptSecret(connection.refreshTokenCiphertext)
    : null;
}

// Used when a lazy token refresh fails (e.g. the business revoked access on
// the provider's side) -- surfaced in the UI as "needs reconnect" rather than
// silently failing every future webhook.
export async function recordConnectionError(
  connectionId: string,
  message: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(crmConnections)
    .set({ lastErrorMessage: message, lastErrorAt: new Date() })
    .where(eq(crmConnections.id, connectionId));
}

// Persists the rotated tokens after a successful refresh. Kept separate from
// saveConnection (which also resets externalAccountId) since a refresh never
// changes which account is connected.
export async function updateConnectionTokens(
  connectionId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(crmConnections)
    .set({
      accessTokenCiphertext: encryptSecret(accessToken),
      refreshTokenCiphertext: refreshToken
        ? encryptSecret(refreshToken)
        : undefined,
      accessTokenExpiresAt: expiresAt,
      lastErrorMessage: null,
      lastErrorAt: null,
    })
    .where(eq(crmConnections.id, connectionId));
}

const disconnectSchema = z.object({ provider: z.enum(["jobber", "square"]) });

export type DisconnectResult = { ok: true } | { ok: false; message: string };

// Deletes the connection row locally regardless of whether a best-effort
// provider-side revoke call succeeds -- a business should never be stuck
// "connected" here just because a revoke request failed on the other end.
export const disconnectConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => disconnectSchema.parse(input))
  .handler(async ({ data }): Promise<DisconnectResult> => {
    if (!isCrmFrameworkConfigured()) {
      return { ok: false, message: "Not configured yet." };
    }
    const businessId = await getSessionBusinessId();
    if (!businessId) return { ok: false, message: "Not signed in." };

    const db = getDb();
    await db
      .delete(crmConnections)
      .where(
        and(
          eq(crmConnections.businessId, businessId),
          eq(crmConnections.provider, data.provider),
        ),
      );
    return { ok: true };
  });
