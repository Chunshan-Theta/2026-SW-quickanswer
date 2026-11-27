import type { ActivityRoundSnapshot, ActivitySubmissionSnapshot, AdoptedAnswerSnapshot, PublishedAnswerSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

/**
 * Pure helpers that apply live activity events to the list of rounds kept by the teacher and
 * student screens. Several rounds can be open at once, so every update is keyed by `roundId`.
 * Functions return the same array when nothing changes so React can skip re-rendering.
 */

export type RoundWritebackJob = NonNullable<ActivityRoundSnapshot["writebackJob"]>;

export interface RoundOpenedData {
  roundId: string;
  questionNumber: string;
  prompt: string;
  kind?: "single" | "group";
  blanks?: RoundBlankSnapshot[];
  openedAt?: string;
}

export interface RoundClosedData {
  roundId: string;
  winnerGroupId: string | null;
  submissions: ActivitySubmissionSnapshot[];
  closedAt?: string;
}

export type QuestionStatus =
  | "unconfirmed"
  | "idle"
  | "open"
  | "closed"
  | "writeback-pending"
  | "writeback-succeeded"
  | "writeback-failed";

const pendingWritebackStatuses = new Set(["queued", "running", "retryable"]);

function byQuestionNumber(left: { questionNumber: string }, right: { questionNumber: string }): number {
  return Number(left.questionNumber) - Number(right.questionNumber) || left.questionNumber.localeCompare(right.questionNumber);
}

function byAcceptedOrder(left: ActivitySubmissionSnapshot, right: ActivitySubmissionSnapshot): number {
  return left.acceptedOrder - right.acceptedOrder;
}

/** Keeps only the public submission fields (live events also carry roundId / winnerGroupId). */
function toSubmission(submission: ActivitySubmissionSnapshot): ActivitySubmissionSnapshot {
  return {
    groupId: submission.groupId,
    answer: submission.answer,
    ...(submission.answers ? { answers: submission.answers } : {}),
    acceptedOrder: submission.acceptedOrder,
    acceptedAt: submission.acceptedAt,
  };
}

function updateRound(
  rounds: ActivityRoundSnapshot[],
  roundId: string,
  update: (round: ActivityRoundSnapshot) => ActivityRoundSnapshot,
): ActivityRoundSnapshot[] {
  if (!rounds.some((round) => round.roundId === roundId)) return rounds;
  return rounds.map((round) => (round.roundId === roundId ? update(round) : round));
}

export function sortRounds(rounds: ActivityRoundSnapshot[]): ActivityRoundSnapshot[] {
  return [...rounds].sort(byQuestionNumber);
}

export function roundsByQuestion(rounds: ActivityRoundSnapshot[]): Map<string, ActivityRoundSnapshot> {
  return new Map(rounds.map((round) => [round.questionNumber, round]));
}

/** Adds a newly opened round; a repeated event for a known round is ignored. */
export function applyRoundOpened(rounds: ActivityRoundSnapshot[], data: RoundOpenedData): ActivityRoundSnapshot[] {
  if (rounds.some((round) => round.roundId === data.roundId)) return rounds;
  return sortRounds([
    ...rounds,
    {
      roundId: data.roundId,
      questionNumber: data.questionNumber,
      prompt: data.prompt,
      kind: data.kind ?? "single",
      blanks: data.blanks?.length ? data.blanks : [{ label: null, prompt: data.prompt }],
      phase: "open",
      ...(data.openedAt ? { openedAt: data.openedAt } : {}),
      winnerGroupId: null,
      submissions: [],
    },
  ]);
}

/** Records one group's accepted answer in one round, replacing that group's earlier entry. */
export function applySubmission(
  rounds: ActivityRoundSnapshot[],
  roundId: string,
  submission: ActivitySubmissionSnapshot,
  winnerGroupId?: string | null,
): ActivityRoundSnapshot[] {
  const accepted = toSubmission(submission);
  return updateRound(rounds, roundId, (round) => ({
    ...round,
    winnerGroupId: winnerGroupId === undefined ? round.winnerGroupId : winnerGroupId,
    submissions: [...round.submissions.filter((item) => item.groupId !== accepted.groupId), accepted].sort(byAcceptedOrder),
  }));
}

export function applyRoundClosed(rounds: ActivityRoundSnapshot[], data: RoundClosedData): ActivityRoundSnapshot[] {
  return updateRound(rounds, data.roundId, (round) => ({
    ...round,
    phase: "closed",
    ...(data.closedAt ? { closedAt: data.closedAt } : {}),
    winnerGroupId: data.winnerGroupId,
    submissions: data.submissions.map(toSubmission).sort(byAcceptedOrder),
  }));
}

/**
 * Applies a writeback status. Only queued events carry the adopted answer, so later statuses keep
 * it; a succeeded event also carries the answer now published to students (005).
 */
export function applyWritebackStatus(
  rounds: ActivityRoundSnapshot[],
  roundId: string,
  job: { jobId: string; status: string; attempt?: number; errorCode?: string | null; adopted?: AdoptedAnswerSnapshot; published?: PublishedAnswerSnapshot },
): ActivityRoundSnapshot[] {
  return updateRound(rounds, roundId, (round) => {
    const adopted = job.adopted ?? round.writebackJob?.adopted;
    return {
      ...round,
      writebackJob: { jobId: job.jobId, status: job.status, attempt: job.attempt ?? 0, errorCode: job.errorCode ?? null, ...(adopted ? { adopted } : {}) },
      ...(job.published ? { publishedAnswer: job.published } : {}),
    };
  });
}

/** The answer the teacher adopted, published to students once its writeback succeeded (005). */
export function applyPublishedAnswer(rounds: ActivityRoundSnapshot[], roundId: string, published: PublishedAnswerSnapshot): ActivityRoundSnapshot[] {
  return updateRound(rounds, roundId, (round) => ({ ...round, publishedAnswer: published }));
}

/** Card status of a question on the teacher board. */
export function questionStatus(
  question: { mappingStatus: string },
  round?: Pick<ActivityRoundSnapshot, "phase" | "writebackJob">,
): QuestionStatus {
  if (round?.phase === "open") return "open";
  if (round?.phase === "closed") {
    const status = round.writebackJob?.status;
    if (status === "succeeded") return "writeback-succeeded";
    if (status === "failed") return "writeback-failed";
    if (status && pendingWritebackStatuses.has(status)) return "writeback-pending";
    return "closed";
  }
  return question.mappingStatus === "confirmed" ? "idle" : "unconfirmed";
}

/** Time since a round opened as `mm:ss` (or `h:mm:ss`). */
export function formatElapsed(fromIso: string | undefined, nowMs: number): string {
  const start = fromIso ? Date.parse(fromIso) : Number.NaN;
  const totalSeconds = Number.isFinite(start) ? Math.max(0, Math.floor((nowMs - start) / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
