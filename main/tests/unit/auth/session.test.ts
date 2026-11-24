import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
  }),
}));

import { isSeatId, SEAT_HEADER, seatHeaders, withSeat } from "@/lib/session/seat";
import {
  createSeatId,
  getRequestSession,
  getStudentServerSession,
  getTeacherServerSession,
  signSession,
} from "@/server/auth/session";

const teacherToken = () => signSession({ sub: "teacher-1", role: "teacher" });
const seatToken = (seat: string, groupId = "teamA", activityId = "activity-1") =>
  signSession({ sub: `student-${groupId}`, role: "student", activityId, groupId, seatId: seat });

function request(cookies: Record<string, string>, options: { header?: string; query?: string } = {}) {
  const url = new URL("http://localhost/api/activities/activity-1/events");
  if (options.query !== undefined) url.searchParams.set("seat", options.query);
  const headers = new Headers({ cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") });
  if (options.header !== undefined) headers.set(SEAT_HEADER, options.header);
  return new Request(url, { headers });
}

describe("seat transport", () => {
  it("creates unguessable, well-formed and unique seat ids", () => {
    const seats = Array.from({ length: 200 }, () => createSeatId());
    expect(seats.every(isSeatId)).toBe(true);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it("rejects malformed seat ids", () => {
    for (const value of ["", "short", "a".repeat(23), "a".repeat(21) + "!", "a".repeat(21) + ".", undefined, 42]) {
      expect(isSeatId(value)).toBe(false);
    }
  });

  it("adds the seat to URLs and fetch headers", () => {
    const seat = createSeatId();
    expect(withSeat("/student/activity", seat)).toBe(`/student/activity?seat=${seat}`);
    expect(withSeat("/api/x?a=1", seat)).toBe(`/api/x?a=1&seat=${seat}`);
    expect(seatHeaders(seat)).toEqual({ "x-quickanswer-seat": seat });
  });
});

describe("getRequestSession", () => {
  beforeEach(() => vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes"));

  it("uses only the teacher cookie when the request carries no seat", () => {
    const seat = createSeatId();
    expect(getRequestSession(request({ qa_teacher: teacherToken(), [`qa_seat_${seat}`]: seatToken(seat) }))).toMatchObject({ role: "teacher", sub: "teacher-1" });
    expect(getRequestSession(request({ [`qa_seat_${seat}`]: seatToken(seat) }))).toBeNull();
  });

  it("picks the cookie of the seat named by the header among several seats", () => {
    const seatA = createSeatId();
    const seatB = createSeatId();
    const cookies = { qa_teacher: teacherToken(), [`qa_seat_${seatA}`]: seatToken(seatA, "teamA"), [`qa_seat_${seatB}`]: seatToken(seatB, "teamB") };
    expect(getRequestSession(request(cookies, { header: seatA }))).toMatchObject({ role: "student", groupId: "teamA", seatId: seatA });
    expect(getRequestSession(request(cookies, { header: seatB }))).toMatchObject({ role: "student", groupId: "teamB", seatId: seatB });
  });

  it("accepts the seat as a query parameter (EventSource) and prefers the header", () => {
    const seatA = createSeatId();
    const seatB = createSeatId();
    const cookies = { [`qa_seat_${seatA}`]: seatToken(seatA, "teamA"), [`qa_seat_${seatB}`]: seatToken(seatB, "teamB") };
    expect(getRequestSession(request(cookies, { query: seatB }))).toMatchObject({ groupId: "teamB" });
    expect(getRequestSession(request(cookies, { header: seatA, query: seatB }))).toMatchObject({ groupId: "teamA" });
  });

  it("never falls back to the teacher when the seat is missing, unknown or malformed", () => {
    const unknownSeat = createSeatId();
    expect(getRequestSession(request({ qa_teacher: teacherToken() }, { header: unknownSeat }))).toBeNull();
    expect(getRequestSession(request({ qa_teacher: teacherToken() }, { header: "not-a-seat" }))).toBeNull();
    expect(getRequestSession(request({ qa_teacher: teacherToken() }, { query: "" }))).toBeNull();
  });

  it("rejects a seat cookie copied under another seat name", () => {
    const seatA = createSeatId();
    const seatB = createSeatId();
    expect(getRequestSession(request({ [`qa_seat_${seatB}`]: seatToken(seatA) }, { header: seatB }))).toBeNull();
  });

  it("rejects role confusion between the teacher cookie and seat cookies", () => {
    const seat = createSeatId();
    expect(getRequestSession(request({ qa_teacher: seatToken(seat) }))).toBeNull();
    expect(getRequestSession(request({ [`qa_seat_${seat}`]: teacherToken() }, { header: seat }))).toBeNull();
  });

  it("ignores the legacy shared cookie and expired seats", () => {
    const seat = createSeatId();
    expect(getRequestSession(request({ classroom_session: teacherToken() }))).toBeNull();
    const expired = signSession({ sub: "s", role: "student", activityId: "activity-1", groupId: "teamA", seatId: seat, exp: Math.floor(Date.now() / 1000) - 1 });
    expect(getRequestSession(request({ [`qa_seat_${seat}`]: expired }, { header: seat }))).toBeNull();
  });
});

describe("server page sessions", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes");
    cookieStore.clear();
  });

  it("returns the student of the seat in the page URL, or null", async () => {
    const seat = createSeatId();
    cookieStore.set(`qa_seat_${seat}`, seatToken(seat, "teamB"));
    expect(await getStudentServerSession(seat)).toMatchObject({ role: "student", groupId: "teamB", seatId: seat });
    expect(await getStudentServerSession(undefined)).toBeNull();
    expect(await getStudentServerSession("not-a-seat")).toBeNull();
    expect(await getStudentServerSession(createSeatId())).toBeNull();
  });

  it("returns the teacher only from the teacher cookie", async () => {
    cookieStore.set("qa_teacher", teacherToken());
    expect(await getTeacherServerSession()).toMatchObject({ role: "teacher" });
    const seat = createSeatId();
    cookieStore.set("qa_teacher", seatToken(seat));
    expect(await getTeacherServerSession()).toBeNull();
  });
});
