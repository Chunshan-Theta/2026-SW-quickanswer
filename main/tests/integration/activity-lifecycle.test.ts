import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { groupTemplateGrid } from "../fixtures/guided-notes-templates";

const mocks = vi.hoisted(() => ({ readWorksheet: vi.fn() }));
vi.mock("@/features/sheets/google-sheets.adapter", () => ({ readWorksheet: mocks.readWorksheet }));

import { importGuidedNotes } from "@/features/sheets/application/import-guided-notes";
import { listTeacherActivities } from "@/features/activities/application/teacher-activities";
import { joinActivity, lookupActivityByJoinCode } from "@/features/activities/application/join-activity";
import { closeActivity, openRounds, submitAnswer } from "@/server/redis/round-store";
import { enqueueWriteback } from "@/server/redis/writeback-queue";
import { redisKeys } from "@/server/redis/keyspace";

const joinAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const groups = ["A", "B", "C"];
let redis: RedisClientType;
const cleanup = new Set<string>();

type StoredActivity = {
  phase: string;
  stateVersion: number;
  endedAt?: string;
  openRoundIdsByQuestion?: Record<string, string>;
  roundIdsByQuestion?: Record<string, string>;
  completedQuestionNumbers?: string[];
};
type StoredEvent = { type: string; stateVersion: number; data: Record<string, unknown> };

const newTeacher = () => `teacher-006-${randomUUID()}`;
const newJoinCode = () => Array.from({ length: 6 }, () => joinAlphabet[randomInt(joinAlphabet.length)]).join("");

function track(...keys: string[]) {
  for (const key of keys) cleanup.add(key);
}

function question(questionNumber: string) {
  return { questionNumber, prompt: `Question ${questionNumber}?`, kind: "single", mappingStatus: "confirmed", blanks: [{ label: null, prompt: `Question ${questionNumber}?`, mappingStatus: "confirmed" }] };
}

/** Seeds a ready activity (with join code and teacher index entry) under unique ids. */
async function seedActivity(teacherId: string, overrides: Record<string, unknown> = {}) {
  const activityId = `lifecycle-${randomUUID()}`;
  const joinCode = newJoinCode();
  const createdAt = (overrides.createdAt as string | undefined) ?? new Date().toISOString();
  await redis.set(redisKeys.activity(activityId), JSON.stringify({
    activityId,
    teacherId,
    joinCode,
    phase: "ready",
    stateVersion: 0,
    groupNames: groups,
    questions: [question("1"), question("2"), question("3")],
    createdAt,
    ...overrides,
  }), { EX: 120 });
  await redis.set(redisKeys.joinCode(joinCode), activityId, { EX: 120 });
  await redis.zAdd(redisKeys.teacherActivities(teacherId), { score: Date.parse(createdAt), value: activityId });
  await redis.expire(redisKeys.teacherActivities(teacherId), 120);
  track(redisKeys.activity(activityId), redisKeys.joinCode(joinCode), redisKeys.activityEvents(activityId), redisKeys.teacherActivities(teacherId));
  return { activityId, joinCode };
}

async function readActivity(activityId: string): Promise<StoredActivity> {
  return JSON.parse((await redis.get(redisKeys.activity(activityId)))!) as StoredActivity;
}

async function readEvents(activityId: string): Promise<StoredEvent[]> {
  const entries = await redis.xRange(redisKeys.activityEvents(activityId), "-", "+");
  return (entries ?? []).map((entry) => JSON.parse(entry.message.payload) as StoredEvent);
}

async function trackRounds(activityId: string) {
  const activity = await readActivity(activityId);
  for (const roundId of Object.values(activity.roundIdsByQuestion ?? {})) {
    track(redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.order(roundId), redisKeys.winner(roundId));
  }
}

