import "server-only";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import type { JoinActivityInput } from "@/lib/validation/schemas";
import type { ImportedActivity } from "@/features/sheets/application/import-guided-notes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

function assertJoinable(activity: ImportedActivity, joinCode: string): void {
  // The join code of a closed room stays reserved until it expires, so it is never reused (006).
  if (activity.joinCode === joinCode && activity.phase === "ended") {
    throw new AppError(409, errorCodes.conflict, "此活動已關閉，無法加入。");
  }
  if (activity.joinCode !== joinCode || !["ready", "active"].includes(activity.phase)) {
    throw new AppError(409, errorCodes.conflict, "此活動目前無法加入。");
  }
}

export async function joinActivity(activityId: string, input: JoinActivityInput) {
  const redis = await getRedisClient();
  const indexedActivityId = await redis.get(redisKeys.joinCode(input.joinCode));
  if (!indexedActivityId || indexedActivityId !== activityId) {
    throw new AppError(404, errorCodes.notFound, "活動代碼不存在或已過期。");
  }
  const serialized = await redis.get(redisKeys.activity(activityId));
  if (!serialized) throw new AppError(404, errorCodes.notFound, "活動代碼不存在或已過期。");
  const activity = JSON.parse(serialized) as ImportedActivity;
  assertJoinable(activity, input.joinCode);
  if (!activity.groupNames.includes(input.groupId)) {
    throw new AppError(422, errorCodes.invalidInput, "請選擇活動中已設定的組別。");
  }
  return {
    activityId,
    groupId: input.groupId,
    displayName: input.displayName,
    phase: activity.phase,
  };
}

export async function lookupActivityByJoinCode(joinCode: string) {
  const redis = await getRedisClient();
  const activityId = await redis.get(redisKeys.joinCode(joinCode));
  if (!activityId) throw new AppError(404, errorCodes.notFound, "活動代碼不存在或已過期。");
  const serialized = await redis.get(redisKeys.activity(activityId));
  if (!serialized) throw new AppError(404, errorCodes.notFound, "活動代碼不存在或已過期。");
  const activity = JSON.parse(serialized) as ImportedActivity;
  assertJoinable(activity, joinCode);
  return { activityId, phase: activity.phase, groupNames: activity.groupNames };
}