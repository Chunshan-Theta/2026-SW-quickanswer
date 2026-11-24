import type { ActivitySubmissionSnapshot } from "@/features/activities/domain/snapshot";
import { seatHeaders, withSeat } from "@/lib/session/seat";

/**
 * Every student request URL in one place: the live event stream and answer submission.
 * Each request names the tab's seat so the server uses this tab's own group identity
 * (see `src/lib/session/seat.ts`).
 */

/** EventSource cannot set headers, so the stream carries the seat as `?seat=`. */
export function studentEventsUrl(activityId: string, seat: string): string {
  return withSeat(`/api/activities/${activityId}/events`, seat);
}

/**
 * Submits one answer per blank for a single round and returns the group's own receipt;
 * throws with the server's message on failure.
 */
export async function submitStudentAnswers(activityId: string, seat: string, roundId: string, answers: string[]): Promise<ActivitySubmissionSnapshot> {
  const response = await fetch(`/api/activities/${activityId}/rounds/${roundId}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...seatHeaders(seat) },
    body: JSON.stringify({ answers: answers.map((answer) => answer.trim()), requestId: crypto.randomUUID() }),
  });
  const body = await response.json().catch(() => ({})) as Partial<ActivitySubmissionSnapshot> & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "無法送出答案。");
  return {
    groupId: body.groupId ?? "",
    answer: body.answer ?? "",
    ...(body.answers ? { answers: body.answers } : {}),
    acceptedOrder: body.acceptedOrder ?? 0,
    acceptedAt: body.acceptedAt ?? "",
  };
}
