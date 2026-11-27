import { describe, expect, it } from "vitest";
import {
  activityListStatus,
  isActivityEnded,
  phaseAfterRoundsClosed,
  sortTeacherActivities,
} from "@/features/activities/domain/activity-lifecycle";

describe("activity lifecycle", () => {
  it("treats only the ended phase as ended", () => {
    expect(isActivityEnded("ended")).toBe(true);
    for (const phase of ["mapping_review", "ready", "active", "completed", "", undefined]) {
      expect(isActivityEnded(phase)).toBe(false);
    }
  });

  it("lists every phase except ended as ongoing", () => {
    expect(activityListStatus("ended")).toBe("ended");
    for (const phase of ["mapping_review", "ready", "active", "completed"]) {
      expect(activityListStatus(phase)).toBe("ongoing");
    }
  });

  it("orders ongoing activities first, then newest first, without mutating the input", () => {
    const list = [
      { activityId: "old-ended", status: "ended" as const, createdAt: "2026-11-20T00:00:00.000Z" },
      { activityId: "old-ongoing", status: "ongoing" as const, createdAt: "2026-11-21T00:00:00.000Z" },
      { activityId: "new-ended", status: "ended" as const, createdAt: "2026-11-24T00:00:00.000Z" },
      { activityId: "no-date", status: "ongoing" as const, createdAt: null },
      { activityId: "new-ongoing", status: "ongoing" as const, createdAt: "2026-11-25T00:00:00.000Z" },
    ];
    const before = list.map((item) => item.activityId);

    expect(sortTeacherActivities(list).map((item) => item.activityId)).toEqual(["new-ongoing", "old-ongoing", "no-date", "new-ended", "old-ended"]);
    expect(list.map((item) => item.activityId)).toEqual(before);
  });

  it("keeps equal entries in their original order", () => {
    const list = [
      { activityId: "a", status: "ongoing" as const, createdAt: "2026-11-25T00:00:00.000Z" },
      { activityId: "b", status: "ongoing" as const, createdAt: "2026-11-25T00:00:00.000Z" },
    ];
    expect(sortTeacherActivities(list).map((item) => item.activityId)).toEqual(["a", "b"]);
  });

  it("derives the phase after rounds close and never leaves ended", () => {
    expect(phaseAfterRoundsClosed("active", 4, 2)).toBe("active");
    expect(phaseAfterRoundsClosed("active", 4, 4)).toBe("completed");
    expect(phaseAfterRoundsClosed("ended", 4, 1)).toBe("ended");
    expect(phaseAfterRoundsClosed("ended", 4, 4)).toBe("ended");
  });
});
