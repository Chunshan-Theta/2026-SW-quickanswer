import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { enqueueWriteback, readWritebackJob, updateWritebackStatus } from "@/server/redis/writeback-queue";
import { redisKeys } from "@/server/redis/keyspace";

// 005: the teacher chooses which answer is written back; the answer is published to students
// only when the writeback succeeds. Unique ids keep this suite off the shared job stream entries
// of other runs.
let activityId: string;
let roundId: string;
let teacherId: string;
let jobId: string;
let redis: RedisClientType;

const blanks = [{ label: "（1）", prompt: "運算元件" }, { label: "（2）", prompt: "系統軟體" }];
const submission = (groupId: string, acceptedOrder: number, answers: string[]) => JSON.stringify({
  groupId,
  answer: answers.map((answer, index) => `${blanks[index].label}${answer}`).join("；"),
  answers,
  acceptedOrder,
  acceptedAt: `t${acceptedOrder}`,
});

async function queuedEntries() {
  return ((await redis.xRange(redisKeys.writebackJobs, "-", "+")) ?? []).filter((entry) => entry.message.jobId === jobId);
}

async function events() {
  return ((await redis.xRange(redisKeys.activityEvents(activityId), "-", "+")) ?? [])
    .map((entry) => JSON.parse(entry.message.payload) as { type: string; stateVersion: number; data: Record<string, unknown> });
}

async function finishJob(status: "running" | "succeeded" | "failed", attempt = 1) {
  const job = await readWritebackJob(redis, jobId);
  if (!job) throw new Error("job missing");
  await updateWritebackStatus(redis, job, status, attempt, status === "failed" ? "CONFLICT" : "");
}

