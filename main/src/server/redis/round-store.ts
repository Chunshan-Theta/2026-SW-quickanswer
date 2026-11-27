import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

export type RoundBlank = { label: string | null; prompt: string };
export type RoundSubmission = { groupId: string; answer: string; answers?: string[]; acceptedOrder: number; acceptedAt: string };
export type OpenedRound = { roundId: string; questionNumber: string; prompt: string; kind: "single" | "group"; blanks: RoundBlank[]; phase: "open"; openedAt: string; stateVersion: number };
export type ClosedRound = { phase: "closed"; roundId: string; questionNumber: string; winnerGroupId: string | null; submissions: RoundSubmission[]; closedAt: string; stateVersion: number };
export type ClosedActivity = { phase: "ended"; endedAt: string | null; rounds: ClosedRound[]; stateVersion: number; alreadyEnded: boolean };

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

type ScriptError = { status: 403 | 404 | 409 | 422; message: (questionNumber?: string) => string };
const scriptErrors: Record<string, ScriptError> = {
  NOT_FOUND: { status: 404, message: () => "找不到課堂活動。" },
  FORBIDDEN: { status: 403, message: () => "沒有權限執行此操作。" },
  GROUP_NOT_FOUND: { status: 422, message: () => "組別不存在。" },
  QUESTION_NOT_FOUND: { status: 422, message: (number) => `找不到第 ${number} 題。` },
  DUPLICATE_QUESTION: { status: 422, message: (number) => `第 ${number} 題重複選取。` },
  MAPPING_NOT_CONFIRMED: { status: 422, message: (number) => number ? `第 ${number} 題的答案空格尚未確認。` : "題目答案空格尚未確認。" },
  INCOMPLETE_ANSWERS: { status: 422, message: () => "請填寫所有子題的答案。" },
  INVALID_REQUEST: { status: 422, message: () => "請選擇有效題號。" },
  QUESTION_ALREADY_OPEN: { status: 409, message: (number) => `第 ${number} 題已在搶答中。` },
  QUESTION_ALREADY_COMPLETED: { status: 409, message: (number) => `第 ${number} 題已完成，無法再次開啟。` },
  DUPLICATE_SUBMISSION: { status: 409, message: () => "此組已提交答案。" },
  NO_OPEN_ROUNDS: { status: 409, message: () => "目前沒有開放中的題目。" },
  CONFLICT: { status: 409, message: () => "活動目前無法開放題目。" },
  ACTIVITY_ENDED: { status: 409, message: () => "活動已關閉，無法再開放題目。" },
  ACTIVITY_ENDED_SUBMIT: { status: 409, message: () => "活動已關閉，無法再作答。" },
  STALE_OPEN_ROUNDS: { status: 409, message: () => "活動狀態變更中，請重試。" },
  ROUND_CLOSED: { status: 409, message: () => "此搶答回合已結束。" },
};

function scriptFailure(error: string, questionNumber?: string): AppError {
  const known = scriptErrors[error] ?? scriptErrors.ROUND_CLOSED;
  const code = known.status === 404 ? errorCodes.notFound : known.status === 403 ? errorCodes.forbidden : known.status === 422 ? errorCodes.invalidInput : errorCodes.conflict;
  return new AppError(known.status, code, known.message(questionNumber));
}

function decodeResult<T>(raw: string): T {
  const result = JSON.parse(raw) as T & { error?: string; questionNumber?: string };
  if (result.error) throw scriptFailure(result.error, result.questionNumber);
  return result;
}

/** Opens every listed question at once, or none of them when any cannot be opened. */
export async function openRounds(activityId: string, teacherId: string, questionNumbers: string[]) {
  const redis = await getRedisClient();
  const requested = questionNumbers.map((questionNumber) => ({ questionNumber, roundId: randomUUID() }));
  const raw = await redis.eval(await script("open-rounds.lua"), {
    keys: [redisKeys.activity(activityId), redisKeys.activityEvents(activityId), ...requested.map((item) => redisKeys.round(item.roundId))],
    arguments: [teacherId, new Date().toISOString(), String(ttlSeconds()), JSON.stringify(requested)],
  });
  return decodeResult<{ rounds: OpenedRound[]; stateVersion: number }>(String(raw));
}

