import "server-only";
import { getActivitySnapshot } from "@/features/activities/application/activity-snapshot";
import { parseRoundBlanks, type ActivityRoundSnapshot, type ActivitySubmissionSnapshot } from "@/features/activities/domain/snapshot";
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
  roundIdsByQuestion?: Record<string, string>;
  questions: Array<{
    questionNumber: string;
    prompt: string;
    kind?: "single" | "group";
    mappingStatus: string;
    blanks?: Array<{ label: string | null; prompt: string }>;
  }>;
};

async function loadCompletedRound(activityId: string, roundId: string): Promise<ActivityRoundSnapshot | null> {
  const redis = await getRedisClient();
  const jobId = `${activityId}:${roundId}`;
  const [round, entries, job] = await Promise.all([
    redis.hGetAll(redisKeys.round(roundId)),
    redis.hGetAll(redisKeys.submissions(roundId)),
    redis.hGetAll(redisKeys.writebackJob(jobId)),
  ]);
  if (round.phase !== "closed" || round.activityId !== activityId) return null;
  const submissions = Object.values(entries)
    .map((value) => JSON.parse(value) as ActivitySubmissionSnapshot)
    .sort((left, right) => left.acceptedOrder - right.acceptedOrder);
  return {
    roundId,
    questionNumber: round.questionNumber,
    prompt: round.prompt,
    kind: round.kind === "group" ? "group" : "single",
    blanks: parseRoundBlanks(round.blanks, round.prompt),
    phase: "closed",
    winnerGroupId: round.winnerGroupId || null,
    submissions,
    ...(job.jobId ? { writebackJob: { jobId, status: job.status, attempt: Number(job.attempt) || 0, errorCode: job.errorCode || null } } : {}),
  };
}

export async function getTeacherActivity(activityId: string, session: SessionClaims) {
  const redis = await getRedisClient();
  const raw = await redis.get(redisKeys.activity(activityId));
  if (!raw) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(raw) as ActivityRecord;
  if (session.role !== "teacher" || session.sub !== activity.teacherId) {
    throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  }
  const snapshot = await getActivitySnapshot(activityId, session);
  const completedQuestionNumbers = activity.completedQuestionNumbers ?? [];
  const completedRounds = (await Promise.all(
    completedQuestionNumbers.map((questionNumber) => {
      const roundId = activity.roundIdsByQuestion?.[questionNumber];
      return roundId ? loadCompletedRound(activityId, roundId) : Promise.resolve(null);
    }),
  )).filter((round): round is ActivityRoundSnapshot => round !== null);

  return {
    activityId,
    joinCode: activity.joinCode,
    phase: activity.phase,
    groupNames: activity.groupNames,
    completedQuestionNumbers,
    questions: activity.questions.map((question) => ({
      questionNumber: question.questionNumber,
      prompt: question.prompt,
      kind: question.kind ?? "single",
      mappingStatus: question.mappingStatus,
      blanks: (question.blanks ?? [{ label: null, prompt: question.prompt }]).map((blank) => ({ label: blank.label, prompt: blank.prompt })),
    })),
    currentRound: snapshot.currentRound,
    completedRounds,
  };
}
