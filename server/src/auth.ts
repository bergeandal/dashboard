import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";

// Trusted-device gate. A single shared passcode (DECK_PASSCODE) is entered once
// per device; on success the server issues a long-lived signed cookie so the
// device stays "trusted" without re-entering it. Stateless — the token is an
// HMAC over its issue time, verified by recomputation, so it survives restarts
// and needs no session store. Rotating AUTH_SECRET (or the passcode) logs every
// device out. If DECK_PASSCODE is unset, auth is disabled (handy for local dev).
const PASSCODE = process.env.DECK_PASSCODE || "";
const SECRET = process.env.AUTH_SECRET || PASSCODE || "command-deck-dev-secret";
export const authEnabled = !!PASSCODE;

export const COOKIE = "cd_auth";
const MAX_AGE_DAYS = 400;
export const COOKIE_MAX_AGE = MAX_AGE_DAYS * 24 * 3600; // seconds

const sign = (iat: string): string => createHmac("sha256", SECRET).update(`v1.${iat}`).digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function issueToken(): string {
  const iat = Date.now().toString(36);
  return `v1.${iat}.${sign(iat)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const [, iat, sig] = parts;
  if (!safeEqual(sig, sign(iat))) return false;
  const ageMs = Date.now() - parseInt(iat, 36);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_AGE_DAYS * 24 * 3600 * 1000;
}

export function checkPasscode(input: unknown): boolean {
  if (!authEnabled) return true;
  return typeof input === "string" && safeEqual(input, PASSCODE);
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
