import "server-only";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import type { ImportedActivity } from "@/features/sheets/application/import-guided-notes";
import { applyGuidedNotesWriteback, prepareGuidedNotesWriteback } from "@/features/sheets/application/writeback-guided-notes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";
import {
  readWritebackJob,
  saveExpectedPostFingerprint,
  updateWritebackStatus,
} from "@/server/redis/writeback-queue";
import type { RedisClientType } from "redis";

const consumerGroup = "sheets-writeback";
const maximumAttempts = 5;
const claimIdleMilliseconds = Number(process.env.WRITEBACK_CLAIM_IDLE_MS) || 30_000;

function errorDetails(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof AppError) {
    return {
      code: error.code,
      retryable: error.status === 429 || error.status >= 500,
    };
  }
  return { code: errorCodes.serviceUnavailable, retryable: true };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function processWritebackEntry(
  redis: RedisClientType,
  jobId: string,
  options: { maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<boolean> {
  const job = await readWritebackJob(redis, jobId);
  if (!job) return true;
  if (job.status === "succeeded" || job.status === "failed") return true;

  const attempt = Number(job.attempt) + 1;
  await updateWritebackStatus(redis, job, "running", attempt);
  try {
    const rawActivity = await redis.get(redisKeys.activity(job.activityId));
    if (!rawActivity) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
    const activity = JSON.parse(rawActivity) as ImportedActivity;
    const prepared = await prepareGuidedNotesWriteback(
      activity,
      job.questionNumber,
      job.answer,
      job.expectedPostFingerprint,
    );
    if (!prepared.alreadyWritten) {
      await saveExpectedPostFingerprint(redis, job.jobId, prepared.expectedFingerprint);
      await applyGuidedNotesWriteback(activity, prepared, job.answer);
    }
    await updateWritebackStatus(redis, job, "succeeded", attempt);
    return true;
  } catch (error) {
    const detail = errorDetails(error);
    const maxAttempts = options.maxAttempts ?? maximumAttempts;
    if (detail.retryable && attempt < maxAttempts) {
      const delay = Math.min((options.retryDelayMs ?? 1000) * 2 ** (attempt - 1), 30_000);
      await updateWritebackStatus(redis, job, "retryable", attempt, detail.code);
      await wait(delay);
      return false;
    }
    await updateWritebackStatus(redis, job, "failed", attempt, detail.code);
    return true;
  }
}

async function ensureConsumerGroup(redis: RedisClientType): Promise<void> {
  try {
    await redis.xGroupCreate(redisKeys.writebackJobs, consumerGroup, "0", { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
  }
}

export async function runSheetsWritebackWorker(signal?: AbortSignal): Promise<void> {
  const redis = await getRedisClient();
  await ensureConsumerGroup(redis);
  const consumer = `${hostname()}-${process.pid}-${randomUUID()}`;
  const stream = redisKeys.writebackJobs;

  while (!signal?.aborted) {
    const claimed = await redis.xAutoClaim(stream, consumerGroup, consumer, claimIdleMilliseconds, "0-0", { COUNT: 10 });
    const pending = claimed.messages.filter((message): message is NonNullable<typeof message> => message !== null);
    const streams = pending.length
      ? [{ name: stream, messages: pending }]
      : await redis.xReadGroup(consumerGroup, consumer, [{ key: stream, id: ">" }], { COUNT: 10, BLOCK: 1000 });

    for (const item of streams ?? []) {
      for (const message of item.messages) {
        const jobId = message.message.jobId;
        if (!jobId) {
          console.error("Writeback stream entry has no job id", { streamId: message.id });
          await redis.xAck(stream, consumerGroup, message.id);
          await redis.xDel(stream, message.id);
          continue;
        }
        const shouldAcknowledge = await processWritebackEntry(redis, jobId);
        if (shouldAcknowledge) {
          await redis.xAck(stream, consumerGroup, message.id);
          await redis.xDel(stream, message.id);
        }
      }
    }
  }
}

if (process.env.NODE_ENV !== "test" && process.argv[1]?.includes("sheets-writeback")) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  void runSheetsWritebackWorker(controller.signal).catch((error: unknown) => {
    console.error("Sheets writeback worker failed", { name: error instanceof Error ? error.name : "Error" });
    process.exitCode = 1;
  });
}