describe("activity lifecycle (006)", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  afterEach(async () => {
    mocks.readWorksheet.mockReset();
    if (cleanup.size) await redis.del([...cleanup]);
    cleanup.clear();
  });

  afterAll(async () => { await redis?.quit(); });

  describe("我的課堂活動 (US1)", () => {
    async function importFor(teacherId: string, input: Record<string, unknown> = {}) {
      mocks.readWorksheet.mockResolvedValue(groupTemplateGrid());
      const activity = await importGuidedNotes(teacherId, { spreadsheetId: "sheet-006", sheetId: 1167716485, groupNames: groups, ...input });
      track(redisKeys.activity(activity.activityId), redisKeys.joinCode(activity.joinCode), redisKeys.teacherActivities(teacherId));
      return activity;
    }

    it("records an import for its teacher and lists it with its summary", async () => {
      const teacherId = newTeacher();
      const activity = await importFor(teacherId, { spreadsheetTitle: "Unit 6 Notes" });

      const list = await listTeacherActivities(teacherId);

      expect(list).toEqual([{
        activityId: activity.activityId,
        joinCode: activity.joinCode,
        phase: "ready",
        status: "ongoing",
        title: "Unit 6 Notes",
        questionCount: 4,
        openQuestionCount: 0,
        completedQuestionCount: 0,
        groupCount: 3,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        endedAt: null,
      }]);
      expect(await redis.ttl(redisKeys.teacherActivities(teacherId))).toBeGreaterThan(0);
    });

    it("falls back to the worksheet tab title when the Picker name was not sent", async () => {
      const teacherId = newTeacher();
      await importFor(teacherId);
      expect((await listTeacherActivities(teacherId))[0].title).toBe("學習單");
    });

    it("never lists another teacher's activities", async () => {
      const mine = newTeacher();
      const theirs = newTeacher();
      const own = await importFor(mine);
      const other = await importFor(theirs);
      // Even a foreign id that somehow lands in my index is not shown.
      await redis.zAdd(redisKeys.teacherActivities(mine), { score: Date.now(), value: other.activityId });

      expect((await listTeacherActivities(mine)).map((item) => item.activityId)).toEqual([own.activityId]);
      expect((await listTeacherActivities(theirs)).map((item) => item.activityId)).toEqual([other.activityId]);
    });

    it("lists ongoing activities first, newest first, with live counts", async () => {
      const teacherId = newTeacher();
      const oldOngoing = await seedActivity(teacherId, { createdAt: "2026-11-20T00:00:00.000Z" });
      const newEnded = await seedActivity(teacherId, { createdAt: "2026-11-24T00:00:00.000Z", phase: "ended", endedAt: "2026-11-24T01:00:00.000Z" });
      const newOngoing = await seedActivity(teacherId, { createdAt: "2026-11-23T00:00:00.000Z" });
      await openRounds(newOngoing.activityId, teacherId, ["1", "2"]);
      await trackRounds(newOngoing.activityId);

      const list = await listTeacherActivities(teacherId);

      expect(list.map((item) => item.activityId)).toEqual([newOngoing.activityId, oldOngoing.activityId, newEnded.activityId]);
      expect(list[0]).toMatchObject({ phase: "active", status: "ongoing", openQuestionCount: 2 });
      expect(list[2]).toMatchObject({ status: "ended", endedAt: "2026-11-24T01:00:00.000Z" });
    });

    it("drops activities that have expired from the index", async () => {
      const teacherId = newTeacher();
      const live = await seedActivity(teacherId);
      const expiredId = `lifecycle-expired-${randomUUID()}`;
      await redis.zAdd(redisKeys.teacherActivities(teacherId), { score: Date.now() + 1000, value: expiredId });

      expect((await listTeacherActivities(teacherId)).map((item) => item.activityId)).toEqual([live.activityId]);
      expect(await redis.zScore(redisKeys.teacherActivities(teacherId), expiredId)).toBeNull();
    });

    it("shows at most the 50 newest activities", async () => {
      const teacherId = newTeacher();
      const start = Date.parse("2026-11-01T00:00:00.000Z");
      for (let index = 0; index < 52; index += 1) {
        await seedActivity(teacherId, { createdAt: new Date(start + index * 60_000).toISOString() });
      }
      const list = await listTeacherActivities(teacherId);
      expect(list).toHaveLength(50);
      expect(list[0].createdAt).toBe(new Date(start + 51 * 60_000).toISOString());
    });
  });

  describe("關閉房間 (US2)", () => {
    it("closes every open question and ends the activity in one step", async () => {
      const teacherId = newTeacher();
      const { activityId } = await seedActivity(teacherId);
      const opened = await openRounds(activityId, teacherId, ["1", "2"]);
      await trackRounds(activityId);
      const q1 = opened.rounds.find((round) => round.questionNumber === "1")!;
      await submitAnswer(activityId, q1.roundId, "A", ["answer A"]);

      const result = await closeActivity(activityId, teacherId);

      expect(result).toMatchObject({ phase: "ended", alreadyEnded: false, endedAt: expect.any(String) });
      expect(result.rounds.map((round) => [round.questionNumber, round.winnerGroupId])).toEqual([["1", "A"], ["2", null]]);
      const stored = await readActivity(activityId);
      expect(stored).toMatchObject({ phase: "ended", endedAt: result.endedAt, stateVersion: result.stateVersion });
      expect(stored.openRoundIdsByQuestion).toBeUndefined();
      expect(stored.completedQuestionNumbers).toEqual(expect.arrayContaining(["1", "2"]));
      for (const round of opened.rounds) expect(await redis.hGet(redisKeys.round(round.roundId), "phase")).toBe("closed");

      const events = await readEvents(activityId);
      const tail = events.slice(-3);
      expect(tail.map((event) => event.type)).toEqual(["results.finalized", "results.finalized", "activity.ended"]);
      expect(tail.map((event) => event.stateVersion)).toEqual([result.stateVersion - 2, result.stateVersion - 1, result.stateVersion]);
      expect(tail[2].data).toEqual({ phase: "ended", endedAt: result.endedAt });
    });

    it("closes a room that has no open question", async () => {
      const teacherId = newTeacher();
      const { activityId } = await seedActivity(teacherId);

      const result = await closeActivity(activityId, teacherId);

      expect(result).toMatchObject({ phase: "ended", rounds: [], alreadyEnded: false, stateVersion: 1 });
      expect((await readEvents(activityId)).map((event) => event.type)).toEqual(["activity.ended"]);
    });

    it("is idempotent once the room is closed", async () => {
      const teacherId = newTeacher();
      const { activityId } = await seedActivity(teacherId);
      const first = await closeActivity(activityId, teacherId);
      const eventCount = (await readEvents(activityId)).length;

      const second = await closeActivity(activityId, teacherId);

      expect(second).toEqual({ phase: "ended", endedAt: first.endedAt, rounds: [], stateVersion: first.stateVersion, alreadyEnded: true });
      expect((await readEvents(activityId)).length).toBe(eventCount);
    });

    it("lets only the owner close the room", async () => {
      const teacherId = newTeacher();
      const { activityId } = await seedActivity(teacherId);
      await openRounds(activityId, teacherId, ["1"]);
      await trackRounds(activityId);

      await expect(closeActivity(activityId, newTeacher())).rejects.toMatchObject({ status: 403 });
      expect((await readActivity(activityId)).phase).toBe("active");
      await expect(closeActivity(`lifecycle-missing-${randomUUID()}`, teacherId)).rejects.toMatchObject({ status: 404 });
    });

    it("refuses to end the room when an open question is missing from the script keys", async () => {
      const teacherId = newTeacher();
      const { activityId } = await seedActivity(teacherId);
      await openRounds(activityId, teacherId, ["1"]);
      await trackRounds(activityId);
      const before = await redis.get(redisKeys.activity(activityId));
      const script = await readFile(join(process.cwd(), "src/server/redis/scripts/close-rounds.lua"), "utf8");

      // Simulates a question opened after closeActivity read the open set: no round keys passed.
      const raw = await redis.eval(script, {
        keys: [redisKeys.activity(activityId), redisKeys.activityEvents(activityId)],
        arguments: [teacherId, new Date().toISOString(), "120", "end-activity"],
      });

      expect(JSON.parse(String(raw))).toEqual({ error: "STALE_OPEN_ROUNDS" });
      expect(await redis.get(redisKeys.activity(activityId))).toBe(before);
    });

    it("rejects joining, opening and answering after the room is closed", async () => {
      const teacherId = newTeacher();
      const { activityId, joinCode } = await seedActivity(teacherId);
      const opened = await openRounds(activityId, teacherId, ["1"]);
      await trackRounds(activityId);
      await closeActivity(activityId, teacherId);

      await expect(openRounds(activityId, teacherId, ["2"])).rejects.toMatchObject({ status: 409, message: "活動已關閉，無法再開放題目。" });
      await expect(submitAnswer(activityId, opened.rounds[0].roundId, "B", ["late"])).rejects.toMatchObject({ status: 409, message: "活動已關閉，無法再作答。" });
      await expect(lookupActivityByJoinCode(joinCode)).rejects.toMatchObject({ status: 409, message: "此活動已關閉，無法加入。" });
      await expect(joinActivity(activityId, { joinCode, groupId: "A", displayName: "Late" })).rejects.toMatchObject({ status: 409, message: "此活動已關閉，無法加入。" });
    });

    it("still lets the teacher write back a closed question after the room is closed", async () => {
      const teacherId = newTeacher();
      const { activityId } = await seedActivity(teacherId);
      const opened = await openRounds(activityId, teacherId, ["1"]);
      await trackRounds(activityId);
      const roundId = opened.rounds[0].roundId;
      await submitAnswer(activityId, roundId, "A", ["answer A"]);
      await closeActivity(activityId, teacherId);
      const jobId = `${activityId}:${roundId}`;
      track(redisKeys.writebackJob(jobId), redisKeys.writebackIdempotency(activityId, roundId));

      try {
        await expect(enqueueWriteback(activityId, roundId, teacherId)).resolves.toMatchObject({ jobId, status: "queued" });
      } finally {
        // Remove only this test's entry from the shared job stream.
        const entries = await redis.xRevRange(redisKeys.writebackJobs, "+", "-", { COUNT: 200 });
        const own = (entries ?? []).filter((entry) => entry.message.jobId === jobId).map((entry) => entry.id);
        if (own.length) await redis.xDel(redisKeys.writebackJobs, own);
      }
    });
  });
});
