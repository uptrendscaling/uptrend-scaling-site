// Aliased on import: TanStack's `useSession` is a plain async function, not
// a React hook, but eslint-plugin-react-hooks flags any `useXxx` name called
// outside a component. Renaming it here sidesteps that false positive.
import {
  getSession,
  useSession as getSessionManager,
} from "@tanstack/react-start/server";
import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "node:crypto";
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

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
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

// ---- Password reset tokens -------------------------------------------
// Stateless by design (no database table to manage): a reset link is just
// businessId + expiry, HMAC-signed with SESSION_SECRET so it can't be forged
// or tampered with. Anyone holding a valid, unexpired token can set that
// business's password -- exactly what a normal emailed reset link allows.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createPasswordResetToken(businessId: string): string {
  const secret = process.env["SESSION_SECRET"] ?? "";
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
  const payload = `${businessId}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

export function verifyPasswordResetToken(
  token: string,
): { businessId: string } | null {
  const secret = process.env["SESSION_SECRET"] ?? "";
  if (!secret) return null;

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return null;
    const [businessId, expiresAtRaw, signature] = parts as [
      string,
      string,
      string,
    ];

    const expected = createHmac("sha256", secret)
      .update(`${businessId}.${expiresAtRaw}`)
      .digest("hex");
    const signatureBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (signatureBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(signatureBuf, expectedBuf)) return null;

    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

    return { businessId };
  } catch {
    return null;
  }
}

// ---- OAuth `state` tokens (CRM connect flow) --------------------------
// Same stateless HMAC-signing approach as the password reset token above,
// reused rather than inventing a second signing scheme. Protects the OAuth
// callback from CSRF (a state minted for one business/provider can't be
// replayed against another) without needing a database row per attempt.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 min -- long enough for the provider's consent screen

export function createOAuthState(businessId: string, provider: string): string {
  const secret = process.env["SESSION_SECRET"] ?? "";
  const expiresAt = Date.now() + OAUTH_STATE_TTL_MS;
  const payload = `${provider}.${businessId}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${signature}`, "utf8").toString("base64url");
}

export function verifyOAuthState(
  token: string,
  provider: string,
): { businessId: string } | null {
  const secret = process.env["SESSION_SECRET"] ?? "";
  if (!secret) return null;

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 4) return null;
    const [tokenProvider, businessId, expiresAtRaw, signature] = parts as [
      string,
      string,
      string,
      string,
    ];
    if (tokenProvider !== provider) return null;

    const expected = createHmac("sha256", secret)
      .update(`${tokenProvider}.${businessId}.${expiresAtRaw}`)
      .digest("hex");
    const signatureBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (signatureBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(signatureBuf, expectedBuf)) return null;

    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

    return { businessId };
  } catch {
    return null;
  }
}
