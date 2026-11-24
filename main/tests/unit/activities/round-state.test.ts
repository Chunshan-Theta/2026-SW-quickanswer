import { describe, expect, it } from "vitest";
import type { ActivityRoundSnapshot } from "@/features/activities/domain/snapshot";
import {
  applyRoundClosed,
  applyRoundOpened,
  applySubmission,
  applyWritebackStatus,
  formatElapsed,
  questionStatus,
  roundsByQuestion,
  sortRounds,
} from "@/features/activities/domain/round-state";

function round(questionNumber: string, overrides: Partial<ActivityRoundSnapshot> = {}): ActivityRoundSnapshot {
  return {
    roundId: `round-${questionNumber}`,
    questionNumber,
    prompt: `Question ${questionNumber}?`,
    kind: "single",
    blanks: [{ label: null, prompt: `Question ${questionNumber}?` }],
    phase: "open",
    winnerGroupId: null,
    submissions: [],
    ...overrides,
  };
}

const submission = (groupId: string, acceptedOrder: number) => ({ groupId, answer: `${groupId} answer`, answers: [`${groupId} answer`], acceptedOrder, acceptedAt: `t${acceptedOrder}` });

describe("round state reducer", () => {
  it("sorts rounds by numeric question number", () => {
    expect(sortRounds([round("10"), round("2"), round("1")]).map((item) => item.questionNumber)).toEqual(["1", "2", "10"]);
  });

  it("adds an opened round in question order with defaults", () => {
    const rounds = applyRoundOpened([round("3")], { roundId: "round-1", questionNumber: "1", prompt: "First?", openedAt: "2026-11-25T00:00:00.000Z" });

    expect(rounds.map((item) => item.questionNumber)).toEqual(["1", "3"]);
    expect(rounds[0]).toEqual({
      roundId: "round-1",
      questionNumber: "1",
      prompt: "First?",
      kind: "single",
      blanks: [{ label: null, prompt: "First?" }],
      phase: "open",
      openedAt: "2026-11-25T00:00:00.000Z",
      winnerGroupId: null,
      submissions: [],
    });
  });

  it("ignores a duplicate open event so already received submissions are kept", () => {
    const existing = [round("1", { submissions: [submission("A", 1)] })];

    expect(applyRoundOpened(existing, { roundId: "round-1", questionNumber: "1", prompt: "Question 1?" })).toBe(existing);
  });

  it("applies a submission only to its own round, replacing the group's earlier entry", () => {
    const rounds = [round("1"), round("2", { submissions: [submission("B", 1)] })];
    const liveEvent = { ...submission("A", 2), roundId: "round-2", winnerGroupId: "B" };
    const updated = applySubmission(rounds, "round-2", liveEvent, "B");
    const again = applySubmission(updated, "round-2", submission("A", 2));

    expect(updated[0]).toBe(rounds[0]);
    expect(updated[1].submissions).toEqual([submission("B", 1), submission("A", 2)]);
    expect(updated[1].winnerGroupId).toBe("B");
    expect(again[1].submissions).toHaveLength(2);
  });

  it("leaves state untouched for events about unknown rounds", () => {
    const rounds = [round("1")];

    expect(applySubmission(rounds, "missing", submission("A", 1))).toBe(rounds);
    expect(applyRoundClosed(rounds, { roundId: "missing", winnerGroupId: null, submissions: [] })).toBe(rounds);
    expect(applyWritebackStatus(rounds, "missing", { jobId: "job", status: "queued" })).toBe(rounds);
  });

  it("closes one round with its final results and keeps the others open", () => {
    const rounds = [round("1"), round("2")];
    const closed = applyRoundClosed(rounds, { roundId: "round-1", winnerGroupId: "B", submissions: [submission("A", 2), submission("B", 1)], closedAt: "2026-11-25T00:01:00.000Z" });

    expect(closed[0]).toMatchObject({ phase: "closed", winnerGroupId: "B", closedAt: "2026-11-25T00:01:00.000Z" });
    expect(closed[0].submissions.map((item) => item.groupId)).toEqual(["B", "A"]);
    expect(closed[1]).toBe(rounds[1]);
  });

  it("records writeback progress on a round", () => {
    const rounds = applyWritebackStatus([round("1", { phase: "closed" })], "round-1", { jobId: "job-1", status: "failed", attempt: 3, errorCode: "STRUCTURE_CHANGED" });

    expect(rounds[0].writebackJob).toEqual({ jobId: "job-1", status: "failed", attempt: 3, errorCode: "STRUCTURE_CHANGED" });
  });

  it("indexes rounds by question number", () => {
    const index = roundsByQuestion([round("1"), round("2")]);
    expect(index.get("2")?.roundId).toBe("round-2");
    expect(index.get("3")).toBeUndefined();
  });
});

describe("question status", () => {
  const confirmed = { mappingStatus: "confirmed" };

  it("derives every card state", () => {
    expect(questionStatus({ mappingStatus: "ambiguous" })).toBe("unconfirmed");
    expect(questionStatus(confirmed)).toBe("idle");
    expect(questionStatus(confirmed, round("1"))).toBe("open");
    expect(questionStatus(confirmed, round("1", { phase: "closed" }))).toBe("closed");
    for (const status of ["queued", "running", "retryable"]) {
      expect(questionStatus(confirmed, round("1", { phase: "closed", writebackJob: { jobId: "j", status, attempt: 0, errorCode: null } }))).toBe("writeback-pending");
    }
    expect(questionStatus(confirmed, round("1", { phase: "closed", writebackJob: { jobId: "j", status: "succeeded", attempt: 1, errorCode: null } }))).toBe("writeback-succeeded");
    expect(questionStatus(confirmed, round("1", { phase: "closed", writebackJob: { jobId: "j", status: "failed", attempt: 3, errorCode: "X" } }))).toBe("writeback-failed");
  });
});

describe("formatElapsed", () => {
  const start = "2026-11-25T00:00:00.000Z";
  const at = (seconds: number) => Date.parse(start) + seconds * 1000;

  it("formats minutes and seconds, then hours", () => {
    expect(formatElapsed(start, at(0))).toBe("00:00");
    expect(formatElapsed(start, at(42))).toBe("00:42");
    expect(formatElapsed(start, at(10 * 60 + 5))).toBe("10:05");
    expect(formatElapsed(start, at(3600 + 61))).toBe("1:01:01");
  });

  it("never shows negative or invalid durations", () => {
    expect(formatElapsed(start, at(-5))).toBe("00:00");
    expect(formatElapsed(undefined, at(5))).toBe("00:00");
    expect(formatElapsed("not a date", at(5))).toBe("00:00");
  });
});
