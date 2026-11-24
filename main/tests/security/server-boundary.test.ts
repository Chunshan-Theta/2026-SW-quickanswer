import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  acceptRoundAnswer: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/features/activities/application/round-service", () => ({ acceptRoundAnswer: mocks.acceptRoundAnswer }));

import { POST } from "@/app/api/activities/[activityId]/rounds/[roundId]/submissions/route";
import { projectActivityEvent } from "@/server/events/activity-event-projection";

describe("security boundaries", () => {
  afterEach(() => vi.resetAllMocks());

  it("uses the session-bound group instead of an untrusted request group", async () => {
    mocks.getRequestSession.mockReturnValue({
      sub: "student-1",
      role: "student",
      activityId: "activity-1",
      groupId: "Blue",
      exp: 4_000_000_000,
    });
    mocks.acceptRoundAnswer.mockResolvedValue({ groupId: "Blue", acceptedOrder: 1 });
    const request = new Request("http://localhost/api/activities/activity-1/rounds/round-1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "safe answer", requestId: "123e4567-e89b-42d3-a456-426614174000", groupId: "Red" }),
    });

    await POST(request, { params: Promise.resolve({ activityId: "activity-1", roundId: "round-1" }) });

    expect(mocks.acceptRoundAnswer).toHaveBeenCalledWith("activity-1", "round-1", "Blue", ["safe answer"]);
  });

  it("does not reveal the current winner to a student while the question is open", async () => {
    mocks.getRequestSession.mockReturnValue({ sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 });
    mocks.acceptRoundAnswer.mockResolvedValue({
      groupId: "Blue", answer: "safe answer", answers: ["safe answer"], acceptedOrder: 2, acceptedAt: "t2", winnerGroupId: "Red", stateVersion: 7,
    });
    const request = new Request("http://localhost/api/activities/activity-1/rounds/round-1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: ["safe answer"], requestId: "123e4567-e89b-42d3-a456-426614174000" }),
    });

    const response = await POST(request, { params: Promise.resolve({ activityId: "activity-1", roundId: "round-1" }) });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ accepted: true, groupId: "Blue", answers: ["safe answer"], acceptedOrder: 2, acceptedAt: "t2" });
    expect(body).not.toHaveProperty("winnerGroupId");
    expect(JSON.stringify(body)).not.toContain("Red");
  });

  it("never projects another group's live answer to a student", () => {
    const event = {
      activityId: "activity-1",
      stateVersion: 5,
      type: "submission.accepted",
      occurredAt: "2026-11-13T00:00:00.000Z",
      data: { roundId: "round-1", groupId: "Red", answer: "private answer", acceptedOrder: 1, acceptedAt: "t1" },
    };
    const student = {
      sub: "student-1",
      role: "student" as const,
      activityId: "activity-1",
      groupId: "Blue",
      exp: 4_000_000_000,
    };

    expect(projectActivityEvent(event, student)).toBeNull();
    expect(JSON.stringify(projectActivityEvent(event, student))).not.toContain("private answer");
  });
});
