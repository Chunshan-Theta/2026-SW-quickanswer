import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { SessionClaims } from "@/features/activities/domain/types";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";

export const SESSION_COOKIE = "classroom_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppError(500, errorCodes.internal, "SESSION_SECRET 必須至少 32 個字元。");
  }
  return secret;
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function signSession(claims: Omit<SessionClaims, "exp"> & { exp?: number }): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: claims.exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifySession(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra) return null;

  let expected: string;
  try {
    expected = signature(payload);
  } catch {
    return null;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (
      !claims.sub ||
      !["teacher", "student"].includes(claims.role) ||
      !Number.isInteger(claims.exp) ||
      claims.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    if (claims.role === "student" && (!claims.activityId || !claims.groupId)) return null;
    return claims;
  } catch {
    return null;
  }
}

function cookieFromHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return item ? decodeURIComponent(item.slice(SESSION_COOKIE.length + 1)) : undefined;
}

export function getRequestSession(request: Request): SessionClaims | null {
  return verifySession(cookieFromHeader(request.headers.get("cookie")));
}

export async function getServerSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
