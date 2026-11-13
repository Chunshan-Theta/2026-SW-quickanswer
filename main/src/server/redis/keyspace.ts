import "server-only";

export const redisKeys = {
  activity: (activityId: string) => `activity:${activityId}:meta`,
  activityQuestions: (activityId: string) => `activity:${activityId}:questions`,
  activityGroups: (activityId: string) => `activity:${activityId}:groups`,
  joinCode: (code: string) => `activity:join:${code}`,
  activityEvents: (activityId: string) => `activity:${activityId}:events`,
  round: (roundId: string) => `round:${roundId}:state`,
  submissions: (roundId: string) => `round:${roundId}:submissions`,
  order: (roundId: string) => `round:${roundId}:order`,
  winner: (roundId: string) => `round:${roundId}:winner`,
  sheetBinding: (activityId: string) => `activity:${activityId}:sheet-binding`,
  writebackJobs: "writeback:jobs",
  writebackJob: (jobId: string) => `writeback:job:${jobId}`,
  writebackIdempotency: (activityId: string, roundId: string) => `writeback:idempotency:${activityId}:${roundId}`,
  session: (sessionId: string) => `session:${sessionId}`,
} as const;
