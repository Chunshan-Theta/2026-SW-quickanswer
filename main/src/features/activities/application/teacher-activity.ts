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
  completedQuestionNumbers?: unknown;
  questions: Array<{
    questionNumber: string;
    prompt: string;
    kind?: "single" | "group";
    mappingStatus: string;
    blanks?: Array<{ label: string | null; prompt: string }>;
  }>;
};

/** Page data for the teacher question board: every question plus every round (open and closed). */
export async function getTeacherActivity(activityId: string, session: SessionClaims) {
  const redis = await getRedisClient();
  const raw = await redis.get(redisKeys.activity(activityId));
  if (!raw) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(raw) as ActivityRecord;
  if (session.role !== "teacher" || session.sub !== activity.teacherId) {
    throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  }
  const snapshot = await getActivitySnapshot(activityId, session);

  return {
    activityId,
    joinCode: activity.joinCode,
    phase: snapshot.phase,
    endedAt: snapshot.endedAt ?? null,
    groupNames: activity.groupNames,
    completedQuestionNumbers: Array.isArray(activity.completedQuestionNumbers) ? activity.completedQuestionNumbers as string[] : [],
    questions: activity.questions.map((question) => ({
      questionNumber: question.questionNumber,
      prompt: question.prompt,
      kind: question.kind ?? "single",
      mappingStatus: question.mappingStatus,
      blanks: (question.blanks ?? [{ label: null, prompt: question.prompt }]).map((blank) => ({ label: blank.label, prompt: blank.prompt })),
    })),
    rounds: snapshot.rounds,
  };
}
