import "dotenv/config";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Trusted-device gate. A single shared passcode (DECK_PASSCODE) is entered once
// per device; on success the server issues a long-lived signed cookie so the
// device stays "trusted" without re-entering it. Stateless — the token is an
// HMAC over its issue time, verified by recomputation, so it survives restarts
// and needs no session store. Rotating AUTH_SECRET (or the passcode) logs every
// device out. If DECK_PASSCODE is unset, auth is disabled (handy for local dev).
//
// The token also names the profile the device was set up for (its "owner").
// That profile opens without its PIN on this device; any other PIN-protected
// profile needs a short-lived unlock token (see issueUnlock) per visit.
const PASSCODE = process.env.DECK_PASSCODE || "";
const SECRET = process.env.AUTH_SECRET || PASSCODE || "command-deck-dev-secret";
export const authEnabled = !!PASSCODE;

export const COOKIE = "cd_auth";
const MAX_AGE_DAYS = 400;
export const COOKIE_MAX_AGE = MAX_AGE_DAYS * 24 * 3600; // seconds

const hmac = (msg: string): string => createHmac("sha256", SECRET).update(msg).digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

// Profile ids are slugs ([a-z0-9-]), so "." is a safe separator. `epoch` is
// the owner profile's sign-out counter: bumping it (profiles.session_epoch)
// signs out every device that belongs to that profile.
export function issueToken(owner = "", epoch = 0): string {
  const iat = Date.now().toString(36);
  const body = `v3.${iat}.${owner}.${epoch}`;
  return `${body}.${hmac(body)}`;
}

export type Session = { owner: string; epoch: number };

// Returns the session (owner "" = no owning profile) or null if invalid. The
// caller checks `epoch` against the owner profile. v1 tokens predate profile
// ownership (no owner); v2 tokens predate sign-out (epoch 0).
export function verifyToken(token: string | undefined): Session | null {
  if (!token) return null;
  const parts = token.split(".");
  let iat: string, owner = "", epoch = 0;
  if (parts[0] === "v1" && parts.length === 3) {
    iat = parts[1];
    if (!safeEqual(parts[2], hmac(`v1.${iat}`))) return null;
  } else if (parts[0] === "v2" && parts.length === 4) {
    [, iat, owner] = parts;
    if (!safeEqual(parts[3], hmac(`v2.${iat}.${owner}`))) return null;
  } else if (parts[0] === "v3" && parts.length === 5) {
    [, iat, owner] = parts;
    epoch = Number(parts[3]);
    if (!safeEqual(parts[4], hmac(parts.slice(0, 4).join(".")))) return null;
  } else return null;
  const ageMs = Date.now() - parseInt(iat, 36);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_AGE_DAYS * 24 * 3600 * 1000 ? { owner, epoch } : null;
}

// --- Profile PINs ---
// Stored as "salt:scrypt-hash"; a 4–6 digit PIN is weak on its own, which is
// why it sits behind the passcode and failed attempts are throttled.
export const isValidPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4,6}$/.test(pin);

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

// After MAX_FAILS wrong PINs a profile refuses attempts for LOCKOUT_MS.
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const fails = new Map<string, { count: number; until: number }>();

export type PinResult = "ok" | "wrong" | "throttled";
export function checkPin(profileId: string, pinHash: string, pin: unknown): PinResult {
  const f = fails.get(profileId);
  if (f && f.until > Date.now()) return "throttled";
  const [salt, hash] = pinHash.split(":");
  const ok = typeof pin === "string" && !!salt && safeEqual(scryptSync(pin, salt, 32).toString("hex"), hash);
  if (ok) { fails.delete(profileId); return "ok"; }
  const count = (f?.until ? 0 : f?.count ?? 0) + 1; // a lapsed lockout starts a fresh count
  if (count >= MAX_FAILS) { fails.set(profileId, { count: 0, until: Date.now() + LOCKOUT_MS }); return "throttled"; }
  fails.set(profileId, { count, until: 0 });
  return "wrong";
}

// Unlock token for one profile, sent by the client as X-Profile-Unlock. Kept
// only in page memory, so it's gone on reload. Signed over the current PIN hash
// and sign-out epoch, so changing the PIN or signing devices out voids it.
const UNLOCK_MS = 12 * 3600 * 1000;
export function issueUnlock(profileId: string, pinHash: string, epoch: number): string {
  const exp = (Date.now() + UNLOCK_MS).toString(36);
  return `u1.${profileId}.${exp}.${hmac(`u1.${profileId}.${exp}.${pinHash}.${epoch}`)}`;
}

export function verifyUnlock(token: unknown, profileId: string, pinHash: string, epoch: number): boolean {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "u1" || parts[1] !== profileId) return false;
  const exp = parseInt(parts[2], 36);
  return Number.isFinite(exp) && exp > Date.now() && safeEqual(parts[3], hmac(`u1.${profileId}.${parts[2]}.${pinHash}.${epoch}`));
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
