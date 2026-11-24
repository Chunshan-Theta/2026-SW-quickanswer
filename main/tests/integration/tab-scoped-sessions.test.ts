import { randomInt, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { POST as join } from "@/app/api/activities/[activityId]/join/route";
import { POST as submit } from "@/app/api/activities/[activityId]/rounds/[roundId]/submissions/route";
import { POST as close } from "@/app/api/activities/[activityId]/rounds/[roundId]/close/route";
import { GET as events } from "@/app/api/activities/[activityId]/events/route";
import { SEAT_HEADER, withSeat } from "@/lib/session/seat";
import { signSession } from "@/server/auth/session";
import { openRounds } from "@/server/redis/round-store";
import { redisKeys } from "@/server/redis/keyspace";
import { CookieJar } from "../fixtures/cookie-jar";

// Regression for the reported defect: two tabs of ONE browser (one cookie jar, e.g. two
// incognito windows) join teamA and teamB; teamA's tab answers first, then teamB's tab.
// Before 003 the second join overwrote the shared cookie, so teamA's answer was recorded
// as teamB and teamB's own answer was then rejected as a duplicate.

const joinAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let redis: RedisClientType;
let activityId: string;
let teacherId: string;
let joinCode: string;
let roundId: string;

async function joinAs(jar: CookieJar, groupId: string): Promise<string> {
  const response = await join(new Request(`http://localhost/api/activities/${activityId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar.header() },
    body: JSON.stringify({ joinCode, groupId, displayName: `${groupId} student` }),
  }), { params: Promise.resolve({ activityId }) });
  expect(response.status).toBe(200);
  jar.store(response);
  const body = await response.json() as { groupId: string; seatId: string };
  expect(body.groupId).toBe(groupId);
  return body.seatId;
}

function submitAs(jar: CookieJar, seat: string, answer: string) {
  return submit(new Request(`http://localhost/api/activities/${activityId}/rounds/${roundId}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jar.header(), [SEAT_HEADER]: seat },
    body: JSON.stringify({ answers: [answer], requestId: randomUUID() }),
  }), { params: Promise.resolve({ activityId, roundId }) });
}

async function firstSnapshot(jar: CookieJar, seat: string): Promise<string> {
  const response = await events(new Request(withSeat(`http://localhost/api/activities/${activityId}/events`, seat), {
    headers: { cookie: jar.header() },
  }), { params: Promise.resolve({ activityId }) });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(first.value);
}

describe("tab-scoped sessions: one browser, several groups", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.SESSION_SECRET ??= "integration-test-secret-with-at-least-32-bytes";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  beforeEach(async () => {
    activityId = `tab-seat-${randomUUID()}`;
    teacherId = `teacher-${randomUUID()}`;
    joinCode = Array.from({ length: 6 }, () => joinAlphabet[randomInt(joinAlphabet.length)]).join("");
    await redis.set(redisKeys.activity(activityId), JSON.stringify({
      activityId,
      teacherId,
      joinCode,
      phase: "ready",
      stateVersion: 0,
      groupNames: ["teamA", "teamB"],
      questions: [{ questionNumber: "1", prompt: "Name the process.", kind: "single", mappingStatus: "confirmed" }],
    }), { EX: 60 });
    await redis.set(redisKeys.joinCode(joinCode), activityId, { EX: 60 });
    roundId = (await openRounds(activityId, teacherId, ["1"])).rounds[0].roundId;
  });

  afterEach(async () => {
    await redis.del([
      redisKeys.activity(activityId),
      redisKeys.joinCode(joinCode),
      redisKeys.activityEvents(activityId),
      redisKeys.round(roundId),
      redisKeys.submissions(roundId),
      redisKeys.order(roundId),
      redisKeys.winner(roundId),
    ]);
  });

  afterAll(async () => { await redis?.quit(); });

  it("records each tab's answer under its own group (reported scenario)", async () => {
    const browser = new CookieJar();
    const seatA = await joinAs(browser, "teamA");
    const seatB = await joinAs(browser, "teamB");
    expect(seatA).not.toBe(seatB);

    const answerA = await submitAs(browser, seatA, "teamA answer");
    expect(answerA.status).toBe(201);
    expect(await answerA.json()).toMatchObject({ groupId: "teamA", acceptedOrder: 1 });

    const answerB = await submitAs(browser, seatB, "teamB answer");
    expect(answerB.status).toBe(201);
    expect(await answerB.json()).toMatchObject({ groupId: "teamB", acceptedOrder: 2 });

    const stored = await redis.hGetAll(redisKeys.submissions(roundId));
    expect(JSON.parse(stored.teamA)).toMatchObject({ groupId: "teamA", answers: ["teamA answer"], acceptedOrder: 1 });
    expect(JSON.parse(stored.teamB)).toMatchObject({ groupId: "teamB", answers: ["teamB answer"], acceptedOrder: 2 });
  });

  it("streams each tab only its own group's receipt while the round is open", async () => {
    const browser = new CookieJar();
    const seatA = await joinAs(browser, "teamA");
    const seatB = await joinAs(browser, "teamB");
    expect((await submitAs(browser, seatA, "teamA answer")).status).toBe(201);
    expect((await submitAs(browser, seatB, "teamB answer")).status).toBe(201);

    const streamA = await firstSnapshot(browser, seatA);
    expect(streamA).toContain("teamA answer");
    expect(streamA).not.toContain("teamB answer");
    const streamB = await firstSnapshot(browser, seatB);
    expect(streamB).toContain("teamB answer");
    expect(streamB).not.toContain("teamA answer");
  });

  it("keeps the teacher signed in when students join from the same browser", async () => {
    const browser = new CookieJar();
    browser.set("qa_teacher", signSession({ sub: teacherId, role: "teacher" }));
    const seatA = await joinAs(browser, "teamA");
    await joinAs(browser, "teamB");
    expect(browser.has("qa_teacher")).toBe(true);
    expect((await submitAs(browser, seatA, "teamA answer")).status).toBe(201);

    const closed = await close(new Request(`http://localhost/api/activities/${activityId}/rounds/${roundId}/close`, {
      method: "POST",
      headers: { cookie: browser.header() },
    }), { params: Promise.resolve({ activityId, roundId }) });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ phase: "closed", winnerGroupId: "teamA" });
  });
});
