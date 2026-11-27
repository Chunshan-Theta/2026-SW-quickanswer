/**
 * Activity lifecycle rules shared by the server (teacher activity list) and the browser (console).
 * `ended` is the terminal phase set only by 關閉房間; every other phase is still "ongoing".
 */

export type ActivityListStatus = "ongoing" | "ended";

export function isActivityEnded(phase: string | null | undefined): boolean {
  return phase === "ended";
}

export function activityListStatus(phase: string | null | undefined): ActivityListStatus {
  return isActivityEnded(phase) ? "ended" : "ongoing";
}

/** Ongoing before ended, then newest `createdAt` first (missing dates last); stable, returns a copy. */
export function sortTeacherActivities<T extends { status: ActivityListStatus; createdAt: string | null }>(activities: readonly T[]): T[] {
  const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
  return activities
    .map((activity, index) => ({ activity, index }))
    .sort((left, right) =>
      (left.activity.status === right.activity.status ? 0 : left.activity.status === "ongoing" ? -1 : 1) ||
      time(right.activity.createdAt) - time(left.activity.createdAt) ||
      left.index - right.index)
    .map(({ activity }) => activity);
}

/**
 * Phase after some rounds closed, mirroring `close-rounds.lua`: completed once every question is
 * closed, otherwise active — but an ended activity stays ended (a late event cannot reopen it).
 */
export function phaseAfterRoundsClosed(currentPhase: string, questionCount: number, closedCount: number): string {
  if (isActivityEnded(currentPhase)) return "ended";
  return closedCount >= questionCount ? "completed" : "active";
}
