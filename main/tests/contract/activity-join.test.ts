import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ joinActivity: vi.fn() }));
vi.mock("@/features/activities/application/join-activity", () => ({ joinActivity: mocks.joinActivity }));

import { POST } from "@/app/api/activities/[activityId]/join/route";
import { isSeatId } from "@/lib/session/seat";
import { createSeatId, MAX_SEAT_COOKIES, signSession, verifySession } from "@/server/auth/session";
import { AppError } from "@/server/http/errors";
import { setCookies } from "../fixtures/cookie-jar";

function request(body: unknown, cookie = "") {
  return new Request("http://localhost/api/activities/activity-1/join", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ activityId: "activity-1" }) };
const validJoin = { joinCode: "ABC234", groupId: "Blue", displayName: "Sam" };

describe("activity join API", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes");
    mocks.joinActivity.mockResolvedValue({ activityId: "activity-1", groupId: "Blue", displayName: "Sam", phase: "ready" });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("issues a new seat with its own HttpOnly cookie bound to the activity group", async () => {
    const response = await POST(request(validJoin), context);
    const body = await response.json() as { groupId: string; phase: string; seatId: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ groupId: "Blue", phase: "ready" });
    expect(isSeatId(body.seatId)).toBe(true);
    const [cookie] = setCookies(response);
    expect(cookie.name).toBe(`qa_seat_${body.seatId}`);
    expect(cookie.attributes).toEqual(expect.arrayContaining(["httponly", "path=/", "samesite=lax"]));
    expect(verifySession(decodeURIComponent(cookie.value))).toMatchObject({ role: "student", activityId: "activity-1", groupId: "Blue", seatId: body.seatId });
    expect(response.headers.get("set-cookie")).not.toContain("classroom_session");
    expect(response.headers.get("set-cookie")).not.toContain("qa_teacher");
  });

  it("gives every join its own seat so earlier seats in the browser stay untouched", async () => {
    const first = await POST(request(validJoin), context);
    const { seatId: firstSeat } = await first.json() as { seatId: string };
    const firstCookie = setCookies(first)[0];
    const second = await POST(request({ ...validJoin, groupId: "Red" }, `${firstCookie.name}=${firstCookie.value}`), context);
    const { seatId: secondSeat } = await second.json() as { seatId: string };

    expect(secondSeat).not.toBe(firstSeat);
    expect(setCookies(second).map((cookie) => cookie.name)).toEqual([`qa_seat_${secondSeat}`]);
  });

  it("expires invalid seats and the earliest seats beyond the per-browser limit", async () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = Array.from({ length: MAX_SEAT_COOKIES }, (_, index) => {
      const seat = createSeatId();
      return { seat, token: signSession({ sub: `s${index}`, role: "student", activityId: "activity-1", groupId: "Blue", seatId: seat, exp: now + 1000 + index }) };
    });
    const expiredSeat = createSeatId();
    const expired = signSession({ sub: "old", role: "student", activityId: "activity-1", groupId: "Blue", seatId: expiredSeat, exp: now - 1 });
    const forgedSeat = createSeatId();
    const cookie = [
      `qa_teacher=${signSession({ sub: "teacher-1", role: "teacher" })}`,
      ...valid.map(({ seat, token }) => `qa_seat_${seat}=${token}`),
      `qa_seat_${expiredSeat}=${expired}`,
      `qa_seat_${forgedSeat}=garbage`,
    ].join("; ");

    const response = await POST(request(validJoin, cookie), context);
    const { seatId } = await response.json() as { seatId: string };
    const cleared = setCookies(response).filter((item) => item.attributes.includes("max-age=0")).map((item) => item.name).sort();

    expect(cleared).toEqual([`qa_seat_${expiredSeat}`, `qa_seat_${forgedSeat}`, `qa_seat_${valid[0].seat}`].sort());
    expect(setCookies(response).find((item) => item.name === `qa_seat_${seatId}`)?.attributes).toContain("max-age=28800");
    expect(setCookies(response).some((item) => item.name === "qa_teacher")).toBe(false);
  });

  it("rejects malformed join information before lookup", async () => {
    const response = await POST(request({ joinCode: "bad", groupId: "Blue", displayName: "" }), context);
    expect(response.status).toBe(422);
    expect(mocks.joinActivity).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the service error for an unknown join code", async () => {
    mocks.joinActivity.mockRejectedValue(new AppError(404, "NOT_FOUND", "活動代碼不存在或已過期。"));
    const response = await POST(request(validJoin), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
