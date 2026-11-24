import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { GET } from "@/app/api/activities/[activityId]/events/route";
import { signSession } from "@/server/auth/session";
import { redisKeys } from "@/server/redis/keyspace";

const activityId = "sse-load-test";
const teacherId = "sse-load-teacher";
let redis: RedisClientType;

describe("500-client SSE phase fanout", () => {
  beforeAll(async () => {
    process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
    process.env.SESSION_SECRET ??= "integration-test-secret-with-at-least-32-bytes";
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => undefined);
    await redis.connect();
  });

  afterAll(async () => {
    await redis?.del([redisKeys.activity(activityId), redisKeys.activityEvents(activityId)]);
    await redis?.quit();
  });

  it("delivers a phase transition to at least 95% of 500 connected clients within two seconds", async () => {
    await redis.del([redisKeys.activity(activityId), redisKeys.activityEvents(activityId)]);
    await redis.set(redisKeys.activity(activityId), JSON.stringify({
      activityId,
      teacherId,
      phase: "ready",
      stateVersion: 0,
      groupNames: ["Blue", "Red"],
    }), { EX: 60 });
    const cookie = `classroom_session=${signSession({ sub: teacherId, role: "teacher" })}`;
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (let index = 0; index < 500; index += 1) {
        const response = await GET(
          new Request(`http://localhost/api/activities/${activityId}/events`, { headers: { cookie } }),
          { params: Promise.resolve({ activityId }) },
        );
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        readers.push(reader);
        await reader.read();
      }

      await redis.set(redisKeys.activity(activityId), JSON.stringify({
        activityId,
        teacherId,
        phase: "active",
        stateVersion: 1,
        groupNames: ["Blue", "Red"],
      }), { EX: 60 });
      const event = {
        activityId,
        stateVersion: 1,
        type: "phase.changed",
        occurredAt: new Date().toISOString(),
        data: { phase: "open", roundId: "load-round" },
      };
      const startedAt = performance.now();
      await redis.xAdd(redisKeys.activityEvents(activityId), "*", {
        stateVersion: "1",
        payload: JSON.stringify(event),
      });
      const chunks = await Promise.all(readers.map((reader) => reader.read()));
      const elapsedMilliseconds = performance.now() - startedAt;
      const delivered = chunks.filter(({ value }) => value && new TextDecoder().decode(value).includes("event: phase.changed")).length;

      expect(delivered).toBeGreaterThanOrEqual(475);
      expect(elapsedMilliseconds).toBeLessThan(2000);
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel().catch(() => undefined)));
    }
  }, 30_000);
});
