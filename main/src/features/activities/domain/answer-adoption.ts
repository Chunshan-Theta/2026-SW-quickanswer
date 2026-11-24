import type { ActivityRoundSnapshot, AdoptedAnswerSnapshot } from "@/features/activities/domain/snapshot";

/**
 * Pure helpers for choosing the answer that is written back to the worksheet (005).
 * The teacher adopts one group's answer or types the correct answer (one per blank);
 * students later see this adopted answer once its writeback has succeeded.
 */

export type AdoptionSelection =
  | { source: "group"; groupId: string }
  | { source: "teacher"; answers: string[] };

type AdoptionRound = Pick<ActivityRoundSnapshot, "winnerGroupId" | "submissions" | "publishedAnswer" | "writebackJob" | "blanks">;

function blankCount(round: Pick<ActivityRoundSnapshot, "blanks">): number {
  return round.blanks?.length || 1;
}

function toSelection(adopted: AdoptedAnswerSnapshot): AdoptionSelection {
  return adopted.source === "teacher" || !adopted.groupId
    ? { source: "teacher", answers: [...adopted.answers] }
    : { source: "group", groupId: adopted.groupId };
}

/**
 * The selection shown first on a closed question: what the latest writeback job adopted, else
 * the published answer, else the fastest group, else an empty typed answer per blank.
 */
export function defaultAdoption(round: AdoptionRound): AdoptionSelection {
  const adopted = round.writebackJob?.adopted ?? round.publishedAnswer;
  if (adopted) return toSelection(adopted);
  const fastest = round.winnerGroupId ?? round.submissions[0]?.groupId;
  if (fastest) return { source: "group", groupId: fastest };
  return { source: "teacher", answers: Array.from({ length: blankCount(round) }, () => "") };
}

/** True when the selection would write exactly what was already adopted. */
export function sameAdoption(selection: AdoptionSelection, adopted: Pick<AdoptedAnswerSnapshot, "source" | "groupId" | "answers"> | null | undefined): boolean {
  if (!adopted) return false;
  if (selection.source === "group") return adopted.source === "group" && adopted.groupId === selection.groupId;
  return adopted.source === "teacher"
    && adopted.answers.length === selection.answers.length
    && adopted.answers.every((answer, index) => answer.trim() === selection.answers[index]?.trim());
}

/** "teamB 的答案" or "老師提供的答案". */
export function describeAdoption(adopted: Pick<AdoptedAnswerSnapshot, "source" | "groupId">): string {
  return adopted.source === "group" && adopted.groupId ? `${adopted.groupId} 的答案` : "老師提供的答案";
}

/** A group must be chosen; a typed answer needs every blank filled. */
export function adoptionIsComplete(selection: AdoptionSelection, blanks: number): boolean {
  if (selection.source === "group") return selection.groupId.trim().length > 0;
  return selection.answers.length === blanks && selection.answers.every((answer) => answer.trim().length > 0);
}
