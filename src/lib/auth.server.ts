// Aliased on import: TanStack's `useSession` is a plain async function, not
// a React hook, but eslint-plugin-react-hooks flags any `useXxx` name called
// outside a component. Renaming it here sidesteps that false positive.
import { getSession, useSession as getSessionManager } from "@tanstack/react-start/server";
import bcrypt from "bcryptjs";
import type { SessionConfig } from "@tanstack/react-start/server";

type SessionData = { businessId: string };

export function isAuthConfigured(): boolean {
  const secret = process.env["SESSION_SECRET"];
  return Boolean(secret && secret.length >= 32);
}

function sessionConfig(): SessionConfig {
  const secret = process.env["SESSION_SECRET"];
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is not set (needs to be at least 32 characters). Call isAuthConfigured() first.",
    );
  }
  return {
    password: secret,
    name: "uptrend_session",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    cookie: { secure: true, httpOnly: true, sameSite: "lax", path: "/" },
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Logs a business in by writing their id into the encrypted session cookie.
export async function createBusinessSession(businessId: string): Promise<void> {
  const session = await getSessionManager<SessionData>(sessionConfig());
  await session.update({ businessId });
}

// Returns the logged-in business's id, or null if there is no valid session
// (including when auth isn't configured yet, e.g. SESSION_SECRET missing).
export async function getSessionBusinessId(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const session = await getSession<SessionData>(sessionConfig());
  return session.data.businessId ?? null;
}

export async function clearBusinessSession(): Promise<void> {
  if (!isAuthConfigured()) return;
  const session = await getSessionManager<SessionData>(sessionConfig());
  await session.clear();
}
