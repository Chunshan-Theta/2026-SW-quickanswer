import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { parseWorksheetGrid, type CellLocation } from "@/features/sheets/domain/worksheet-parser";
import { worksheetFingerprint } from "@/features/sheets/application/worksheet-fingerprint";
import { readWorksheet } from "@/features/sheets/google-sheets.adapter";
import type { ActivityImportInput, MappingConfirmationInput } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { AppError } from "@/server/http/errors";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

type Candidate = { token: string; location: CellLocation };
type ImportedQuestion = { questionNumber: string; prompt: string; mappingStatus: "confirmed" | "ambiguous" | "missing"; candidates: Candidate[]; selectedToken: string | null };
export type ImportedActivity = { activityId: string; teacherId: string; spreadsheetId: string; sheetId: number; joinCode: string; phase: "ready" | "mapping_review"; fingerprint: string; groupNames: string[]; questions: ImportedQuestion[] };

function publicActivity(activity: ImportedActivity) {
  return { activityId: activity.activityId, joinCode: activity.joinCode, phase: activity.phase, questions: activity.questions.map((question) => ({
    questionNumber: question.questionNumber, prompt: question.prompt, mappingStatus: question.mappingStatus,
    candidateSlotTokens: question.mappingStatus === "ambiguous" ? question.candidates.map((candidate) => candidate.token) : [],
  })) };
}

export async function importGuidedNotes(teacherId: string, input: ActivityImportInput) {
  const grid = await readWorksheet(teacherId, input.spreadsheetId, input.sheetId);
  const parsed = parseWorksheetGrid(grid);
  const blocking = parsed.issues.filter((issue) => issue.code !== "ambiguous_answer_slot");
  if (!parsed.questions.length || blocking.length) throw new AppError(422, errorCodes.invalidInput, "無法匯入學習單，請檢查題號與答案空格。", blocking);
  const questions: ImportedQuestion[] = parsed.questions.map((question) => {
    const candidates = question.candidateSlots.map((location) => ({ token: randomUUID(), location }));
    return { questionNumber: question.questionNumber, prompt: question.prompt, mappingStatus: question.mappingStatus, candidates, selectedToken: question.mappingStatus === "confirmed" ? candidates[0].token : null };
  });
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let joinCode = "";
  let activity: ImportedActivity;
  const redis = await getRedisClient();
  const ttl = Number(process.env.ACTIVITY_TTL_SECONDS) || 604800;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    joinCode = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
    const activityId = randomUUID();
    activity = { activityId, teacherId, spreadsheetId: input.spreadsheetId, sheetId: input.sheetId, joinCode, phase: questions.every((question) => question.selectedToken) ? "ready" : "mapping_review", fingerprint: worksheetFingerprint(grid), groupNames: input.groupNames, questions };
    const reserved = await redis.set(redisKeys.joinCode(joinCode), activityId, { EX: ttl, NX: true });
    if (!reserved) continue;
    try {
      await redis.set(redisKeys.activity(activityId), JSON.stringify(activity), { EX: ttl });
      return publicActivity(activity);
    } catch (error) {
      await redis.del(redisKeys.joinCode(joinCode));
      throw error;
    }
  }
  throw new AppError(503, errorCodes.serviceUnavailable, "無法建立活動代碼，請重試。");
}

export async function confirmMappings(teacherId: string, activityId: string, input: MappingConfirmationInput) {
  const redis = await getRedisClient();
  const key = redisKeys.activity(activityId);
  const original = await redis.get(key);
  if (!original) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(original) as ImportedActivity;
  if (activity.teacherId !== teacherId) throw new AppError(403, errorCodes.forbidden, "沒有權限修改此活動。");
  const grid = await readWorksheet(teacherId, activity.spreadsheetId, activity.sheetId);
  if (worksheetFingerprint(grid) !== activity.fingerprint) throw new AppError(409, errorCodes.conflict, "工作表已變更，請重新匯入。");
  const selected = new Set<string>();
  for (const resolution of input.resolutions) {
    const question = activity.questions.find((item) => item.questionNumber === resolution.questionNumber);
    if (!question || !question.candidates.some((candidate) => candidate.token === resolution.answerSlotToken) || selected.has(resolution.answerSlotToken)) {
      throw new AppError(409, errorCodes.conflict, "候選答案格已過期或重複，請重新匯入。");
    }
    question.selectedToken = resolution.answerSlotToken;
    question.mappingStatus = "confirmed";
    selected.add(resolution.answerSlotToken);
  }
  const locations = activity.questions.filter((question) => question.selectedToken).map((question) => JSON.stringify(question.candidates.find((candidate) => candidate.token === question.selectedToken)?.location));
  if (new Set(locations).size !== locations.length) throw new AppError(409, errorCodes.conflict, "同一答案格不可重複使用。");
  activity.phase = activity.questions.every((question) => question.selectedToken) ? "ready" : "mapping_review";
  const updated = JSON.stringify(activity);
  const result = await redis.eval('if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end redis.call("SET", KEYS[1], ARGV[2], "KEEPTTL") return 1', { keys: [key], arguments: [original, updated] });
  if (result !== 1) throw new AppError(409, errorCodes.conflict, "活動已變更，請重新載入。");
  return publicActivity(activity);
}