describe("teacher-selected writeback answers (005)", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  beforeEach(async () => {
    activityId = `adoption-${randomUUID()}`;
    roundId = `adoption-round-${randomUUID()}`;
    teacherId = `teacher-${randomUUID()}`;
    jobId = `${activityId}:${roundId}`;
    await redis.set(redisKeys.activity(activityId), JSON.stringify({ activityId, teacherId, stateVersion: 10, phase: "completed" }), { EX: 60 });
    await redis.hSet(redisKeys.round(roundId), {
      activityId,
      phase: "closed",
      questionNumber: "1",
      kind: "group",
      blankCount: "2",
      blanks: JSON.stringify(blanks),
      winnerGroupId: "A",
    });
    await redis.hSet(redisKeys.submissions(roundId), {
      A: submission("A", 1, ["GPU", "瀏覽器"]),
      B: submission("B", 2, ["CPU", "作業系統"]),
    });
  });

  afterEach(async () => {
    const entries = await queuedEntries();
    if (entries.length) await redis.xDel(redisKeys.writebackJobs, entries.map((entry) => entry.id));
    await redis.del([
      redisKeys.activity(activityId),
      redisKeys.round(roundId),
      redisKeys.submissions(roundId),
      redisKeys.writebackIdempotency(activityId, roundId),
      redisKeys.writebackJob(jobId),
      redisKeys.activityEvents(activityId),
    ]);
  });

  afterAll(async () => { await redis?.quit(); });

  describe("US1 choosing the answer", () => {
    it("writes the chosen group's answers instead of the fastest group's", async () => {
      const queued = await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });

      expect(queued).toMatchObject({ jobId, status: "queued", existing: false, revision: 1, adopted: { source: "group", groupId: "B", answers: ["CPU", "作業系統"] } });
      expect(await redis.hGetAll(redisKeys.writebackJob(jobId))).toMatchObject({
        adoptedSource: "group",
        adoptedGroupId: "B",
        winnerGroupId: "A",
        answer: "（1）CPU；（2）作業系統",
        answers: JSON.stringify(["CPU", "作業系統"]),
        revision: "1",
        status: "queued",
      });
      const queuedEvent = (await events()).find((event) => event.type === "writeback.status");
      expect(queuedEvent?.data).toMatchObject({ status: "queued", adopted: { source: "group", groupId: "B" } });
    });

    it("keeps the fastest group as the default without a selection", async () => {
      await enqueueWriteback(activityId, roundId, teacherId);

      expect(await redis.hGetAll(redisKeys.writebackJob(jobId))).toMatchObject({ adoptedSource: "group", adoptedGroupId: "A", answers: JSON.stringify(["GPU", "瀏覽器"]) });
    });

    it("rejects a group that did not answer this question", async () => {
      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "C" }))
        .rejects.toMatchObject({ status: 409, message: "所選組別沒有在本題作答。" });
      expect(await redis.exists(redisKeys.writebackJob(jobId))).toBe(0);
      expect(await queuedEntries()).toHaveLength(0);
    });

    it("keeps a pending job: the same selection is idempotent, a different one is refused", async () => {
      await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });
      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" }))
        .resolves.toMatchObject({ status: "queued", existing: true });

      await finishJob("running");
      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "A" }))
        .rejects.toMatchObject({ status: 409, message: "目前回填處理中，請等待完成後再改選答案。" });
      expect(await redis.hGet(redisKeys.writebackJob(jobId), "adoptedGroupId")).toBe("B");
      expect(await queuedEntries()).toHaveLength(1);
    });

    it("re-queues a different selection after success and remembers the published answer", async () => {
      await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });
      await finishJob("succeeded");

      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" }))
        .resolves.toMatchObject({ status: "succeeded", existing: true, revision: 1 });
      expect(await queuedEntries()).toHaveLength(1);

      const reselected = await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "A" });
      expect(reselected).toMatchObject({ jobId, status: "queued", existing: false, revision: 2, adopted: { groupId: "A" } });
      expect(await redis.hGetAll(redisKeys.writebackJob(jobId))).toMatchObject({
        adoptedGroupId: "A",
        answers: JSON.stringify(["GPU", "瀏覽器"]),
        previousAnswers: JSON.stringify(["CPU", "作業系統"]),
        status: "queued",
        attempt: "0",
        errorCode: "",
      });
      expect(await queuedEntries()).toHaveLength(2);
    });

    it("re-queues a failed job with the same or another selection", async () => {
      await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });
      await finishJob("failed", 3);

      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" }))
        .resolves.toMatchObject({ status: "queued", existing: false, revision: 2 });
      await finishJob("failed", 1);
      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "A" }))
        .resolves.toMatchObject({ status: "queued", existing: false, revision: 3, adopted: { groupId: "A" } });
    });

    it("treats a job queued before 005 as the fastest group's selection", async () => {
      await redis.set(redisKeys.writebackIdempotency(activityId, roundId), jobId, { EX: 60 });
      await redis.hSet(redisKeys.writebackJob(jobId), {
        jobId, activityId, roundId, teacherId, questionNumber: "1", winnerGroupId: "A",
        answer: "（1）GPU；（2）瀏覽器", answers: JSON.stringify(["GPU", "瀏覽器"]), status: "succeeded", attempt: "1", errorCode: "",
      });

      await expect(enqueueWriteback(activityId, roundId, teacherId)).resolves.toMatchObject({ status: "succeeded", existing: true });
      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" }))
        .resolves.toMatchObject({ status: "queued", existing: false, adopted: { groupId: "B" } });
    });
  });

  describe("US2 publishing the adopted answer", () => {
    it("publishes the adopted answer to the round only when the writeback succeeds", async () => {
      await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });
      await finishJob("running");
      await finishJob("failed");
      expect(await redis.hGet(redisKeys.round(roundId), "publishedSource")).toBeNull();

      await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });
      await finishJob("succeeded");

      expect(await redis.hGetAll(redisKeys.round(roundId))).toMatchObject({
        publishedSource: "group",
        publishedGroupId: "B",
        publishedAnswers: JSON.stringify(["CPU", "作業系統"]),
        publishedAnswer: "（1）CPU；（2）作業系統",
      });
      expect(await redis.hGet(redisKeys.round(roundId), "publishedAt")).toBeTruthy();
      const succeeded = (await events()).filter((event) => event.type === "writeback.status" && event.data.status === "succeeded");
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0].data).toMatchObject({ roundId, questionNumber: "1", published: { source: "group", groupId: "B", answer: "（1）CPU；（2）作業系統", answers: ["CPU", "作業系統"] } });
    });

    it("keeps the last published answer while a re-selection is pending or fails", async () => {
      await enqueueWriteback(activityId, roundId, teacherId, { source: "group", groupId: "B" });
      await finishJob("succeeded");
      await enqueueWriteback(activityId, roundId, teacherId, { source: "teacher", answers: ["ALU", "OS"] });
      await finishJob("running");
      await finishJob("failed");

      expect(await redis.hGetAll(redisKeys.round(roundId))).toMatchObject({ publishedSource: "group", publishedGroupId: "B" });
    });
  });

  describe("US3 typing the correct answer", () => {
    it("writes the teacher's answer per blank without a group", async () => {
      const queued = await enqueueWriteback(activityId, roundId, teacherId, { source: "teacher", answers: ["ALU", "OS"] });

      expect(queued.adopted).toEqual({ source: "teacher", groupId: null, answer: "（1）ALU；（2）OS", answers: ["ALU", "OS"] });
      expect(await redis.hGetAll(redisKeys.writebackJob(jobId))).toMatchObject({ adoptedSource: "teacher", adoptedGroupId: "", answers: JSON.stringify(["ALU", "OS"]) });
      await finishJob("succeeded");
      expect(await redis.hGetAll(redisKeys.round(roundId))).toMatchObject({ publishedSource: "teacher", publishedGroupId: "" });
    });

    it("rejects a typed answer that does not fill every blank", async () => {
      for (const answers of [["ALU"], ["ALU", "  "], ["ALU", "OS", "extra"]]) {
        await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "teacher", answers }))
          .rejects.toMatchObject({ status: 409, message: "請填寫所有子題的正確答案。" });
      }
      expect(await redis.exists(redisKeys.writebackJob(jobId))).toBe(0);
    });

    it("lets the teacher write a typed answer when no group answered", async () => {
      await redis.hSet(redisKeys.round(roundId), "winnerGroupId", "");
      await redis.del(redisKeys.submissions(roundId));

      await expect(enqueueWriteback(activityId, roundId, teacherId)).rejects.toMatchObject({ status: 409, message: "本題沒有得獎答案可回填。" });
      await expect(enqueueWriteback(activityId, roundId, teacherId, { source: "teacher", answers: ["ALU", "OS"] }))
        .resolves.toMatchObject({ status: "queued", existing: false });
    });
  });
});
