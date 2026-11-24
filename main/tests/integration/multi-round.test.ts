import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { closeAllOpenRounds, closeRound, openRounds, submitAnswer } from "@/server/redis/round-store";
import { redisKeys } from "@/server/redis/keyspace";

const teacherId = "teacher-multi-round";
const groups = ["A", "B", "C"];
const createdActivities: string[] = [];
let redis: RedisClientType;

type StoredActivity = {
  phase: string;
  stateVersion: number;
  currentRoundId?: string | null;
  openRoundIdsByQuestion?: Record<string, string>;
  roundIdsByQuestion?: Record<string, string>;
  completedQuestionNumbers?: string[];
};

function question(questionNumber: string, mappingStatus = "confirmed") {
  return {
    questionNumber,
    prompt: `Question ${questionNumber}?`,
    kind: "single",
    mappingStatus,
    blanks: [{ label: null, prompt: `Question ${questionNumber}?`, mappingStatus }],
  };
}

/** Seeds an activity with a unique id; questions 1–3 are confirmed, question 4 is not. */
async function seedActivity(overrides: Record<string, unknown> = {}): Promise<string> {
  const activityId = `multi-round-${randomUUID()}`;
  createdActivities.push(activityId);
  await redis.set(redisKeys.activity(activityId), JSON.stringify({
    activityId,
    teacherId,
    phase: "ready",
    stateVersion: 0,
    groupNames: groups,
    questions: [question("1"), question("2"), question("3"), question("4", "ambiguous")],
    ...overrides,
  }), { EX: 120 });
  return activityId;
}

async function readActivity(activityId: string): Promise<StoredActivity> {
  return JSON.parse((await redis.get(redisKeys.activity(activityId)))!) as StoredActivity;
}

async function readEvents(activityId: string): Promise<Array<{ type: string; stateVersion: number; data: { roundId: string; questionNumber?: string } }>> {
  const entries = await redis.xRange(redisKeys.activityEvents(activityId), "-", "+");
  return (entries ?? []).map((entry) => JSON.parse(entry.message.payload));
}

const openOne = async (activityId: string, questionNumber: string) => (await openRounds(activityId, teacherId, [questionNumber])).rounds[0];

