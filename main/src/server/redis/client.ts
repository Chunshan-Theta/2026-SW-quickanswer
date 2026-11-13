import "server-only";
import { createClient, type RedisClientType } from "redis";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";

type RedisState = {
  client: RedisClientType;
  connected: Promise<void>;
};

type RedisGlobal = typeof globalThis & { __classroomRedis?: RedisState };

export async function getRedisClient(): Promise<RedisClientType> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new AppError(503, errorCodes.serviceUnavailable, "Redis 尚未設定。請先設定 REDIS_URL。");
  }

  const global = globalThis as RedisGlobal;
  let state = global.__classroomRedis;
  if (!state) {
    const client = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 2_000),
      },
    });
    client.on("error", (error) => {
      console.error("Redis connection error", { name: error.name });
    });
    state = { client, connected: client.connect().then(() => undefined) };
    global.__classroomRedis = state;
  }

  try {
    await state.connected;
    return state.client;
  } catch {
    if (global.__classroomRedis === state) global.__classroomRedis = undefined;
    throw new AppError(503, errorCodes.serviceUnavailable, "目前無法連線至活動資料服務。");
  }
}
