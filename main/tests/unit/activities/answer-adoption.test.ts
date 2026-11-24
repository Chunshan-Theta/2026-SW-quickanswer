import { describe, expect, it } from "vitest";
import type { ActivityRoundSnapshot } from "@/features/activities/domain/snapshot";
import { adoptionIsComplete, defaultAdoption, describeAdoption, sameAdoption } from "@/features/activities/domain/answer-adoption";

const submission = (groupId: string, acceptedOrder: number) => ({ groupId, answer: `${groupId} answer`, answers: [`${groupId} answer`], acceptedOrder, acceptedAt: `t${acceptedOrder}` });

function closedRound(overrides: Partial<ActivityRoundSnapshot> = {}): ActivityRoundSnapshot {
  return {
    roundId: "round-1",
    questionNumber: "1",
    prompt: "Group question",
    kind: "group",
    blanks: [{ label: "（1）", prompt: "first" }, { label: "（2）", prompt: "second" }],
    phase: "closed",
    winnerGroupId: "A",
    submissions: [submission("A", 1), submission("B", 2)],
    ...overrides,
  };
}

describe("answer adoption helpers (005)", () => {
  it("preselects the fastest group when nothing was adopted yet", () => {
    expect(defaultAdoption(closedRound())).toEqual({ source: "group", groupId: "A" });
  });

  it("preselects the answer of the latest writeback job, then the published answer", () => {
    const adopted = { source: "group" as const, groupId: "B", answer: "B answer", answers: ["B answer"] };
    expect(defaultAdoption(closedRound({ writebackJob: { jobId: "j", status: "failed", attempt: 1, errorCode: "CONFLICT", adopted } }))).toEqual({ source: "group", groupId: "B" });
    expect(defaultAdoption(closedRound({ publishedAnswer: { source: "teacher", groupId: null, answer: "x", answers: ["CPU", "OS"] } })))
      .toEqual({ source: "teacher", answers: ["CPU", "OS"] });
  });

  it("falls back to an empty typed answer per blank when no group answered", () => {
    expect(defaultAdoption(closedRound({ winnerGroupId: null, submissions: [] }))).toEqual({ source: "teacher", answers: ["", ""] });
  });

  it("compares a selection with what was adopted", () => {
    const groupB = { source: "group" as const, groupId: "B", answer: "B", answers: ["B"] };
    const typed = { source: "teacher" as const, groupId: null, answer: "x", answers: ["CPU", "OS"] };
    expect(sameAdoption({ source: "group", groupId: "B" }, groupB)).toBe(true);
    expect(sameAdoption({ source: "group", groupId: "A" }, groupB)).toBe(false);
    expect(sameAdoption({ source: "teacher", answers: [" CPU ", "OS"] }, typed)).toBe(true);
    expect(sameAdoption({ source: "teacher", answers: ["CPU", "RAM"] }, typed)).toBe(false);
    expect(sameAdoption({ source: "group", groupId: "B" }, undefined)).toBe(false);
  });

  it("describes the adopted answer with its group or as provided by the teacher", () => {
    expect(describeAdoption({ source: "group", groupId: "teamB" })).toBe("teamB 的答案");
    expect(describeAdoption({ source: "teacher", groupId: null })).toBe("老師提供的答案");
  });

  it("requires a group or every blank to be filled", () => {
    expect(adoptionIsComplete({ source: "group", groupId: "A" }, 2)).toBe(true);
    expect(adoptionIsComplete({ source: "group", groupId: "" }, 1)).toBe(false);
    expect(adoptionIsComplete({ source: "teacher", answers: ["CPU", "OS"] }, 2)).toBe(true);
    expect(adoptionIsComplete({ source: "teacher", answers: ["CPU", "  "] }, 2)).toBe(false);
    expect(adoptionIsComplete({ source: "teacher", answers: ["CPU"] }, 2)).toBe(false);
  });
});