export async function submitAnswer(activityId: string, roundId: string, groupId: string, answers: string[]) {
  const redis = await getRedisClient();
  const raw = await redis.eval(await script("submit-answer.lua"), {
    keys: [redisKeys.activity(activityId), redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.order(roundId), redisKeys.winner(roundId), redisKeys.activityEvents(activityId)],
    arguments: [roundId, groupId, JSON.stringify(answers.map((answer) => answer.trim())), new Date().toISOString(), String(ttlSeconds())],
  });
  return decodeResult<{ groupId: string; answer: string; answers: string[]; acceptedOrder: number; acceptedAt: string; winnerGroupId: string; stateVersion: number }>(String(raw));
}

async function evalCloseRounds(activityId: string, teacherId: string, roundIds: string[], mode: "strict" | "open-only" | "end-activity"): Promise<string> {
  const redis = await getRedisClient();
  const raw = await redis.eval(await script("close-rounds.lua"), {
    keys: [
      redisKeys.activity(activityId),
      redisKeys.activityEvents(activityId),
      ...roundIds.flatMap((roundId) => [redisKeys.round(roundId), redisKeys.submissions(roundId), redisKeys.order(roundId), redisKeys.winner(roundId)]),
    ],
    arguments: [teacherId, new Date().toISOString(), String(ttlSeconds()), mode, ...roundIds],
  });
  return String(raw);
}

async function closeRounds(activityId: string, teacherId: string, roundIds: string[], mode: "strict" | "open-only") {
  return decodeResult<{ rounds: ClosedRound[]; stateVersion: number }>(await evalCloseRounds(activityId, teacherId, roundIds, mode));
}

/** Open round ids of the activity, after checking that it exists and belongs to the teacher. */
async function readOpenRoundIds(activityId: string, teacherId: string): Promise<string[]> {
  const redis = await getRedisClient();
  const raw = await redis.get(redisKeys.activity(activityId));
  if (!raw) throw scriptFailure("NOT_FOUND");
  const activity = JSON.parse(raw) as { teacherId?: string; openRoundIdsByQuestion?: unknown };
  if (activity.teacherId !== teacherId) throw scriptFailure("FORBIDDEN");
  return activity.openRoundIdsByQuestion && typeof activity.openRoundIdsByQuestion === "object" && !Array.isArray(activity.openRoundIdsByQuestion)
    ? Object.values(activity.openRoundIdsByQuestion as Record<string, string>)
    : [];
}

/** Closes one open round; other open rounds are not affected. */
export async function closeRound(activityId: string, roundId: string, teacherId: string): Promise<ClosedRound> {
  return (await closeRounds(activityId, teacherId, [roundId], "strict")).rounds[0];
}

/**
 * Closes every round open when the request arrives. The open round ids are read first so the
 * script can declare its keys; the script re-checks each round and skips any closed meanwhile.
 */
export async function closeAllOpenRounds(activityId: string, teacherId: string) {
  const openRoundIds = await readOpenRoundIds(activityId, teacherId);
  if (openRoundIds.length === 0) throw scriptFailure("NO_OPEN_ROUNDS");
  return closeRounds(activityId, teacherId, openRoundIds, "open-only");
}

/**
 * 關閉房間 (006): closes every open round and ends the activity in one script. Idempotent for an
 * ended activity. If a question is opened between reading the open set and the script, the script
 * writes nothing and reports STALE_OPEN_ROUNDS; the read is repeated a few times.
 */
export async function closeActivity(activityId: string, teacherId: string): Promise<ClosedActivity> {
  for (let attempt = 1; ; attempt += 1) {
    const raw = await evalCloseRounds(activityId, teacherId, await readOpenRoundIds(activityId, teacherId), "end-activity");
    const stale = (JSON.parse(raw) as { error?: string }).error === "STALE_OPEN_ROUNDS";
    if (!stale || attempt >= 3) return decodeResult<ClosedActivity>(raw);
  }
}
