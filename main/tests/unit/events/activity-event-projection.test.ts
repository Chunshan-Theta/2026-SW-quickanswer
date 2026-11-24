import { describe, expect, it } from "vitest";
import { projectActivityEvent } from "@/server/events/activity-event-projection";

const teacher = { sub: "teacher-1", role: "teacher" as const, exp: 4_000_000_000 };
const blue = { sub: "student-1", role: "student" as const, activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 };
const event = {
  activityId: "activity-1",
  stateVersion: 4,
  type: "submission.accepted",
  occurredAt: "2026-11-13T00:00:00.000Z",
  data: { groupId: "Red", answer: "private answer", acceptedOrder: 1, winnerGroupId: "Red" },
};

describe("projectActivityEvent", () => {
  it("keeps full live submissions teacher-only", () => {
    expect(projectActivityEvent(event, teacher)).toEqual(event);
    expect(projectActivityEvent(event, blue)).toBeNull();
  });

  it("sends a student only their own receipt", () => {
    const ownEvent = { ...event, data: { ...event.data, groupId: "Blue", answer: "own answer" } };
    expect(projectActivityEvent(ownEvent, blue)).toMatchObject({ type: "submission.receipt", data: { answer: "own answer" } });
    expect(projectActivityEvent(ownEvent, blue)?.data).not.toHaveProperty("winnerGroupId");
  });

  describe("after a question closes (005)", () => {
    const finalized = {
      ...event,
      type: "results.finalized",
      data: {
        roundId: "round-1",
        questionNumber: "1",
        phase: "closed",
        winnerGroupId: "Red",
        submissions: [
          { groupId: "Red", answer: "red answer", acceptedOrder: 1, acceptedAt: "t1" },
          { groupId: "Blue", answer: "blue answer", acceptedOrder: 2, acceptedAt: "t2" },
        ],
      },
    };

    it("sends a student only their own submission and never the fastest group", () => {
      expect(projectActivityEvent(finalized, teacher)).toEqual(finalized);
      const projected = projectActivityEvent(finalized, blue);
      expect(projected).toMatchObject({ type: "results.finalized", stateVersion: 4 });
      expect(projected?.data).toEqual({
        roundId: "round-1",
        questionNumber: "1",
        phase: "closed",
        winnerGroupId: null,
        submissions: [{ groupId: "Blue", answer: "blue answer", acceptedOrder: 2, acceptedAt: "t2" }],
      });
      expect(JSON.stringify(projected)).not.toContain("Red");
      expect(JSON.stringify(projected)).not.toContain("red answer");
    });

    it("gives a student who did not answer an empty list", () => {
      const green = { ...blue, groupId: "Green" };
      expect(projectActivityEvent(finalized, green)?.data).toMatchObject({ winnerGroupId: null, submissions: [] });
    });

    it("publishes the adopted answer to students only when its writeback succeeded", () => {
      const status = (data: Record<string, unknown>) => ({ ...event, type: "writeback.status", stateVersion: 9, data: { jobId: "activity-1:round-1", roundId: "round-1", questionNumber: "1", attempt: 1, errorCode: null, ...data } });
      const adopted = { source: "group", groupId: "Red", answer: "red answer", answers: ["red answer"] };
      const queued = status({ status: "queued", adopted });
      const failed = status({ status: "failed", errorCode: "CONFLICT" });
      const succeeded = status({ status: "succeeded", published: { ...adopted, publishedAt: "t9" } });

      expect(projectActivityEvent(queued, teacher)).toEqual(queued);
      expect(projectActivityEvent(queued, blue)).toBeNull();
      expect(projectActivityEvent(failed, blue)).toBeNull();
      expect(projectActivityEvent(status({ status: "succeeded" }), blue)).toBeNull();
      expect(projectActivityEvent(succeeded, teacher)).toEqual(succeeded);
      expect(projectActivityEvent(succeeded, blue)).toEqual({
        activityId: "activity-1",
        stateVersion: 9,
        type: "answer.published",
        occurredAt: event.occurredAt,
        data: { roundId: "round-1", questionNumber: "1", published: { ...adopted, publishedAt: "t9" } },
      });
    });
  });
});
