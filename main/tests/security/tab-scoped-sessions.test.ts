import { beforeEach, describe, expect, it, vi } from "vitest";

// Real session module; only the services behind the routes are replaced.
const mocks = vi.hoisted(() => ({
  acceptRoundAnswer: vi.fn(),
  openActivityRounds: vi.fn(),
  getGoogleTokens: vi.fn(),
}));
vi.mock("@/features/activities/application/round-service", () => ({
  acceptRoundAnswer: mocks.acceptRoundAnswer,
  openActivityRounds: mocks.openActivityRounds,
  finishAllOpenRounds: vi.fn(),
  finishActivityRound: vi.fn(),
}));
vi.mock("@/server/redis/round-store", () => ({ openRounds: mocks.openActivityRounds, closeRound: vi.fn(), closeAllOpenRounds: vi.fn(), submitAnswer: mocks.acceptRoundAnswer }));
vi.mock("@/server/auth/google-token-store", () => ({ getGoogleTokens: mocks.getGoogleTokens, saveGoogleTokens: vi.fn() }));

import { POST as submit } from "@/app/api/activities/[activityId]/rounds/[roundId]/submissions/route";
import { POST as openRound } from "@/app/api/activities/[activityId]/rounds/open/route";
import { GET as events } from "@/app/api/activities/[activityId]/events/route";
import { GET as pickerToken } from "@/app/api/auth/google/picker-token/route";
import { SEAT_HEADER, withSeat } from "@/lib/session/seat";
import { createSeatId, signSession } from "@/server/auth/session";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const teacherCookie = () => `qa_teacher=${signSession({ sub: "teacher-1", role: "teacher" })}`;
const seatCookie = (seat: string, activityId = "activity-1", tokenSeat = seat) =>
  `qa_seat_${seat}=${signSession({ sub: "student-1", role: "student", activityId, groupId: "Blue", seatId: tokenSeat })}`;

function submission(activityId: string, cookie: string, seat?: string) {
  const headers = new Headers({ "content-type": "application/json", cookie });
  if (seat !== undefined) headers.set(SEAT_HEADER, seat);
  return submit(new Request(`http://localhost/api/activities/${activityId}/rounds/round-1/submissions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ answers: ["answer"], requestId }),
  }), { params: Promise.resolve({ activityId, roundId: "round-1" }) });
}

function open(cookie: string, seat?: string) {
  const headers = new Headers({ "content-type": "application/json", cookie });
  if (seat !== undefined) headers.set(SEAT_HEADER, seat);
  return openRound(new Request("http://localhost/api/activities/activity-1/rounds/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ questionNumber: "1" }),
  }), { params: Promise.resolve({ activityId: "activity-1" }) });
}

describe("tab-scoped session boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes");
    mocks.acceptRoundAnswer.mockResolvedValue({ groupId: "Blue", acceptedOrder: 1 });
    mocks.openActivityRounds.mockResolvedValue({ rounds: [{ roundId: "round-1", phase: "open" }], stateVersion: 1 });
  });

  it("accepts a seat only together with its own cookie", async () => {
    const seat = createSeatId();
    expect((await submission("activity-1", seatCookie(seat), seat)).status).toBe(201);
    expect(mocks.acceptRoundAnswer).toHaveBeenCalledWith("activity-1", "round-1", "Blue", ["answer"]);
  });

  it("rejects a copied student URL in a browser without the seat cookie", async () => {
    const seat = createSeatId();
    expect((await submission("activity-1", "", seat)).status).toBe(401);
    expect((await submission("activity-1", teacherCookie(), seat)).status).toBe(401);
    expect(mocks.acceptRoundAnswer).not.toHaveBeenCalled();
  });

  it("rejects a seat cookie value replayed under another seat name", async () => {
    const realSeat = createSeatId();
    const otherSeat = createSeatId();
    expect((await submission("activity-1", seatCookie(otherSeat, "activity-1", realSeat), otherSeat)).status).toBe(401);
    expect(mocks.acceptRoundAnswer).not.toHaveBeenCalled();
  });

  it("binds a seat to the activity it joined", async () => {
    const seat = createSeatId();
    expect((await submission("activity-2", seatCookie(seat, "activity-1"), seat)).status).toBe(403);
    const stream = await events(new Request(withSeat("http://localhost/api/activities/activity-2/events", seat), {
      headers: { cookie: seatCookie(seat, "activity-1") },
    }), { params: Promise.resolve({ activityId: "activity-2" }) });
    expect(stream.status).toBe(403);
    expect(mocks.acceptRoundAnswer).not.toHaveBeenCalled();
  });

  it("keeps seats away from teacher-only endpoints even in the teacher's browser", async () => {
    const seat = createSeatId();
    const browser = `${teacherCookie()}; ${seatCookie(seat)}`;
    expect((await open(browser, seat)).status).toBe(403);
    const picker = await pickerToken(new Request("http://localhost/api/auth/google/picker-token", {
      headers: { cookie: browser, [SEAT_HEADER]: seat },
    }));
    expect(picker.status).toBe(403);
    expect(mocks.openActivityRounds).not.toHaveBeenCalled();
    expect(mocks.getGoogleTokens).not.toHaveBeenCalled();
    // Without a seat the same browser is the teacher again.
    expect((await open(browser)).status).toBe(200);
    expect(mocks.openActivityRounds).toHaveBeenCalledWith("activity-1", "teacher-1", ["1"]);
  });

  it("does not fall back to the teacher for malformed or unknown seats", async () => {
    expect((await open(teacherCookie(), "not-a-seat")).status).toBe(401);
    expect((await open(teacherCookie(), createSeatId())).status).toBe(401);
    expect(mocks.openActivityRounds).not.toHaveBeenCalled();
  });

  it("never lets a student identity pass as the teacher cookie", async () => {
    const seat = createSeatId();
    const studentToken = signSession({ sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", seatId: seat });
    expect((await open(`qa_teacher=${studentToken}`)).status).toBe(401);
    expect(mocks.openActivityRounds).not.toHaveBeenCalled();
  });
});
