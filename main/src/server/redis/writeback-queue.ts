import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RedisClientType } from "redis";
import { errorCodes } from "@/lib/errors/error-codes";
import { AppError } from "@/server/http/errors";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

export type WritebackStatus = "queued" | "running" | "retryable" | "succeeded" | "failed";
export type WritebackJob = {
  jobId: string;
  activityId: string;
  roundId: string;
  teacherId: string;
  questionNumber: string;
  winnerGroupId: string;
  answer: string;
  status: WritebackStatus;
  attempt: string;
  expectedPostFingerprint?: string;
  errorCode?: string;
};

const scriptCache = new Map<string, Promise<string>>();
function script(name: string): Promise<string> {
  let value = scriptCache.get(name);
  if (!value) {
    value = readFile(join(process.cwd(), "src/server/redis/scripts", name), "utf8");
    scriptCache.set(name, value);
  }
  return value;
}

function decodeResult<T>(raw: string): T {
  const result = JSON.parse(raw) as T & { error?: string };
  if (result.error) {
    const status = result.error === "NOT_FOUND" ? 404 : result.error === "FORBIDDEN" ? 403 : 409;
    const message = result.error === "NOT_FOUND" ? "找不到課堂活動。" : result.error === "FORBIDDEN" ? "沒有權限執行此操作。" : result.error === "NO_WINNER" ? "本題沒有得獎答案可回填。" : result.error === "JOB_NOT_FOUND" ? "找不到回填工作。" : "回填僅能在已結束的搶答回合執行。";
    const code = status === 404 ? errorCodes.notFound : status === 403 ? errorCodes.forbidden : errorCodes.conflict;
    throw new AppError(status, code, message);
  }
  return result;
}

export async function enqueueWriteback(activityId: string, roundId: string, teacherId: string) {
  const redis = await getRedisClient();
  const jobId = `${activityId}:${roundId}`;
  const raw = await redis.eval(await script("enqueue-writeback.lua"), {
    keys: [
      redisKeys.activity(activityId),
      redisKeys.round(roundId),
      redisKeys.submissions(roundId),
      redisKeys.writebackIdempotency(activityId, roundId),
      redisKeys.writebackJob(jobId),
      redisKeys.writebackJobs,
      redisKeys.activityEvents(activityId),
    ],
    arguments: [
      teacherId,
      roundId,
      activityId,
      jobId,
      new Date().toISOString(),
      String(Number(process.env.ACTIVITY_TTL_SECONDS) || 604800),
    ],
  });
  return decodeResult<{ jobId: string; status: WritebackStatus; existing: boolean }>(String(raw));
}

export async function getWritebackStatus(activityId: string, roundId: string, teacherId: string) {
  const redis = await getRedisClient();
  const rawActivity = await redis.get(redisKeys.activity(activityId));
  if (!rawActivity) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(rawActivity) as { teacherId?: string };
  if (activity.teacherId !== teacherId) throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  const jobId = `${activityId}:${roundId}`;
  const job = await redis.hGetAll(redisKeys.writebackJob(jobId));
  if (!job.jobId) return null;
  return {
    jobId,
    status: job.status as WritebackStatus,
    attempt: Number(job.attempt) || 0,
    errorCode: job.errorCode || null,
  };
}

export async function readWritebackJob(redis: RedisClientType, jobId: string): Promise<WritebackJob | null> {
  const job = await redis.hGetAll(redisKeys.writebackJob(jobId));
  return job.jobId ? job as WritebackJob : null;
}

export async function saveExpectedPostFingerprint(redis: RedisClientType, jobId: string, fingerprint: string): Promise<void> {
  await redis.hSet(redisKeys.writebackJob(jobId), "expectedPostFingerprint", fingerprint);
}

export async function updateWritebackStatus(
  redis: RedisClientType,
  job: WritebackJob,
  status: WritebackStatus,
  attempt: number,
  errorCode = "",
): Promise<void> {
  const result = await redis.eval(await script("update-writeback-status.lua"), {
    keys: [
      redisKeys.activity(job.activityId),
      redisKeys.writebackJob(job.jobId),
      redisKeys.activityEvents(job.activityId),
    ],
    arguments: [status, String(attempt), new Date().toISOString(), errorCode],
  });
  decodeResult<{ jobId: string; status: WritebackStatus; attempt: number }>(String(result));
}
