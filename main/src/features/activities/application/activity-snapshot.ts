import "server-only";
import type { SessionClaims } from "@/features/activities/domain/types";
import type { ActivityRoundSnapshot, ActivitySnapshot, ActivitySubmissionSnapshot } from "@/features/activities/domain/snapshot";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

type ActivityRecord = { activityId: string; teacherId: string; phase: string; stateVersion?: number; currentRoundId?: string | null; groupNames?: string[] };
type SubmissionRecord = ActivitySubmissionSnapshot;

export async function getActivitySnapshot(activityId: string, session: SessionClaims): Promise<ActivitySnapshot> {
  const redis = await getRedisClient();
  const rawActivity = await redis.get(redisKeys.activity(activityId));
  if (!rawActivity) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(rawActivity) as ActivityRecord;
  if (session.role === "teacher" && session.sub !== activity.teacherId) throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  if (session.role === "student" && !(activity.groupNames ?? []).includes(session.groupId ?? "")) throw new AppError(403, errorCodes.forbidden, "無法存取此組別。");

  const snapshot: ActivitySnapshot = {
    activityId,
    phase: activity.phase,
    stateVersion: activity.stateVersion ?? 0,
    currentRound: null,
  };
  if (!activity.currentRoundId) return snapshot;

  const roundId = activity.currentRoundId;
  const [round, entries] = await Promise.all([
    redis.hGetAll(redisKeys.round(roundId)),
    redis.hGetAll(redisKeys.submissions(roundId)),
  ]);
  if (!round.phase) return snapshot;
  const allSubmissions = Object.values(entries).map((value) => JSON.parse(value) as SubmissionRecord).sort((left, right) => left.acceptedOrder - right.acceptedOrder);
  const studentCanSeeAll = session.role === "student" && round.phase === "closed";
  const submissions = session.role === "teacher" || studentCanSeeAll
    ? allSubmissions
    : allSubmissions.filter((submission) => submission.groupId === session.groupId);
  const currentRound: ActivityRoundSnapshot = {
    roundId,
    questionNumber: round.questionNumber,
    prompt: round.prompt,
    phase: round.phase,
    winnerGroupId: round.winnerGroupId || null,
    submissions,
  };
  snapshot.currentRound = currentRound;
  if (session.role === "teacher") {
    const jobId = `${activityId}:${roundId}`;
    const job = await redis.hGetAll(redisKeys.writebackJob(jobId));
    if (job.jobId) {
      currentRound.writebackJob = {
        jobId,
        status: job.status,
        attempt: Number(job.attempt) || 0,
        errorCode: job.errorCode || null,
      };
    }
  }
  return snapshot;
}
