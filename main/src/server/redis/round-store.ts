import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

export type RoundBlank = { label: string | null; prompt: string };

const ttlSeconds = () => Number(process.env.ACTIVITY_TTL_SECONDS) || 604800;
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
    const status = result.error === "NOT_FOUND" ? 404 : result.error === "FORBIDDEN" ? 403 : result.error === "GROUP_NOT_FOUND" || result.error === "QUESTION_NOT_FOUND" || result.error === "MAPPING_NOT_CONFIRMED" || result.error === "INCOMPLETE_ANSWERS" ? 422 : 409;
    const message = result.error === "NOT_FOUND" ? "找不到課堂活動。" : result.error === "FORBIDDEN" ? "沒有權限執行此操作。" : result.error === "GROUP_NOT_FOUND" ? "組別不存在。" : result.error === "QUESTION_NOT_FOUND" ? "題目不存在。" : result.error === "QUESTION_ALREADY_COMPLETED" ? "此題已完成，無法再次開啟。" : result.error === "MAPPING_NOT_CONFIRMED" ? "題目答案空格尚未確認。" : result.error === "INCOMPLETE_ANSWERS" ? "請填寫所有子題的答案。" : result.error === "DUPLICATE_SUBMISSION" ? "此組已提交答案。" : result.error === "ROUND_ALREADY_OPEN" ? "目前已有題目正在搶答。" : "此搶答回合已結束。";
    const code = status === 404 ? errorCodes.notFound : status === 403 ? errorCodes.forbidden : status === 422 ? errorCodes.invalidInput : errorCodes.conflict;
    throw new AppError(status, code, message);
  }
  return result;
}

export async function openRound(activityId: string, teacherId: string, questionNumber: string) {
  const redis = await getRedisClient();
  const roundId = randomUUID();
  const raw = await redis.eval(await script("open-round.lua"), {
    keys: [redisKeys.activity(activityId), redisKeys.round(roundId), redisKeys.activityEvents(activityId)],
    arguments: [teacherId, roundId, questionNumber, new Date().toISOString(), String(ttlSeconds())],
  });
  return decodeResult<{ roundId: string; questionNumber: string; prompt: string; kind: "single" | "group"; blanks: RoundBlank[]; phase: "open"; stateVersion: number }>(String(raw));
}

export async function submitAnswer(activityId: string, roundId: string, groupId: string, answers: string[]) {
  const redis = await getRedisClient();
  const raw = await redis.eval(await script("submit-answer.lua"), {
    keys: [redisKeys.activity(activityId), redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.order(roundId), redisKeys.winner(roundId), redisKeys.activityEvents(activityId)],
    arguments: [roundId, groupId, JSON.stringify(answers.map((answer) => answer.trim())), new Date().toISOString(), String(ttlSeconds())],
  });
  return decodeResult<{ groupId: string; answer: string; answers: string[]; acceptedOrder: number; acceptedAt: string; winnerGroupId: string; stateVersion: number }>(String(raw));
}

export async function closeRound(activityId: string, roundId: string, teacherId: string) {
  const redis = await getRedisClient();
  const raw = await redis.eval(await script("close-round.lua"), {
    keys: [redisKeys.activity(activityId), redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.order(roundId), redisKeys.winner(roundId), redisKeys.activityEvents(activityId)],
    arguments: [teacherId, roundId, new Date().toISOString(), String(ttlSeconds())],
  });
  return decodeResult<{ phase: "closed"; roundId: string; questionNumber: string; winnerGroupId: string | null; submissions: Array<{ groupId: string; answer: string; answers?: string[]; acceptedOrder: number; acceptedAt: string }>; stateVersion: number }>(String(raw));
}
