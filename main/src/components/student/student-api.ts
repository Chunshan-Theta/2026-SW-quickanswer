import type { ActivitySubmissionSnapshot } from "@/features/activities/domain/snapshot";

/**
 * Every student request URL in one place: the live event stream and answer submission.
 * Session/identity details (cookies, per-tab identifiers) belong here, not in components.
 */

export function studentEventsUrl(activityId: string): string {
  return `/api/activities/${activityId}/events`;
}

/**
 * Submits one answer per blank for a single round and returns the group's own receipt;
 * throws with the server's message on failure.
 */
export async function submitStudentAnswers(activityId: string, roundId: string, answers: string[]): Promise<ActivitySubmissionSnapshot> {
  const response = await fetch(`/api/activities/${activityId}/rounds/${roundId}/submissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
