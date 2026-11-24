import { describe, expect, it } from "vitest";
import { projectActivityEvent } from "@/server/events/activity-event-projection";

const teacher = { sub: "teacher-1", role: "teacher" as const, exp: 4_000_000_000 };
const blue = { sub: "student-1", role: "student" as const, activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 };
const ended = {
  activityId: "activity-1",
  stateVersion: 9,
  type: "activity.ended",
  occurredAt: "2026-11-25T02:00:00.000Z",
  data: { phase: "ended", endedAt: "2026-11-25T02:00:00.000Z" },
};

describe("activity.ended projection (006)", () => {
  it("tells every student and the teacher that the room is closed", () => {
    expect(projectActivityEvent(ended, blue)).toEqual(ended);
    expect(projectActivityEvent(ended, teacher)).toEqual(ended);
  });

  it("keeps other groups' live submissions hidden", () => {
    const submission = { ...ended, type: "submission.accepted", data: { roundId: "r1", groupId: "Red", answer: "private" } };
    expect(projectActivityEvent(submission, blue)).toBeNull();
  });
});
