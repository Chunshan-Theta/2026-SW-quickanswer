import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { enqueueWriteback } from "@/server/redis/writeback-queue";
import { redisKeys } from "@/server/redis/keyspace";

const activityId = "writeback-queue-test";
const roundId = "writeback-round-test";
const teacherId = "writeback-teacher-test";
let redis: RedisClientType;

describe("writeback queue", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  beforeEach(async () => {
    await redis.del([
      redisKeys.activity(activityId),
      redisKeys.round(roundId),
      redisKeys.submissions(roundId),
      redisKeys.writebackIdempotency(activityId, roundId),
      redisKeys.writebackJob(`${activityId}:${roundId}`),
      redisKeys.writebackJobs,
      redisKeys.activityEvents(activityId),
    ]);
    await redis.set(redisKeys.activity(activityId), JSON.stringify({
      activityId,
      teacherId,
      stateVersion: 4,
      phase: "completed",
    }), { EX: 60 });
    await redis.hSet(redisKeys.round(roundId), {
      activityId,
      phase: "closed",
      questionNumber: "1",
      winnerGroupId: "Blue",
    });
    await redis.hSet(redisKeys.submissions(roundId), {
      Blue: JSON.stringify({ groupId: "Blue", answer: "winner", acceptedOrder: 1, acceptedAt: "t1" }),
    });
  });

  afterAll(async () => { await redis?.quit(); });

  it("uses one idempotency key and creates one job for repeated requests", async () => {
    const first = await enqueueWriteback(activityId, roundId, teacherId);
    const second = await enqueueWriteback(activityId, roundId, teacherId);

    expect(first).toMatchObject({ jobId: `${activityId}:${roundId}`, status: "queued", existing: false });
    expect(second).toMatchObject({ jobId: first.jobId, status: "queued", existing: true });
    expect(await redis.xLen(redisKeys.writebackJobs)).toBe(1);
    expect(await redis.hGet(redisKeys.writebackJob(first.jobId), "answer")).toBe("winner");
  });

  it("rejects a closed round without a winner", async () => {
    await redis.hSet(redisKeys.round(roundId), "winnerGroupId", "");

    await expect(enqueueWriteback(activityId, roundId, teacherId)).rejects.toMatchObject({ status: 409 });
    expect(await redis.xLen(redisKeys.writebackJobs)).toBe(0);
  });
});
