/**
 * Tab-scoped student "seat". Each join issues a random seat id; the tab keeps it in its URL
 * and sends it with every student request so the server can pick that seat's HttpOnly cookie.
 * The seat only selects an identity — it is not a credential. Shared by browser and server.
 */
export const SEAT_HEADER = "x-quickanswer-seat";
/** EventSource cannot set headers, so streams and student pages carry the seat as `?seat=`. */
export const SEAT_QUERY_PARAM = "seat";
/** 16 random bytes in base64url. */
export const seatIdPattern = /^[A-Za-z0-9_-]{22}$/;

export function isSeatId(value: unknown): value is string {
  return typeof value === "string" && seatIdPattern.test(value);
}

export function seatHeaders(seat: string): Record<string, string> {
  return { [SEAT_HEADER]: seat };
}

export function withSeat(path: string, seat: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${SEAT_QUERY_PARAM}=${encodeURIComponent(seat)}`;
}
