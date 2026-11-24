import "server-only";
import type { ActivityEvent, SessionClaims } from "@/features/activities/domain/types";

export function projectActivityEvent<T extends Record<string, unknown>>(
  event: ActivityEvent<T>,
  session: SessionClaims,
): ActivityEvent | null {
  if (session.role === "teacher") return event;
  // 關閉房間 (006) carries no answers; every student must see it right away.
  if (event.type === "activity.ended") return event;
  if (event.type === "phase.changed" || event.type === "results.finalized") return event;
  if (event.type !== "submission.accepted" || event.data.groupId !== session.groupId) return null;
  return {
    ...event,
    type: "submission.receipt",
    data: {
      roundId: event.data.roundId,
      groupId: session.groupId,
      answer: event.data.answer,
      answers: event.data.answers,
      acceptedOrder: event.data.acceptedOrder,
      acceptedAt: event.data.acceptedAt,
    },
  };
}