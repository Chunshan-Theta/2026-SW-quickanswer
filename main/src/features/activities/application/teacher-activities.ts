import "server-only";
import { activityListStatus, sortTeacherActivities, type ActivityListStatus } from "@/features/activities/domain/activity-lifecycle";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

/** How many of a teacher's most recent activities 「我的課堂活動」 shows. */
export const TEACHER_ACTIVITY_LIST_LIMIT = 50;

export type TeacherActivitySummary = {
  activityId: string;
  joinCode: string;
  phase: string;
  status: ActivityListStatus;
  title: string | null;
  questionCount: number;
  openQuestionCount: number;
  completedQuestionCount: number;
  groupCount: number;
  createdAt: string | null;
  endedAt: string | null;
};

type StoredActivity = {
  activityId?: string;
  teacherId?: string;
  joinCode?: string;
  phase?: string;
  questions?: unknown[];
  groupNames?: unknown[];
  openRoundIdsByQuestion?: unknown;
  completedQuestionNumbers?: unknown;
  createdAt?: string;
  endedAt?: string;
  spreadsheetTitle?: string;
  sheetTitle?: string;
};

function countKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

function summarize(activityId: string, activity: StoredActivity, indexedAtMs: number): TeacherActivitySummary {
  const phase = activity.phase ?? "ready";
  return {
    activityId,
    joinCode: activity.joinCode ?? "",
    phase,
    status: activityListStatus(phase),
    title: activity.spreadsheetTitle || activity.sheetTitle || null,
    questionCount: Array.isArray(activity.questions) ? activity.questions.length : 0,
    openQuestionCount: countKeys(activity.openRoundIdsByQuestion),
    completedQuestionCount: Array.isArray(activity.completedQuestionNumbers) ? activity.completedQuestionNumbers.length : 0,
    groupCount: Array.isArray(activity.groupNames) ? activity.groupNames.length : 0,
    createdAt: activity.createdAt ?? (Number.isFinite(indexedAtMs) ? new Date(indexedAtMs).toISOString() : null),
    endedAt: activity.endedAt ?? null,
  };
}

/**
 * The signed-in teacher's most recent activities for 「我的課堂活動」: ongoing first, then newest.
 * Index entries whose activity has expired are removed here; entries that do not belong to the
 * teacher (should never happen) are skipped.
 */
export async function listTeacherActivities(teacherId: string): Promise<TeacherActivitySummary[]> {
  const redis = await getRedisClient();
  const indexKey = redisKeys.teacherActivities(teacherId);
  const entries = await redis.zRangeWithScores(indexKey, 0, TEACHER_ACTIVITY_LIST_LIMIT - 1, { REV: true });
  if (entries.length === 0) return [];

  const metas = await redis.mGet(entries.map((entry) => redisKeys.activity(entry.value)));
  const expired: string[] = [];
  const summaries: TeacherActivitySummary[] = [];
  entries.forEach((entry, index) => {
    const raw = metas[index];
    if (!raw) {
      expired.push(entry.value);
      return;
    }
    const activity = JSON.parse(raw) as StoredActivity;
    if (activity.teacherId !== teacherId) return;
    summaries.push(summarize(entry.value, activity, entry.score));
  });
  if (expired.length) await redis.zRem(indexKey, expired);
  return sortTeacherActivities(summaries);
}
