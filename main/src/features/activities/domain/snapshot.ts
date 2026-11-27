export interface ActivitySubmissionSnapshot {
  groupId: string;
  /** Display text; for a question group it joins every blank as "（1）a；（2）b". */
  answer: string;
  /** One answer per blank (absent on submissions stored before question groups). */
  answers?: string[];
  acceptedOrder: number;
  acceptedAt: string;
}

export interface RoundBlankSnapshot {
  label: string | null;
  prompt: string;
}

/** The answer a teacher chose to write back: one group's answer or one typed by the teacher (005). */
export interface AdoptedAnswerSnapshot {
  source: "group" | "teacher";
  /** The adopted group; null when the teacher typed the answer. */
  groupId: string | null;
  /** Display text; for a question group it joins every blank as "（1）a；（2）b". */
  answer: string;
  /** One answer per blank. */
  answers: string[];
}

/** The adopted answer of the latest successful writeback: the only other answer students see (005). */
export interface PublishedAnswerSnapshot extends AdoptedAnswerSnapshot {
  publishedAt?: string;
}

export interface ActivityRoundSnapshot {
  roundId: string;
  questionNumber: string;
  prompt: string;
  kind?: "single" | "group";
  blanks?: RoundBlankSnapshot[];
  phase: string;
  /** When the round was opened / closed (ISO 8601); absent on rounds stored before 004. */
  openedAt?: string;
  closedAt?: string;
  /** Fastest group; always null for students once a round has closed (005). */
  winnerGroupId: string | null;
  /** Teachers: every group. Students: only their own group's submission. */
  submissions: ActivitySubmissionSnapshot[];
  /** Set once a writeback of this question has succeeded (teachers and students). */
  publishedAnswer?: PublishedAnswerSnapshot;
  /** Teachers only: the question's writeback job and the answer it writes. */
  writebackJob?: {
    jobId: string;
    status: string;
    attempt: number;
    errorCode: string | null;
    adopted?: AdoptedAnswerSnapshot;
  };
}

export interface ActivitySnapshot {
  activityId: string;
  phase: string;
  /** Set once the teacher closed the room (phase "ended", 006). */
  endedAt?: string;
  stateVersion: number;
  /** Every round of the activity (open and closed), sorted by question number. */
  rounds: ActivityRoundSnapshot[];
}

function parseAnswerList(raw: string | undefined, fallback: string): string[] {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "string")) return parsed;
    } catch {
      // Fall through to the display text.
    }
  }
  return [fallback];
}

/**
 * The adopted answer recorded on a writeback job hash (005). Jobs queued before 005 always
 * adopted the fastest group's answer.
 */
export function parseAdoptedAnswer(job: Record<string, string | undefined>): AdoptedAnswerSnapshot | undefined {
  if (!job.jobId) return undefined;
  const source = job.adoptedSource === "teacher" ? "teacher" : "group";
  const groupId = source === "group" ? (job.adoptedGroupId || job.winnerGroupId || null) : null;
  return { source, groupId, answer: job.answer ?? "", answers: parseAnswerList(job.answers, job.answer ?? "") };
}

/** The published answer stored on a round hash once a writeback succeeded (005). */
export function parsePublishedAnswer(round: Record<string, string | undefined>): PublishedAnswerSnapshot | undefined {
  if (!round.publishedSource) return undefined;
  const source = round.publishedSource === "teacher" ? "teacher" : "group";
  return {
    source,
    groupId: source === "group" ? round.publishedGroupId || null : null,
    answer: round.publishedAnswer ?? "",
    answers: parseAnswerList(round.publishedAnswers, round.publishedAnswer ?? ""),
    ...(round.publishedAt ? { publishedAt: round.publishedAt } : {}),
  };
}

/** Parses the `blanks` JSON stored on a round hash; rounds opened before question groups have none. */
export function parseRoundBlanks(raw: string | undefined, prompt: string): RoundBlankSnapshot[] {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: { label?: unknown; prompt?: unknown }) => ({
          label: typeof item.label === "string" ? item.label : null,
          prompt: typeof item.prompt === "string" ? item.prompt : "",
        }));
      }
    } catch {
      // Fall through to a single blank.
    }
  }
  return [{ label: null, prompt }];
}
