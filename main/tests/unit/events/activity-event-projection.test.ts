import { describe, expect, it } from "vitest";
import { projectActivityEvent } from "@/server/events/activity-event-projection";

const teacher = { sub: "teacher-1", role: "teacher" as const, exp: 4_000_000_000 };
const blue = { sub: "student-1", role: "student" as const, activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 };
const event = {
  activityId: "activity-1",
  stateVersion: 4,
  type: "submission.accepted",
  occurredAt: 100,
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

  it("only publishes finalized group results to students after close", () => {
    const finalized = { ...event, type: "results.finalized", data: { phase: "closed", submissions: [{ groupId: "Red", answer: "answer" }] } };
    expect(projectActivityEvent(finalized, blue)).toEqual(finalized);
  });
});
