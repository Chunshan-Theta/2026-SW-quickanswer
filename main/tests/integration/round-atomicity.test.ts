import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { closeRound, openRounds, submitAnswer } from "@/server/redis/round-store";
import { redisKeys } from "@/server/redis/keyspace";

// Unique per run so parallel test runs sharing one Redis never collide.
const activityId = `round-race-test-${randomUUID()}`;
const teacherId = "teacher-race-test";
const questionNumber = "1";
const groups = Array.from({ length: 40 }, (_, index) => `Group-${index + 1}`);
let redis: RedisClientType;

const openRound = async (id: string, teacher: string, number: string) => (await openRounds(id, teacher, [number])).rounds[0];

async function seedActivity() {
  await redis.set(redisKeys.activity(activityId), JSON.stringify({
    activityId,
    teacherId,
    phase: "ready",
    stateVersion: 0,
    groupNames: groups,
    questions: [
      { questionId: "question-1", questionNumber, prompt: "Race?", mappingStatus: "confirmed", selectedToken: "slot-1" },
      { questionId: "question-2", questionNumber: "2", prompt: "Next?", mappingStatus: "confirmed", selectedToken: "slot-2" },
      {
        questionNumber: "3",
        prompt: "CPU？／OS？",
        kind: "group",
        mappingStatus: "confirmed",
        blanks: [
          { label: "（1）", prompt: "CPU？", mappingStatus: "confirmed", candidates: [{ token: "t1", location: { sheetId: 1, rowIndex: 4, columnIndex: 6 } }], selectedToken: "t1" },
          { label: null, prompt: "OS？", mappingStatus: "confirmed", candidates: [{ token: "t2", location: { sheetId: 1, rowIndex: 5, columnIndex: 6 } }], selectedToken: "t2" },
        ],
      },
    ],
    completedQuestionNumbers: [],
  }), { EX: 60 });
}

describe("Redis round atomicity", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  beforeEach(async () => {
    await redis.del(redisKeys.activity(activityId));
    await redis.del(redisKeys.activityEvents(activityId));
    await seedActivity();
  });

  afterAll(async () => { await redis?.quit(); });

  it("serializes concurrent first submissions and chooses exactly one winner", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);
    const results = await Promise.all(groups.map((groupId) => submitAnswer(activityId, round.roundId, groupId, [`answer from ${groupId}`])));
    const orders = results.map((result) => result.acceptedOrder);

    expect(new Set(orders).size).toBe(groups.length);
    const winner = results.find((result) => result.winnerGroupId === result.groupId);
    expect(winner).toBeDefined();
    expect(winner?.acceptedOrder).toBe(1);
    expect(await redis.ttl(redisKeys.submissions(round.roundId))).toBeGreaterThan(0);
    expect(await redis.ttl(redisKeys.order(round.roundId))).toBeGreaterThan(0);
    expect(await redis.ttl(redisKeys.winner(round.roundId))).toBeGreaterThan(0);
    await expect(submitAnswer(activityId, round.roundId, winner!.groupId, ["duplicate"])).rejects.toMatchObject({ status: 409 });
  });

  it("linearizes close against concurrent submissions and rejects all later submissions", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);
    const submissions = groups.slice(0, 20).map((groupId) => submitAnswer(activityId, round.roundId, groupId, [`answer ${groupId}`]).then(() => true, () => false));
    const closing = closeRound(activityId, round.roundId, teacherId);
    const [accepted, result] = await Promise.all([Promise.all(submissions), closing]);
    const acceptedCount = accepted.filter(Boolean).length;

    expect(acceptedCount).toBeGreaterThanOrEqual(0);
    expect(result.phase).toBe("closed");
    if (acceptedCount === 0) expect(result.winnerGroupId).toBeNull();
    else expect(result.winnerGroupId).toBeTruthy();
    await expect(submitAnswer(activityId, round.roundId, groups[21], ["too late"])).rejects.toMatchObject({ status: 409 });
  });

  it("reports no winner when a round closes without submissions", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);
    const result = await closeRound(activityId, round.roundId, teacherId);
    expect(result.winnerGroupId).toBeNull();
    expect(result.submissions).toEqual([]);
  });

  it("does not reopen a question after its round is complete", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);
    await closeRound(activityId, round.roundId, teacherId);

    await expect(openRound(activityId, teacherId, questionNumber)).rejects.toMatchObject({ status: 409 });
  });

  it("stores blanks on a group round and records the round per question", async () => {
    const round = await openRound(activityId, teacherId, "3");

    expect(round).toMatchObject({ kind: "group", blanks: [{ label: "（1）", prompt: "CPU？" }, { label: null, prompt: "OS？" }] });
    expect(await redis.hGet(redisKeys.round(round.roundId), "blankCount")).toBe("2");
    const activity = JSON.parse((await redis.get(redisKeys.activity(activityId)))!);
    expect(activity.roundIdsByQuestion).toEqual({ "3": round.roundId });
    expect(activity.questions[2].blanks[0].candidates).toHaveLength(1);
  });

  it("rejects incomplete group answers atomically without consuming an order", async () => {
    const round = await openRound(activityId, teacherId, "3");

    await expect(submitAnswer(activityId, round.roundId, groups[0], ["CPU"])).rejects.toMatchObject({ status: 422 });
    await expect(submitAnswer(activityId, round.roundId, groups[0], ["CPU", "   "])).rejects.toMatchObject({ status: 422 });
    expect(await redis.hGet(redisKeys.round(round.roundId), "nextOrder")).toBe("0");

    const first = await submitAnswer(activityId, round.roundId, groups[1], ["CPU", "作業系統"]);
    expect(first).toMatchObject({ acceptedOrder: 1, winnerGroupId: groups[1], answers: ["CPU", "作業系統"], answer: "（1）CPU；（2）作業系統" });
    const second = await submitAnswer(activityId, round.roundId, groups[0], ["GPU", "Linux"]);
    expect(second.acceptedOrder).toBe(2);

    const result = await closeRound(activityId, round.roundId, teacherId);
    expect(result.winnerGroupId).toBe(groups[1]);
    expect(result.submissions.map((submission) => submission.answers)).toEqual([["CPU", "作業系統"], ["GPU", "Linux"]]);
  });

  it("keeps single questions working with one answer and rejects extra answers", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);

    await expect(submitAnswer(activityId, round.roundId, groups[0], ["a", "b"])).rejects.toMatchObject({ status: 422 });
    await expect(submitAnswer(activityId, round.roundId, groups[0], ["photosynthesis"])).resolves.toMatchObject({
      answer: "photosynthesis",
      answers: ["photosynthesis"],
      acceptedOrder: 1,
    });
  });
});
