import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  openRounds: vi.fn(),
  closeRound: vi.fn(),
  closeAllOpenRounds: vi.fn(),
  submitAnswer: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/server/redis/round-store", () => ({
  openRounds: mocks.openRounds,
  closeRound: mocks.closeRound,
  closeAllOpenRounds: mocks.closeAllOpenRounds,
  submitAnswer: mocks.submitAnswer,
}));

import { POST as open } from "@/app/api/activities/[activityId]/rounds/open/route";
import { POST as close } from "@/app/api/activities/[activityId]/rounds/[roundId]/close/route";
import { POST as closeAll } from "@/app/api/activities/[activityId]/rounds/close-all/route";
import { POST as submit } from "@/app/api/activities/[activityId]/rounds/[roundId]/submissions/route";

const teacher = { sub: "teacher-1", role: "teacher", exp: 4_000_000_000 };
const student = { sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 };
const roundParams = { params: Promise.resolve({ activityId: "activity-1", roundId: "round-1" }) };
const activityParams = { params: Promise.resolve({ activityId: "activity-1" }) };
function request(body?: unknown) {
  return new Request("http://localhost/api/activities/activity-1/rounds", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "classroom_session=valid" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("round controls and submission routes", () => {
  afterEach(() => vi.resetAllMocks());

  const openedRound = (questionNumber: string, stateVersion: number) => ({ roundId: `round-${questionNumber}`, questionNumber, prompt: "Q?", kind: "single", blanks: [{ label: null, prompt: "Q?" }], phase: "open", openedAt: "t", stateVersion });

  it("keeps the legacy single-question open request and response", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.openRounds.mockResolvedValue({ rounds: [openedRound("1", 1)], stateVersion: 1 });
    const response = await open(request({ questionNumber: "1" }), activityParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openedRound("1", 1));
    expect(mocks.openRounds).toHaveBeenCalledWith("activity-1", "teacher-1", ["1"]);
  });

  it("opens several questions in one request", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    const result = { rounds: [openedRound("1", 1), openedRound("3", 2)], stateVersion: 2 };
    mocks.openRounds.mockResolvedValue(result);
    const response = await open(request({ questionNumbers: ["1", "3"] }), activityParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.openRounds).toHaveBeenCalledWith("activity-1", "teacher-1", ["1", "3"]);
  });

  it("rejects invalid open requests before they reach the round store", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    for (const body of [{}, { questionNumbers: [] }, { questionNumbers: ["1", "1"] }, { questionNumber: "x" }]) {
      expect((await open(request(body), activityParams)).status).toBe(422);
    }
    expect(mocks.openRounds).not.toHaveBeenCalled();
  });

  it("rejects students from opening or closing rounds", async () => {
    mocks.getRequestSession.mockReturnValue(student);
    expect((await open(request({ questionNumber: "1" }), activityParams)).status).toBe(403);
    expect((await open(request({ questionNumbers: ["1", "2"] }), activityParams)).status).toBe(403);
    expect((await close(request(), roundParams)).status).toBe(403);
    expect((await closeAll(request(), activityParams)).status).toBe(403);
    expect(mocks.openRounds).not.toHaveBeenCalled();
    expect(mocks.closeRound).not.toHaveBeenCalled();
    expect(mocks.closeAllOpenRounds).not.toHaveBeenCalled();
  });

  it("closes every open round using the authenticated teacher identity", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    const result = { rounds: [{ phase: "closed", roundId: "round-1", questionNumber: "1", winnerGroupId: null, submissions: [], closedAt: "t", stateVersion: 3 }], stateVersion: 3 };
    mocks.closeAllOpenRounds.mockResolvedValue(result);
    const response = await closeAll(request(), activityParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.closeAllOpenRounds).toHaveBeenCalledWith("activity-1", "teacher-1");
  });

  it("closes a round using the authenticated teacher identity", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.closeRound.mockResolvedValue({ phase: "closed", winnerGroupId: null, submissions: [] });
    const response = await close(request(), roundParams);
    expect(response.status).toBe(200);
    expect(mocks.closeRound).toHaveBeenCalledWith("activity-1", "round-1", "teacher-1");
  });

  it("submits as the session-bound group and ignores a forged groupId", async () => {
    mocks.getRequestSession.mockReturnValue(student);
    mocks.submitAnswer.mockResolvedValue({ groupId: "Blue", acceptedOrder: 1 });
    const response = await submit(request({ answer: "A", requestId: "123e4567-e89b-42d3-a456-426614174000", groupId: "Red" }), roundParams);
    expect(response.status).toBe(201);
    // The legacy single `answer` is normalised to a one-element `answers` array.
    expect(mocks.submitAnswer).toHaveBeenCalledWith("activity-1", "round-1", "Blue", ["A"]);
  });

  it("submits every blank of a question group in one request", async () => {
    mocks.getRequestSession.mockReturnValue(student);
    mocks.submitAnswer.mockResolvedValue({ groupId: "Blue", acceptedOrder: 1, answers: ["CPU", "OS"] });
    const response = await submit(request({ answers: [" CPU ", "OS"], requestId: "123e4567-e89b-42d3-a456-426614174000" }), roundParams);
    expect(response.status).toBe(201);
    expect(mocks.submitAnswer).toHaveBeenCalledWith("activity-1", "round-1", "Blue", ["CPU", "OS"]);
  });

  it("rejects an empty sub-answer before it reaches the round store", async () => {
    mocks.getRequestSession.mockReturnValue(student);
    for (const body of [{ answers: ["CPU", "  "] }, { answers: [] }, { answer: "" }]) {
      const response = await submit(request({ ...body, requestId: "123e4567-e89b-42d3-a456-426614174000" }), roundParams);
      expect(response.status).toBe(422);
    }
    expect(mocks.submitAnswer).not.toHaveBeenCalled();
  });
});
