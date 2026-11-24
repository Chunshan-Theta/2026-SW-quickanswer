import "server-only";
import {
  closeRound as closeRoundRecord,
  openRound as openRoundRecord,
  submitAnswer as submitAnswerRecord,
} from "@/server/redis/round-store";

export function openActivityRound(activityId: string, teacherId: string, questionNumber: string) {
  return openRoundRecord(activityId, teacherId, questionNumber);
}

export function acceptRoundAnswer(activityId: string, roundId: string, groupId: string, answers: string[]) {
  return submitAnswerRecord(activityId, roundId, groupId, answers);
}

export function finishActivityRound(activityId: string, roundId: string, teacherId: string) {
  return closeRoundRecord(activityId, roundId, teacherId);
}
