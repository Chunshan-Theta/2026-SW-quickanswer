import "server-only";
import type { ActivityEvent, SessionClaims } from "@/features/activities/domain/types";

type SubmissionData = { groupId?: unknown };

/**
 * What one viewer may receive from an activity event. Teachers get every event unchanged.
 * Students get only their own group's answers: their receipt while a question is open, their own
 * submission once it closes (never other groups or the fastest group, 005), and the answer the
 * teacher adopted once its writeback succeeded (`answer.published`).
 */
export function projectActivityEvent<T extends Record<string, unknown>>(
  event: ActivityEvent<T>,
  session: SessionClaims,
): ActivityEvent | null {
  if (session.role === "teacher") return event;
  if (event.type === "phase.changed") return event;

  if (event.type === "results.finalized") {
    const submissions = Array.isArray(event.data.submissions) ? event.data.submissions as SubmissionData[] : [];
    return {
      ...event,
      data: {
        roundId: event.data.roundId,
        questionNumber: event.data.questionNumber,
        phase: event.data.phase,
        winnerGroupId: null,
        submissions: submissions.filter((submission) => submission.groupId === session.groupId),
      },
    };
  }

  if (event.type === "writeback.status") {
    if (event.data.status !== "succeeded" || !event.data.published) return null;
    return {
      ...event,
      type: "answer.published",
      data: { roundId: event.data.roundId, questionNumber: event.data.questionNumber, published: event.data.published },
    };
  }

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
