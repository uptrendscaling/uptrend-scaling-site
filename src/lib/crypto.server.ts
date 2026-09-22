// AES-256-GCM encryption for secrets that must never be stored in plaintext
// -- specifically, OAuth access/refresh tokens for a business's connected
// CRM. Node's built-in crypto, no new dependency. Follows the same
// dormant-until-configured pattern as every other integration in this app:
// callers check isEncryptionConfigured() first and fail soft if it's unset,
// rather than crashing.
//
// ENCRYPTION_KEY is a single point of failure, like SESSION_SECRET -- if it's
// ever lost, every stored token becomes permanently undecryptable. Generate
// it once (`openssl rand -base64 32`) and never rotate it casually.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // standard GCM nonce size

function loadKey(): Buffer | null {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}

export function isEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

// Returns `${iv}.${authTag}.${ciphertext}`, each base64url, joined with ".".
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not set (or isn't a valid 32-byte base64 key). Call isEncryptionConfigured() first.",
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext]
    .map((buf) => buf.toString("base64url"))
    .join(".");
}

export function decryptSecret(payload: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not set (or isn't a valid 32-byte base64 key). Call isEncryptionConfigured() first.",
    );
  }
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted payload.");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
