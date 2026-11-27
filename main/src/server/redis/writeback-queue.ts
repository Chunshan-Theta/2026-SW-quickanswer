import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RedisClientType } from "redis";
import { errorCodes } from "@/lib/errors/error-codes";
import type { WritebackSelectionInput } from "@/lib/validation/schemas";
import { parseAdoptedAnswer, type AdoptedAnswerSnapshot } from "@/features/activities/domain/snapshot";
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
  /** Fastest group of the round (kept for traceability; the adopted answer may be another). */
  winnerGroupId: string;
  /** Display text of the adopted answer. */
  answer: string;
  /** JSON-encoded string[]: one answer per blank (absent on jobs queued before 002). */
  answers?: string;
  /** 005: where the adopted answer came from (absent on older jobs = fastest group). */
  adoptedSource?: "group" | "teacher";
  adoptedGroupId?: string;
  /** 005: JSON string[] the last successful writeback left in the cells ("" when none). */
  previousAnswers?: string;
  /** 005: incremented every time the job is queued with a new selection or retried. */
  revision?: string;
  /** 005: `source\ngroupId\nJSON(answers)`; equal keys mean the same selection (idempotent). */
  selectionKey?: string;
  status: WritebackStatus;
  attempt: string;
  errorCode?: string;
};

type EnqueueResult = { jobId: string; status: WritebackStatus; existing: boolean; revision: number; adopted: AdoptedAnswerSnapshot };

const scriptErrors: Record<string, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "找不到課堂活動。" },
  FORBIDDEN: { status: 403, message: "沒有權限執行此操作。" },
  JOB_NOT_FOUND: { status: 404, message: "找不到回填工作。" },
  NO_WINNER: { status: 409, message: "本題沒有得獎答案可回填。" },
  GROUP_NOT_ANSWERED: { status: 409, message: "所選組別沒有在本題作答。" },
  INCOMPLETE_ANSWERS: { status: 409, message: "請填寫所有子題的正確答案。" },
  WRITEBACK_IN_PROGRESS: { status: 409, message: "目前回填處理中，請等待完成後再改選答案。" },
  INVALID_SELECTION: { status: 422, message: "無效的回填請求。" },
  ROUND_NOT_CLOSED: { status: 409, message: "回填僅能在已結束的搶答回合執行。" },
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
    const { status, message } = scriptErrors[result.error] ?? scriptErrors.ROUND_NOT_CLOSED;
    const code = status === 404 ? errorCodes.notFound : status === 403 ? errorCodes.forbidden : status === 422 ? errorCodes.invalidInput : errorCodes.conflict;
    throw new AppError(status, code, message);
  }
  return result;
}

/**
 * Queues the writeback of a closed question with the teacher's selection (005); without a
 * selection the fastest group's answer is written, as before.
 */
export async function enqueueWriteback(activityId: string, roundId: string, teacherId: string, selection?: WritebackSelectionInput) {
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
      selection ? JSON.stringify(selection) : "",
    ],
  });
  return decodeResult<EnqueueResult>(String(raw));
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
    revision: Number(job.revision) || 1,
    adopted: parseAdoptedAnswer(job),
  };
}

export async function readWritebackJob(redis: RedisClientType, jobId: string): Promise<WritebackJob | null> {
  const job = await redis.hGetAll(redisKeys.writebackJob(jobId));
  return job.jobId ? job as WritebackJob : null;
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
      redisKeys.round(job.roundId),
    ],
    arguments: [status, String(attempt), new Date().toISOString(), errorCode],
  });
  decodeResult<{ jobId: string; status: WritebackStatus; attempt: number }>(String(result));
}
