import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { closeRound, openRound, submitAnswer } from "@/server/redis/round-store";
import { redisKeys } from "@/server/redis/keyspace";

const activityId = "round-race-test";
const teacherId = "teacher-race-test";
const questionNumber = "1";
const groups = Array.from({ length: 40 }, (_, index) => `Group-${index + 1}`);
let redis: RedisClientType;

async function seedActivity() {
  await redis.set(redisKeys.activity(activityId), JSON.stringify({
    activityId,
    teacherId,
    phase: "ready",
    stateVersion: 0,
    currentRoundId: null,
    groupNames: groups,
    questions: [{ questionId: "question-1", questionNumber, prompt: "Race?", mappingStatus: "confirmed", selectedToken: "slot-1" }],
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
    const results = await Promise.all(groups.map((groupId) => submitAnswer(activityId, round.roundId, groupId, `answer from ${groupId}`)));
    const orders = results.map((result) => result.acceptedOrder);

    expect(new Set(orders).size).toBe(groups.length);
    const winner = results.find((result) => result.winnerGroupId === result.groupId);
    expect(winner).toBeDefined();
    expect(winner?.acceptedOrder).toBe(1);
    await expect(submitAnswer(activityId, round.roundId, winner!.groupId, "duplicate")).rejects.toMatchObject({ status: 409 });
  });

  it("linearizes close against concurrent submissions and rejects all later submissions", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);
    const submissions = groups.slice(0, 20).map((groupId) => submitAnswer(activityId, round.roundId, groupId, `answer ${groupId}`).then(() => true, () => false));
    const closing = closeRound(activityId, round.roundId, teacherId);
    const [accepted, result] = await Promise.all([Promise.all(submissions), closing]);
    const acceptedCount = accepted.filter(Boolean).length;

    expect(acceptedCount).toBeGreaterThanOrEqual(0);
    expect(result.phase).toBe("closed");
    if (acceptedCount === 0) expect(result.winnerGroupId).toBeNull();
    else expect(result.winnerGroupId).toBeTruthy();
    await expect(submitAnswer(activityId, round.roundId, groups[21], "too late")).rejects.toMatchObject({ status: 409 });
  });

  it("reports no winner when a round closes without submissions", async () => {
    const round = await openRound(activityId, teacherId, questionNumber);
    const result = await closeRound(activityId, round.roundId, teacherId);
    expect(result.winnerGroupId).toBeNull();
    expect(result.submissions).toEqual([]);
  });
});
