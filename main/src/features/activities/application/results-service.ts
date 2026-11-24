import "server-only";
import type { SessionClaims } from "@/features/activities/domain/types";
import { parseRoundBlanks } from "@/features/activities/domain/snapshot";
import { errorCodes } from "@/lib/errors/error-codes";
import { AppError } from "@/server/http/errors";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

type ActivityRecord = {
  activityId: string;
  teacherId: string;
  groupNames?: string[];
};

type SubmissionRecord = {
  groupId: string;
  answer: string;
  answers?: string[];
  acceptedOrder: number;
  acceptedAt: string;
};

export async function getRoundResults(activityId: string, roundId: string, session: SessionClaims) {
  const redis = await getRedisClient();
  const rawActivity = await redis.get(redisKeys.activity(activityId));
  if (!rawActivity) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(rawActivity) as ActivityRecord;

  if (session.role === "teacher" && activity.teacherId !== session.sub) {
    throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  }
  if (session.role === "student" && !(activity.groupNames ?? []).includes(session.groupId ?? "")) {
    throw new AppError(403, errorCodes.forbidden, "無法存取此組別。");
  }
  if (session.role === "student" && session.activityId !== activityId) {
    throw new AppError(403, errorCodes.forbidden, "無法存取此課堂活動。");
  }

  const [round, entries] = await Promise.all([
    redis.hGetAll(redisKeys.round(roundId)),
    redis.hGetAll(redisKeys.submissions(roundId)),
  ]);
  if (!round.phase || round.activityId !== activityId) {
    throw new AppError(404, errorCodes.notFound, "找不到搶答回合。");
  }

  const submissions = Object.values(entries)
    .map((value) => JSON.parse(value) as SubmissionRecord)
    .sort((left, right) => left.acceptedOrder - right.acceptedOrder);
  const visibleSubmissions = session.role === "teacher" || round.phase === "closed"
    ? submissions
    : submissions.filter((submission) => submission.groupId === session.groupId);

  return {
    roundId,
    phase: round.phase,
    questionNumber: round.questionNumber,
    kind: round.kind === "group" ? "group" : "single",
    blanks: parseRoundBlanks(round.blanks, round.prompt ?? ""),
    winnerGroupId: round.phase === "closed" ? round.winnerGroupId || null : null,
    submissions: visibleSubmissions,
  };
}
