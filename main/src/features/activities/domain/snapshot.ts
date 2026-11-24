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

export interface ActivityRoundSnapshot {
  roundId: string;
  questionNumber: string;
  prompt: string;
  kind?: "single" | "group";
  blanks?: RoundBlankSnapshot[];
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