describe("several questions open at the same time", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  afterEach(async () => {
    for (const activityId of createdActivities.splice(0)) {
      const raw = await redis.get(redisKeys.activity(activityId));
      const roundIds = raw ? Object.values((JSON.parse(raw) as StoredActivity).roundIdsByQuestion ?? {}) : [];
      await redis.del([
        redisKeys.activity(activityId),
        redisKeys.activityEvents(activityId),
        ...roundIds.flatMap((roundId) => [redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.order(roundId), redisKeys.winner(roundId)]),
      ]);
    }
  });

  afterAll(async () => { await redis?.quit(); });

  describe("opening (US1)", () => {
    it("opens several questions in one call and records every round", async () => {
      const activityId = await seedActivity();

      const result = await openRounds(activityId, teacherId, ["1", "2"]);

      expect(result.rounds.map((round) => [round.questionNumber, round.phase])).toEqual([["1", "open"], ["2", "open"]]);
      expect(result.rounds.every((round) => typeof round.openedAt === "string")).toBe(true);
      expect(result.stateVersion).toBe(2);
      const activity = await readActivity(activityId);
      const [first, second] = result.rounds;
      expect(activity.phase).toBe("active");
      expect(activity.openRoundIdsByQuestion).toEqual({ 1: first.roundId, 2: second.roundId });
      expect(activity.roundIdsByQuestion).toEqual({ 1: first.roundId, 2: second.roundId });
      expect(await redis.hGet(redisKeys.round(second.roundId), "phase")).toBe("open");
      expect((await readEvents(activityId)).map((event) => [event.type, event.stateVersion, event.data.roundId])).toEqual([
        ["phase.changed", 1, first.roundId],
        ["phase.changed", 2, second.roundId],
      ]);
    });

    it("opens more questions while others are still open", async () => {
      const activityId = await seedActivity();
      const first = await openOne(activityId, "1");

      const second = await openOne(activityId, "2");

      expect((await readActivity(activityId)).openRoundIdsByQuestion).toEqual({ 1: first.roundId, 2: second.roundId });
    });

    it.each([
      ["a question that is already open", async (activityId: string) => { await openOne(activityId, "1"); }, ["2", "1"], 409, "第 1 題"],
      ["a completed question", async (activityId: string) => { await closeRound(activityId, (await openOne(activityId, "1")).roundId, teacherId); }, ["2", "1"], 409, "第 1 題"],
      ["an unconfirmed question", async () => undefined, ["2", "4"], 422, "第 4 題"],
      ["an unknown question", async () => undefined, ["2", "9"], 422, "第 9 題"],
      ["a duplicated question", async () => undefined, ["2", "2"], 422, "第 2 題"],
    ])("opens nothing when the request contains %s", async (_name, prepare, questionNumbers, status, mentioned) => {
      const activityId = await seedActivity();
      await prepare(activityId);
      const before = await readActivity(activityId);
      const eventsBefore = (await readEvents(activityId)).length;

      const failure = await openRounds(activityId, teacherId, questionNumbers).catch((error: unknown) => error);

      expect(failure).toMatchObject({ status });
      expect((failure as Error).message).toContain(mentioned);
      const after = await readActivity(activityId);
      expect(after.openRoundIdsByQuestion).toEqual(before.openRoundIdsByQuestion);
      expect(after.stateVersion).toBe(before.stateVersion);
      expect(await readEvents(activityId)).toHaveLength(eventsBefore);
    });

    it("rejects another teacher", async () => {
      const activityId = await seedActivity();

      await expect(openRounds(activityId, "someone-else", ["1"])).rejects.toMatchObject({ status: 403 });
      await expect(closeAllOpenRounds(activityId, "someone-else")).rejects.toMatchObject({ status: 403 });
    });

    it("drops a leftover single-round currentRoundId", async () => {
      const activityId = await seedActivity({ currentRoundId: "legacy-round" });

      await openOne(activityId, "1");

      expect((await readActivity(activityId)).currentRoundId).toBeUndefined();
    });
  });

  describe("closing (US1)", () => {
    it("closes one question and leaves the other open questions untouched", async () => {
      const activityId = await seedActivity();
      const [first, second, third] = (await openRounds(activityId, teacherId, ["1", "2", "3"])).rounds;
      await submitAnswer(activityId, first.roundId, "A", ["first"]);

      const closed = await closeRound(activityId, first.roundId, teacherId);

      expect(closed).toMatchObject({ phase: "closed", roundId: first.roundId, questionNumber: "1", winnerGroupId: "A" });
      expect(typeof closed.closedAt).toBe("string");
      const activity = await readActivity(activityId);
      expect(activity.openRoundIdsByQuestion).toEqual({ 2: second.roundId, 3: third.roundId });
      expect(activity.completedQuestionNumbers).toEqual(["1"]);
      expect(activity.phase).toBe("active");
      expect(await redis.hGet(redisKeys.round(second.roundId), "phase")).toBe("open");
      await expect(closeRound(activityId, first.roundId, teacherId)).rejects.toMatchObject({ status: 409 });
    });

    it("closes every open question at once with one result event per question", async () => {
      const activityId = await seedActivity();
      const [first, second] = (await openRounds(activityId, teacherId, ["1", "2"])).rounds;
      await submitAnswer(activityId, first.roundId, "B", ["b1"]);
      await submitAnswer(activityId, second.roundId, "C", ["c2"]);

      const result = await closeAllOpenRounds(activityId, teacherId);

      expect(result.rounds.map((round) => [round.questionNumber, round.phase, round.winnerGroupId])).toEqual([["1", "closed", "B"], ["2", "closed", "C"]]);
      const activity = await readActivity(activityId);
      expect(activity.openRoundIdsByQuestion).toBeUndefined();
      expect(activity.completedQuestionNumbers).toEqual(["1", "2"]);
      expect(activity.phase).toBe("active");
      const finalized = (await readEvents(activityId)).filter((event) => event.type === "results.finalized");
      expect(finalized.map((event) => event.data.roundId)).toEqual([first.roundId, second.roundId]);
      expect(result.stateVersion).toBe(activity.stateVersion);
    });

    it("refuses to close all when no question is open", async () => {
      const activityId = await seedActivity();
      await expect(closeAllOpenRounds(activityId, teacherId)).rejects.toMatchObject({ status: 409, message: "目前沒有開放中的題目。" });

      await closeRound(activityId, (await openOne(activityId, "1")).roundId, teacherId);
      await expect(closeAllOpenRounds(activityId, teacherId)).rejects.toMatchObject({ status: 409 });
    });

    it("completes the activity only after its last question closes", async () => {
      const activityId = await seedActivity({ questions: [question("1"), question("2")] });
      const [first] = (await openRounds(activityId, teacherId, ["1", "2"])).rounds;

      await closeRound(activityId, first.roundId, teacherId);
      expect((await readActivity(activityId)).phase).toBe("active");

      await closeAllOpenRounds(activityId, teacherId);
      expect((await readActivity(activityId)).phase).toBe("completed");
      await expect(openRounds(activityId, teacherId, ["1"])).rejects.toMatchObject({ status: 409 });
    });

    it("keeps event versions contiguous across opening, answering and closing", async () => {
      const activityId = await seedActivity();
      const [first] = (await openRounds(activityId, teacherId, ["1", "2"])).rounds;
      await submitAnswer(activityId, first.roundId, "A", ["a"]);
      await openOne(activityId, "3");
      await closeAllOpenRounds(activityId, teacherId);

      const versions = (await readEvents(activityId)).map((event) => event.stateVersion);
      expect(versions).toEqual(versions.map((_, index) => index + 1));
      expect((await readActivity(activityId)).stateVersion).toBe(versions.length);
    });
  });

  describe("answering several open questions (US2)", () => {
    it("orders and decides every open question independently", async () => {
      const activityId = await seedActivity();
      const [first, second] = (await openRounds(activityId, teacherId, ["1", "2"])).rounds;

      expect(await submitAnswer(activityId, second.roundId, "A", ["A on 2"])).toMatchObject({ acceptedOrder: 1, winnerGroupId: "A" });
      expect(await submitAnswer(activityId, first.roundId, "B", ["B on 1"])).toMatchObject({ acceptedOrder: 1, winnerGroupId: "B" });
      expect(await submitAnswer(activityId, first.roundId, "A", ["A on 1"])).toMatchObject({ acceptedOrder: 2, winnerGroupId: "B" });
      expect(await submitAnswer(activityId, second.roundId, "C", ["C on 2"])).toMatchObject({ acceptedOrder: 2, winnerGroupId: "A" });

      const result = await closeAllOpenRounds(activityId, teacherId);
      expect(result.rounds.map((round) => [round.winnerGroupId, round.submissions.map((submission) => submission.groupId)])).toEqual([
        ["B", ["B", "A"]],
        ["A", ["A", "C"]],
      ]);
    });

    it("rejects answers for a closed question while other questions keep accepting", async () => {
      const activityId = await seedActivity();
      const [first, second] = (await openRounds(activityId, teacherId, ["1", "2"])).rounds;
      await closeRound(activityId, first.roundId, teacherId);

      await expect(submitAnswer(activityId, first.roundId, "A", ["late"])).rejects.toMatchObject({ status: 409, message: "此搶答回合已結束。" });
      await expect(submitAnswer(activityId, second.roundId, "A", ["on time"])).resolves.toMatchObject({ acceptedOrder: 1 });
    });

    it("rejects an open round that belongs to another activity", async () => {
      const activityId = await seedActivity();
      const otherActivityId = await seedActivity();
      const foreign = await openOne(otherActivityId, "1");
      await openOne(activityId, "1");

      await expect(submitAnswer(activityId, foreign.roundId, "A", ["sneaky"])).rejects.toMatchObject({ status: 409 });
      expect(await redis.hGet(redisKeys.round(foreign.roundId), "nextOrder")).toBe("0");
    });
  });
});
