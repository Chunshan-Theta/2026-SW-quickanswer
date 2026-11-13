import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { GET } from "@/app/api/activities/[activityId]/events/route";
import { signSession } from "@/server/auth/session";
import { redisKeys } from "@/server/redis/keyspace";

const activityId = "event-privacy-test";
const teacherId = "teacher-event-test";
const roundId = "round-event-test";
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
    await redis.del([redisKeys.activity(activityId), redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.activityEvents(activityId)]);
    await redis.set(redisKeys.activity(activityId), JSON.stringify({
      activityId, teacherId, phase: "active", stateVersion: 4, currentRoundId: roundId, groupNames: ["Blue", "Red"],
    }));
    await redis.hSet(redisKeys.round(roundId), { phase: "open", questionNumber: "1", prompt: "Question?", stateVersion: "4" });
    await redis.hSet(redisKeys.submissions(roundId), {
      Blue: JSON.stringify({ groupId: "Blue", answer: "blue answer", acceptedOrder: 1, acceptedAt: "t1" }),
      Red: JSON.stringify({ groupId: "Red", answer: "red answer", acceptedOrder: 2, acceptedAt: "t2" }),
    });
  });

  afterAll(async () => { await redis?.quit(); });

  it("includes live submissions for the teacher snapshot", async () => {
    const snapshot = JSON.parse(await readSnapshot("teacher"));
    expect(snapshot.currentRound.submissions).toHaveLength(2);
  });

  it("includes only the session-bound group's answer in an open-round student snapshot", async () => {
    const snapshot = JSON.parse(await readSnapshot("student", "Blue"));
    expect(snapshot.currentRound.submissions).toEqual([
      { groupId: "Blue", answer: "blue answer", acceptedOrder: 1, acceptedAt: "t1" },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("red answer");
  });
});
