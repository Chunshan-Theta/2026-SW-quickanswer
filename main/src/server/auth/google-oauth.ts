import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";

export const OAUTH_COOKIE = "classroom_google_oauth";

export function googleOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new AppError(503, errorCodes.serviceUnavailable, "尚未設定 Google 登入。");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

function signature(value: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError(503, errorCodes.serviceUnavailable, "尚未設定 session 金鑰。");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createOAuthState() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, verifier, expiresAt: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  return { state, challenge: createHash("sha256").update(verifier).digest("base64url"), cookie: `${payload}.${signature(payload)}` };
}

export function verifyOAuthState(cookie: string | undefined, state: string | null): string | null {
  if (!cookie || !state) return null;
  const [payload, provided, extra] = cookie.split(".");
  if (!payload || !provided || extra) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || !parsed || !("state" in parsed) || !("verifier" in parsed) || !("expiresAt" in parsed)) return null;
    if (parsed.state !== state || typeof parsed.verifier !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) return null;
    return parsed.verifier;
  } catch {
    return null;
  }
}