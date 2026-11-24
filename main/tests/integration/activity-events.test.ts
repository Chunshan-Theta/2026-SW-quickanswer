import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { GET } from "@/app/api/activities/[activityId]/events/route";
import { signSession } from "@/server/auth/session";
import { redisKeys } from "@/server/redis/keyspace";

// Unique per run so parallel test runs sharing one Redis never collide.
const activityId = `event-privacy-test-${randomUUID()}`;
const teacherId = "teacher-event-test";
const roundId = `round-event-open-${randomUUID()}`;
const closedRoundId = `round-event-closed-${randomUUID()}`;
let redis: RedisClientType;

async function readSnapshot(role: "teacher" | "student", groupId?: string) {
  const cookie = signSession({ sub: role === "teacher" ? teacherId : "student-event-test", role, activityId, ...(groupId ? { groupId } : {}) });
  const response = await GET(new Request(`http://localhost/api/activities/${activityId}/events`, { headers: { cookie: `classroom_session=${cookie}` } }), { params: Promise.resolve({ activityId }) });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(first.value).split("data: ")[1].trim();
}

describe("activity SSE privacy and reconnect snapshots", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.SESSION_SECRET ??= "integration-test-secret-with-at-least-32-bytes";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  beforeEach(async () => {
    const keys = [roundId, closedRoundId].flatMap((id) => [redisKeys.round(id), redisKeys.submissions(id)]);
    await redis.del([redisKeys.activity(activityId), redisKeys.activityEvents(activityId), ...keys]);
    // Question 2 is still open while question 1 has already closed.
    await redis.set(redisKeys.activity(activityId), JSON.stringify({
      activityId, teacherId, phase: "active", stateVersion: 4, groupNames: ["Blue", "Red"],
      roundIdsByQuestion: { 1: closedRoundId, 2: roundId },
      openRoundIdsByQuestion: { 2: roundId },
      completedQuestionNumbers: ["1"],
    }), { EX: 60 });
    await redis.hSet(redisKeys.round(roundId), { activityId, phase: "open", questionNumber: "2", prompt: "Question?", openedAt: "t0", stateVersion: "4" });
    await redis.hSet(redisKeys.submissions(roundId), {
      Blue: JSON.stringify({ groupId: "Blue", answer: "blue answer", acceptedOrder: 1, acceptedAt: "t1" }),
      Red: JSON.stringify({ groupId: "Red", answer: "red answer", acceptedOrder: 2, acceptedAt: "t2" }),
    });
    await redis.hSet(redisKeys.round(closedRoundId), { activityId, phase: "closed", questionNumber: "1", prompt: "Earlier?", winnerGroupId: "Red", openedAt: "t0", closedAt: "t3", stateVersion: "3" });
    await redis.hSet(redisKeys.submissions(closedRoundId), {
      Red: JSON.stringify({ groupId: "Red", answer: "red earlier", acceptedOrder: 1, acceptedAt: "t1" }),
      Blue: JSON.stringify({ groupId: "Blue", answer: "blue earlier", acceptedOrder: 2, acceptedAt: "t2" }),
    });
    for (const key of keys) await redis.expire(key, 60);
  });

  afterAll(async () => {
    await redis?.del([redisKeys.activity(activityId), ...[roundId, closedRoundId].flatMap((id) => [redisKeys.round(id), redisKeys.submissions(id)])]);
    await redis?.quit();
  });

  it("includes every round with all live submissions for the teacher snapshot", async () => {
    const snapshot = JSON.parse(await readSnapshot("teacher"));
    expect(snapshot.rounds.map((round: { questionNumber: string; phase: string }) => [round.questionNumber, round.phase])).toEqual([["1", "closed"], ["2", "open"]]);
    expect(snapshot.rounds[1].submissions).toHaveLength(2);
    expect(snapshot.rounds[1].openedAt).toBe("t0");
    expect(snapshot.rounds[0]).toMatchObject({ winnerGroupId: "Red", closedAt: "t3" });
  });

  it("shows a student only their own answer in open rounds but every answer in closed rounds", async () => {
    const snapshot = JSON.parse(await readSnapshot("student", "Blue"));
    expect(snapshot.rounds[1].submissions).toEqual([
      { groupId: "Blue", answer: "blue answer", acceptedOrder: 1, acceptedAt: "t1" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("red answer");
    expect(snapshot.rounds[0].submissions.map((submission: { answer: string }) => submission.answer)).toEqual(["red earlier", "blue earlier"]);
  });
});
