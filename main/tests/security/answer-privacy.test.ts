import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { getActivitySnapshot } from "@/features/activities/application/activity-snapshot";
import { enqueueWriteback, readWritebackJob, updateWritebackStatus } from "@/server/redis/writeback-queue";
import { redisKeys } from "@/server/redis/keyspace";

// 005 / FR-009: once a question closes, a student sees only their own group's answer; the
// teacher-adopted answer appears only after its writeback succeeded. Checked on a real snapshot.
let activityId: string;
let roundId: string;
let teacherId: string;
let redis: RedisClientType;

const student = (groupId: string) => ({ sub: `student-${groupId}`, role: "student" as const, activityId, groupId, exp: 4_000_000_000 });

async function writeBack(selection: { source: "group"; groupId: string } | { source: "teacher"; answers: string[] }, status: "succeeded" | "failed") {
  const queued = await enqueueWriteback(activityId, roundId, teacherId, selection);
  const job = await readWritebackJob(redis, queued.jobId);
  if (!job) throw new Error("job missing");
  await updateWritebackStatus(redis, job, status, 1, status === "failed" ? "CONFLICT" : "");
}

describe("answer privacy after a question closes (005)", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  beforeEach(async () => {
    activityId = `privacy-${randomUUID()}`;
    roundId = `privacy-round-${randomUUID()}`;
    teacherId = `teacher-${randomUUID()}`;
    await redis.set(redisKeys.activity(activityId), JSON.stringify({
      activityId,
      teacherId,
      phase: "completed",
      stateVersion: 5,
      groupNames: ["Red", "Blue", "Green"],
      roundIdsByQuestion: { 1: roundId },
    }), { EX: 60 });
    await redis.hSet(redisKeys.round(roundId), { activityId, questionNumber: "1", prompt: "Name the process.", kind: "single", phase: "closed", winnerGroupId: "Red", closedAt: "t3" });
    await redis.hSet(redisKeys.submissions(roundId), {
      Red: JSON.stringify({ groupId: "Red", answer: "red secret", answers: ["red secret"], acceptedOrder: 1, acceptedAt: "t1" }),
      Blue: JSON.stringify({ groupId: "Blue", answer: "blue answer", answers: ["blue answer"], acceptedOrder: 2, acceptedAt: "t2" }),
    });
  });

  afterEach(async () => {
    const jobId = `${activityId}:${roundId}`;
    const entries = ((await redis.xRange(redisKeys.writebackJobs, "-", "+")) ?? []).filter((entry) => entry.message.jobId === jobId);
    if (entries.length) await redis.xDel(redisKeys.writebackJobs, entries.map((entry) => entry.id));
    await redis.del([redisKeys.activity(activityId), redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.writebackJob(jobId), redisKeys.writebackIdempotency(activityId, roundId), redisKeys.activityEvents(activityId)]);
  });

  afterAll(async () => { await redis?.quit(); });

  it("shows a student only their own answer and order, without the fastest group", async () => {
    const snapshot = await getActivitySnapshot(activityId, student("Blue"));

    expect(snapshot.rounds[0]).toMatchObject({ phase: "closed", winnerGroupId: null, submissions: [{ groupId: "Blue", answer: "blue answer", acceptedOrder: 2 }] });
    expect(snapshot.rounds[0].submissions).toHaveLength(1);
    expect(snapshot.rounds[0]).not.toHaveProperty("publishedAnswer");
    expect(snapshot.rounds[0]).not.toHaveProperty("writebackJob");
    expect(JSON.stringify(snapshot)).not.toContain("red secret");
    expect(JSON.stringify(snapshot)).not.toContain("Red");
    expect((await getActivitySnapshot(activityId, student("Green"))).rounds[0].submissions).toEqual([]);
  });

  it("adds the adopted answer for every student only after the writeback succeeded", async () => {
    await writeBack({ source: "group", groupId: "Red" }, "failed");
    expect((await getActivitySnapshot(activityId, student("Blue"))).rounds[0]).not.toHaveProperty("publishedAnswer");

    await writeBack({ source: "group", groupId: "Red" }, "succeeded");
    for (const groupId of ["Blue", "Green"]) {
      const round = (await getActivitySnapshot(activityId, student(groupId))).rounds[0];
      expect(round.publishedAnswer).toMatchObject({ source: "group", groupId: "Red", answer: "red secret", answers: ["red secret"] });
      expect(round.submissions.every((submission) => submission.groupId === groupId)).toBe(true);
      expect(round.winnerGroupId).toBeNull();
    }
  });

  it("labels a typed answer without a group and keeps the teacher view complete", async () => {
    await writeBack({ source: "teacher", answers: ["photosynthesis"] }, "succeeded");

    expect((await getActivitySnapshot(activityId, student("Blue"))).rounds[0].publishedAnswer).toMatchObject({ source: "teacher", groupId: null, answers: ["photosynthesis"] });
    const teacherRound = (await getActivitySnapshot(activityId, { sub: teacherId, role: "teacher", exp: 4_000_000_000 })).rounds[0];
    expect(teacherRound).toMatchObject({
      winnerGroupId: "Red",
      publishedAnswer: { source: "teacher", groupId: null },
      writebackJob: { status: "succeeded", adopted: { source: "teacher", groupId: null, answers: ["photosynthesis"] } },
    });
    expect(teacherRound.submissions.map((submission) => submission.groupId)).toEqual(["Red", "Blue"]);
  });
});
