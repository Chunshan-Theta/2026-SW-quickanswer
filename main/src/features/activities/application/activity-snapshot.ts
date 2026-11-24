import "server-only";
import type { SessionClaims } from "@/features/activities/domain/types";
import { parseRoundBlanks, type ActivityRoundSnapshot, type ActivitySnapshot, type ActivitySubmissionSnapshot } from "@/features/activities/domain/snapshot";
import { sortRounds } from "@/features/activities/domain/round-state";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRedisClient } from "@/server/redis/client";
import { redisKeys } from "@/server/redis/keyspace";

type ActivityRecord = {
  activityId: string;
  teacherId: string;
  phase: string;
  endedAt?: string;
  stateVersion?: number;
  groupNames?: string[];
  roundIdsByQuestion?: unknown;
  openRoundIdsByQuestion?: unknown;
};

/** Values of a `questionNumber -> roundId` map; tolerates a missing field or a Lua-encoded `[]`/`{}`. */
function roundIdsOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).filter((roundId): roundId is string => typeof roundId === "string");
}

async function loadRound(activityId: string, roundId: string, session: SessionClaims): Promise<ActivityRoundSnapshot | null> {
  const redis = await getRedisClient();
  const [round, entries] = await Promise.all([
    redis.hGetAll(redisKeys.round(roundId)),
    redis.hGetAll(redisKeys.submissions(roundId)),
  ]);
  if (!round.phase || round.activityId !== activityId) return null;

  const allSubmissions = Object.values(entries)
    .map((value) => JSON.parse(value) as ActivitySubmissionSnapshot)
    .sort((left, right) => left.acceptedOrder - right.acceptedOrder);
  // Students see other groups' answers only after that round has closed.
  const visibleSubmissions = session.role === "teacher" || round.phase === "closed"
    ? allSubmissions
    : allSubmissions.filter((submission) => submission.groupId === session.groupId);
  const snapshot: ActivityRoundSnapshot = {
    roundId,
    questionNumber: round.questionNumber,
    prompt: round.prompt,
    kind: round.kind === "group" ? "group" : "single",
    blanks: parseRoundBlanks(round.blanks, round.prompt),
    phase: round.phase,
    ...(round.openedAt ? { openedAt: round.openedAt } : {}),
    ...(round.closedAt ? { closedAt: round.closedAt } : {}),
    winnerGroupId: round.winnerGroupId || null,
    submissions: visibleSubmissions,
  };

  if (session.role === "teacher" && round.phase === "closed") {
    const jobId = `${activityId}:${roundId}`;
    const job = await redis.hGetAll(redisKeys.writebackJob(jobId));
    if (job.jobId) {
      snapshot.writebackJob = { jobId, status: job.status, attempt: Number(job.attempt) || 0, errorCode: job.errorCode || null };
    }
  }
  return snapshot;
}

/** Every round of the activity (open and closed), filtered for the viewer's role and group. */
export async function getActivitySnapshot(activityId: string, session: SessionClaims): Promise<ActivitySnapshot> {
  const redis = await getRedisClient();
  const rawActivity = await redis.get(redisKeys.activity(activityId));
  if (!rawActivity) throw new AppError(404, errorCodes.notFound, "找不到課堂活動。");
  const activity = JSON.parse(rawActivity) as ActivityRecord;
  if (session.role === "teacher" && session.sub !== activity.teacherId) throw new AppError(403, errorCodes.forbidden, "沒有權限查看此活動。");
  if (session.role === "student" && !(activity.groupNames ?? []).includes(session.groupId ?? "")) throw new AppError(403, errorCodes.forbidden, "無法存取此組別。");

  const roundIds = [...new Set([...roundIdsOf(activity.roundIdsByQuestion), ...roundIdsOf(activity.openRoundIdsByQuestion)])];
  const rounds = (await Promise.all(roundIds.map((roundId) => loadRound(activityId, roundId, session))))
    .filter((round): round is ActivityRoundSnapshot => round !== null);

  return {
    activityId,
    phase: activity.phase,
    ...(activity.endedAt ? { endedAt: activity.endedAt } : {}),
    stateVersion: activity.stateVersion ?? 0,
    rounds: sortRounds(rounds),
  };
}
