import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { SessionClaims } from "@/features/activities/domain/types";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import { isSeatId, SEAT_HEADER, SEAT_QUERY_PARAM } from "@/lib/session/seat";

// Cookies are shared by every tab of a browser profile (and by all incognito windows), so one
// shared session cookie let a second join overwrite the first group. Identities are therefore
// split: the teacher has its own cookie, and every student join gets its own "seat" cookie
// that is only used when a request names that seat (see `getRequestSession`).

/** Teacher identity. Never read for requests that carry a seat. */
export const TEACHER_COOKIE = "qa_teacher";
/** One student identity per join: `qa_seat_<seatId>`. */
export const SEAT_COOKIE_PREFIX = "qa_seat_";
/** Live seat cookies kept per browser, so repeated joins cannot overflow the Cookie header. */
export const MAX_SEAT_COOKIES = 10;
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

export function createSeatId(): string {
  return randomBytes(16).toString("base64url");
}

export function seatCookieName(seat: string): string {
  return `${SEAT_COOKIE_PREFIX}${seat}`;
}

function verifyTeacherToken(token: string | undefined): SessionClaims | null {
  const claims = verifySession(token);
  return claims?.role === "teacher" ? claims : null;
}

/** A seat cookie is valid only for the seat it was issued for (no replay under another name). */
function verifySeatToken(token: string | undefined, seat: string): SessionClaims | null {
  const claims = verifySession(token);
  return claims?.role === "student" && claims.seatId === seat ? claims : null;
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (jar.has(name)) continue;
    try {
      jar.set(name, decodeURIComponent(part.slice(separator + 1).trim()));
    } catch {
      // Undecodable value: treat as absent.
    }
  }
  return jar;
}

/**
 * The seat a request acts for: the header (fetch) first, then `?seat=` (EventSource).
 * `undefined` = the request names no seat; `null` = it names a malformed one.
 */
export function requestSeat(request: Request): string | null | undefined {
  const value = request.headers.get(SEAT_HEADER) ?? new URL(request.url).searchParams.get(SEAT_QUERY_PARAM);
  if (value === null) return undefined;
  return isSeatId(value) ? value : null;
}

/**
 * Requests naming a seat get only that seat's student identity; requests without a seat get
 * only the teacher identity. A malformed seat never falls back to another identity.
 */
export function getRequestSession(request: Request): SessionClaims | null {
  const seat = requestSeat(request);
  if (seat === null) return null;
  const jar = parseCookieHeader(request.headers.get("cookie"));
  return seat === undefined
    ? verifyTeacherToken(jar.get(TEACHER_COOKIE))
    : verifySeatToken(jar.get(seatCookieName(seat)), seat);
}

export async function getTeacherServerSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  return verifyTeacherToken(store.get(TEACHER_COOKIE)?.value);
}

/** Student pages pass the `?seat=` of their URL. */
export async function getStudentServerSession(seat: string | undefined): Promise<SessionClaims | null> {
  if (!isSeatId(seat)) return null;
  const store = await cookies();
  return verifySeatToken(store.get(seatCookieName(seat))?.value, seat);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setTeacherSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(TEACHER_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
}

export function setSeatSessionCookie(response: NextResponse, seat: string, token: string): void {
  response.cookies.set(seatCookieName(seat), token, cookieOptions(SESSION_TTL_SECONDS));
}

/**
 * Call before issuing a new seat: expires the browser's invalid or expired seat cookies and,
 * if the new seat would exceed `MAX_SEAT_COOKIES`, the ones that expire first.
 */
export function pruneSeatCookies(request: Request, response: NextResponse): void {
  const live: { name: string; exp: number }[] = [];
  for (const [name, value] of parseCookieHeader(request.headers.get("cookie"))) {
    if (!name.startsWith(SEAT_COOKIE_PREFIX)) continue;
    const seat = name.slice(SEAT_COOKIE_PREFIX.length);
    if (!isSeatId(seat)) continue;
    const claims = verifySeatToken(value, seat);
    if (claims) live.push({ name, exp: claims.exp });
    else response.cookies.set(name, "", cookieOptions(0));
  }
  live.sort((left, right) => left.exp - right.exp);
  const excess = live.length - (MAX_SEAT_COOKIES - 1);
  for (const { name } of live.slice(0, Math.max(0, excess))) {
    response.cookies.set(name, "", cookieOptions(0));
  }
}
