import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  openRound: vi.fn(),
  closeRound: vi.fn(),
  submitAnswer: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/server/redis/round-store", () => ({ openRound: mocks.openRound, closeRound: mocks.closeRound, submitAnswer: mocks.submitAnswer }));

import { POST as open } from "@/app/api/activities/[activityId]/rounds/open/route";
import { POST as close } from "@/app/api/activities/[activityId]/rounds/[roundId]/close/route";
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

  it("allows a teacher to open a question", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.openRound.mockResolvedValue({ roundId: "round-1", phase: "open" });
    const response = await open(request({ questionNumber: "1" }), activityParams);
    expect(response.status).toBe(200);
    expect(mocks.openRound).toHaveBeenCalledWith("activity-1", "teacher-1", "1");
  });

  it("rejects students from opening or closing rounds", async () => {
    mocks.getRequestSession.mockReturnValue(student);
    expect((await open(request({ questionNumber: "1" }), activityParams)).status).toBe(403);
    expect((await close(request(), roundParams)).status).toBe(403);
    expect(mocks.openRound).not.toHaveBeenCalled();
    expect(mocks.closeRound).not.toHaveBeenCalled();
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
    expect(mocks.submitAnswer).toHaveBeenCalledWith("activity-1", "round-1", "Blue", "A");
  });
});
