export interface ActivitySubmissionSnapshot {
  groupId: string;
  answer: string;
  acceptedOrder: number;
  acceptedAt: string;
}

export interface ActivityRoundSnapshot {
  roundId: string;
  questionNumber: string;
  prompt: string;
  phase: string;
  winnerGroupId: string | null;
  submissions: ActivitySubmissionSnapshot[];
  writebackJob?: {
    jobId: string;
    status: string;
    attempt: number;
    errorCode: string | null;
  };
}

export interface ActivitySnapshot {
  activityId: string;
  phase: string;
  stateVersion: number;
  currentRound: ActivityRoundSnapshot | null;
}
