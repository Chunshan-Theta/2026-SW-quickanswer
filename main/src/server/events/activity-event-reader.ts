import "server-only";
import type { RedisClientType } from "redis";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";
import type { ActivityEvent } from "@/features/activities/domain/types";

type Listener = (event: ActivityEvent | null) => void;
type ReaderState = { client: RedisClientType; listeners: Set<Listener>; stopped: boolean; loop: Promise<void> };
const readers = new Map<string, ReaderState>();

function decodeEvent(message: { message: Record<string, string> }): ActivityEvent | null {
  try {
    const parsed: unknown = JSON.parse(message.message.payload ?? "");
    if (
      typeof parsed !== "object" ||
      !parsed ||
      !("stateVersion" in parsed) ||
      !("type" in parsed) ||
      !("activityId" in parsed) ||
      typeof parsed.stateVersion !== "number" ||
      typeof parsed.type !== "string" ||
      typeof parsed.activityId !== "string"
    ) return null;
    return parsed as ActivityEvent;
  } catch {
    return null;
  }
}

export type EventReplay = { available: true; events: ActivityEvent[]; latestVersion: number } | { available: false };

export async function replayActivityEvents(activityId: string, lastVersion: number): Promise<EventReplay> {
  const redis = await getRedisClient();
  const entries = (await redis.xRange(redisKeys.activityEvents(activityId), "-", "+", { COUNT: 1001 })) ?? [];
  if (entries.length > 1000) return { available: false };

  const events = entries.map((entry) => decodeEvent(entry));
  if (events.some((event) => !event || event.activityId !== activityId)) return { available: false };
  const retained = events as ActivityEvent[];
  const latestVersion = retained.at(-1)?.stateVersion ?? 0;
  if (!Number.isSafeInteger(lastVersion) || lastVersion < 0 || lastVersion > latestVersion) {
    return { available: false };
  }
  if (lastVersion === latestVersion) return { available: true, events: [], latestVersion };

  const replay = retained.filter((event) => event.stateVersion > lastVersion);
  if (!replay.length || replay[0].stateVersion !== lastVersion + 1) return { available: false };
  for (let index = 1; index < replay.length; index += 1) {
    if (replay[index].stateVersion !== replay[index - 1].stateVersion + 1) {
      return { available: false };
    }
  }
  return { available: true, events: replay, latestVersion };
}

async function createReader(activityId: string): Promise<ReaderState> {
  const base = await getRedisClient();
  const client = base.duplicate();
  client.on("error", (error) => console.error("Redis event reader error", { name: error.name, activityId }));
  await client.connect();
  const state: ReaderState = { client, listeners: new Set(), stopped: false, loop: Promise.resolve() };
  state.loop = readLoop(activityId, state);
  return state;
}

async function readLoop(activityId: string, state: ReaderState): Promise<void> {
  const key = redisKeys.activityEvents(activityId);
  let cursor = "0-0";
  let lastVersion = 0;
  try {
    const latest = await state.client.xRevRange(key, "+", "-", { COUNT: 1 });
    if (latest?.length) {
      cursor = latest[0].id;
      lastVersion = decodeEvent(latest[0])?.stateVersion ?? 0;
    }
    while (!state.stopped) {
      const streams = await state.client.xRead([{ key, id: cursor }], { BLOCK: 1000, COUNT: 100 });
      for (const stream of streams ?? []) {
        for (const message of stream.messages) {
          cursor = message.id;
          const event = decodeEvent(message);
          if (!event || event.activityId !== activityId || event.stateVersion !== lastVersion + 1) {
            for (const listener of [...state.listeners]) listener(null);
            if (event && event.activityId === activityId && event.stateVersion > lastVersion) lastVersion = event.stateVersion;
            continue;
          }
          lastVersion = event.stateVersion;
          for (const listener of [...state.listeners]) listener(event);
        }
      }
    }
  } catch (error) {
    if (!state.stopped) console.error("Redis event stream stopped", { activityId, name: error instanceof Error ? error.name : "Error" });
  } finally {
    state.stopped = true;
    await state.client.quit().catch(() => undefined);
    if (readers.get(activityId) === state) readers.delete(activityId);
  }
}

export async function subscribeToActivityEvents(activityId: string, listener: Listener): Promise<() => void> {
  let state = readers.get(activityId);
  if (!state || state.stopped) {
    state = await createReader(activityId);
    readers.set(activityId, state);
  }
  state.listeners.add(listener);
  const current = state;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && !current.stopped) {
      current.stopped = true;
      void current.client.quit().catch(() => undefined);
    }
  };
}
