import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  hGetAll: vi.fn(),
}));

vi.mock("@/server/redis/client", () => ({
  getRedisClient: async () => ({ get: mocks.get, hGetAll: mocks.hGetAll }),
}));

import { getRoundResults } from "@/features/activities/application/results-service";

const submissions = {
  Blue: JSON.stringify({ groupId: "Blue", answer: "blue answer", acceptedOrder: 1, acceptedAt: "t1" }),
  Red: JSON.stringify({ groupId: "Red", answer: "red answer", acceptedOrder: 2, acceptedAt: "t2" }),
};

describe("round results access", () => {
  afterEach(() => vi.resetAllMocks());

  function seedRound(phase: "open" | "closed", published: Record<string, string> = {}) {
    mocks.get.mockResolvedValue(JSON.stringify({ activityId: "activity-1", teacherId: "teacher-1", groupNames: ["Blue", "Red"] }));
    mocks.hGetAll.mockImplementation(async (key: string) => key.endsWith(":state")
      ? { activityId: "activity-1", phase, questionNumber: "1", winnerGroupId: phase === "closed" ? "Blue" : "", ...published }
      : submissions);
  }

  it("allows teachers to inspect live submissions and order", async () => {
    seedRound("open");
    const result = await getRoundResults("activity-1", "round-1", {
      sub: "teacher-1", role: "teacher", exp: 4_000_000_000,
    });

    expect(result.submissions).toHaveLength(2);
    expect(result.winnerGroupId).toBeNull();
  });

  it("limits an open-round student to their own submission", async () => {
    seedRound("open");
    const result = await getRoundResults("activity-1", "round-1", {
      sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000,
    });

    expect(result.submissions).toEqual([JSON.parse(submissions.Blue)]);
    expect(JSON.stringify(result)).not.toContain("red answer");
  });

  it("keeps a closed round private: a student sees only their own answer and no winner (005)", async () => {
    seedRound("closed");
    const result = await getRoundResults("activity-1", "round-1", {
      sub: "student-2", role: "student", activityId: "activity-1", groupId: "Red", exp: 4_000_000_000,
    });

    expect(result.submissions).toEqual([JSON.parse(submissions.Red)]);
    expect(result.winnerGroupId).toBeNull();
    expect(result).not.toHaveProperty("publishedAnswer");
    expect(JSON.stringify(result)).not.toContain("blue answer");
  });

  it("adds the published answer once the writeback succeeded (005)", async () => {
    seedRound("closed", { publishedSource: "group", publishedGroupId: "Blue", publishedAnswers: JSON.stringify(["blue answer"]), publishedAnswer: "blue answer", publishedAt: "t9" });
    const result = await getRoundResults("activity-1", "round-1", {
      sub: "student-2", role: "student", activityId: "activity-1", groupId: "Red", exp: 4_000_000_000,
    });

    expect(result.submissions.map((submission) => submission.groupId)).toEqual(["Red"]);
    expect(result.publishedAnswer).toEqual({ source: "group", groupId: "Blue", answer: "blue answer", answers: ["blue answer"], publishedAt: "t9" });
  });

  it("still gives the teacher every submission, the winner and the published answer", async () => {
    seedRound("closed", { publishedSource: "teacher", publishedGroupId: "", publishedAnswers: JSON.stringify(["typed"]), publishedAnswer: "typed" });
    const result = await getRoundResults("activity-1", "round-1", { sub: "teacher-1", role: "teacher", exp: 4_000_000_000 });

    expect(result.submissions).toHaveLength(2);
    expect(result.winnerGroupId).toBe("Blue");
    expect(result.publishedAnswer).toMatchObject({ source: "teacher", groupId: null, answers: ["typed"] });
  });

  it("rejects a teacher who does not own the activity", async () => {
    seedRound("open");
    await expect(getRoundResults("activity-1", "round-1", {
      sub: "other-teacher", role: "teacher", exp: 4_000_000_000,
    })).rejects.toMatchObject({ status: 403 });
  });
});
