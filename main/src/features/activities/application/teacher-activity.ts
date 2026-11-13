import "server-only";
import { getActivitySnapshot } from "@/features/activities/application/activity-snapshot";
import type { SessionClaims } from "@/features/activities/domain/types";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

type ActivityRecord = {
  activityId: string;
  teacherId: string;
  joinCode: string;
  phase: string;
  groupNames: string[];
  completedQuestionNumbers?: string[];
  questions: Array<{ questionNumber: string; prompt: string; mappingStatus: string }>;
};
type TeacherSubmission = { groupId: string; answer: string; acceptedOrder: number; acceptedAt: string };
type TeacherRound = { roundId: string; questionNumber: string; prompt: string; phase: "open" | "closed"; winnerGroupId: string | null; submissions: TeacherSubmission[] } | null;
type ActivitySnapshot = { phase: string; currentRound: TeacherRound };

export async function getTeacherActivity(activityId: string, session: SessionClaims) {
  const redis = await getRedisClient();
  const raw = await redis.get(redisKeys.activity(activityId));
  if (!raw) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(raw) as ActivityRecord;
  if (session.role !== "teacher" || session.sub !== activity.teacherId) {
    throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  }
  const snapshot = await getActivitySnapshot(activityId, session) as ActivitySnapshot;
  return {
    activityId,
    joinCode: activity.joinCode,
    phase: activity.phase,
    groupNames: activity.groupNames,
    completedQuestionNumbers: activity.completedQuestionNumbers ?? [],
    questions: activity.questions,
    currentRound: snapshot.currentRound,
  };
}
