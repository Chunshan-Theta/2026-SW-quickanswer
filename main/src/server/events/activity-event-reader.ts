import "server-only";
import type { RedisClientType } from "redis";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";
import type { ActivityEvent } from "@/features/activities/domain/types";

type Listener = (event: ActivityEvent) => void;
type ReaderState = { client: RedisClientType; listeners: Set<Listener>; stopped: boolean; loop: Promise<void> };
const readers = new Map<string, ReaderState>();

function decodeEvent(message: { message: Record<string, string> }): ActivityEvent | null {
  try {
    const parsed: unknown = JSON.parse(message.message.payload ?? "");
    if (typeof parsed !== "object" || !parsed || !("stateVersion" in parsed) || !("type" in parsed)) return null;
    return parsed as ActivityEvent;
  } catch {
    return null;
  }
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
  try {
    const latest = await state.client.xRevRange(key, "+", "-", { COUNT: 1 });
    if (latest?.length) cursor = latest[0].id;
    while (!state.stopped) {
      const streams = await state.client.xRead([{ key, id: cursor }], { BLOCK: 1000, COUNT: 100 });
      for (const stream of streams ?? []) {
        for (const message of stream.messages) {
          cursor = message.id;
          const event = decodeEvent(message);
          if (event) for (const listener of [...state.listeners]) listener(event);
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
