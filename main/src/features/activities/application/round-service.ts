import "server-only";
import {
  closeActivity,
  closeAllOpenRounds,
  closeRound as closeRoundRecord,
  openRounds,
  submitAnswer as submitAnswerRecord,
} from "@/server/redis/round-store";

/** Opens all listed questions together (all or nothing); other open questions stay open. */
export function openActivityRounds(activityId: string, teacherId: string, questionNumbers: string[]) {
  return openRounds(activityId, teacherId, questionNumbers);
}

export function acceptRoundAnswer(activityId: string, roundId: string, groupId: string, answers: string[]) {
  return submitAnswerRecord(activityId, roundId, groupId, answers);
}

export function finishActivityRound(activityId: string, roundId: string, teacherId: string) {
  return closeRoundRecord(activityId, roundId, teacherId);
}

export function finishAllOpenRounds(activityId: string, teacherId: string) {
  return closeAllOpenRounds(activityId, teacherId);
}

/** 關閉房間 (006): ends every open question and the activity; idempotent once ended. */
export function closeActivityRoom(activityId: string, teacherId: string) {
  return closeActivity(activityId, teacherId);
}
