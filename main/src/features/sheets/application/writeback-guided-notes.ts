import "server-only";
import { cellTextAt, parseWorksheetGrid, type CellLocation } from "@/features/sheets/domain/worksheet-parser";
import type { ImportedActivity } from "@/features/sheets/application/import-guided-notes";
import { structureFingerprint } from "@/features/sheets/application/worksheet-fingerprint";
import { writeWorksheetAnswers, readWorksheet } from "@/features/sheets/google-sheets.adapter";
import { errorCodes } from "@/lib/errors/error-codes";
import { AppError } from "@/server/http/errors";

export type WritebackTarget = { location: CellLocation; value: string };

export type PreparedWriteback =
  | { alreadyWritten: true; targets: WritebackTarget[] }
  | { alreadyWritten: false; sheetTitle: string; targets: WritebackTarget[] };

function sameLocation(left: CellLocation, right: CellLocation): boolean {
  return left.sheetId === right.sheetId && left.rowIndex === right.rowIndex && left.columnIndex === right.columnIndex;
}

/**
 * Resolves the answer cells for one question against a fresh scan.
 * Fails closed when the question structure changed since import; answer-cell contents
 * (including earlier writebacks) are not part of the structure and never block a writeback.
 */
export async function prepareGuidedNotesWriteback(
  activity: ImportedActivity,
  questionNumber: string,
  answers: string[],
  /** 005: answers the last successful writeback left in the cells (re-selection may replace them). */
  previousAnswers: string[] = [],
): Promise<PreparedWriteback> {
  const grid = await readWorksheet(activity.teacherId, activity.spreadsheetId, activity.sheetId);
  const parsed = parseWorksheetGrid(grid);
  if (structureFingerprint(parsed) !== activity.structureFingerprint) {
    throw new AppError(409, errorCodes.conflict, "工作表題目結構自匯入後已變更，未執行回填，請重新匯入。");
  }

  const question = activity.questions.find((item) => item.questionNumber === questionNumber);
  if (!question || question.mappingStatus !== "confirmed") {
    throw new AppError(409, errorCodes.conflict, "題目答案空格尚未確認，未執行回填。");
  }
  if (question.blanks.length !== answers.length) {
    throw new AppError(409, errorCodes.conflict, "答案數量與子題數不符，未執行回填。");
  }

  const parsedQuestion = parsed.questions.find((item) => item.questionNumber === questionNumber);
  const targets = question.blanks.map((blank, index): WritebackTarget => {
    const candidate = blank.candidates.find((item) => item.token === blank.selectedToken);
    if (!candidate) throw new AppError(409, errorCodes.conflict, "題目答案空格尚未確認，未執行回填。");
    const value = `${blank.label ?? ""}${answers[index]}`;
    const previousValue = previousAnswers[index] === undefined ? undefined : `${blank.label ?? ""}${previousAnswers[index]}`;
    // Marker layout: the marker is replaced by the answer, so accept the marker, a finished write,
    // or the answer this app wrote last time (the teacher re-selected another answer).
    const stillResolvable = parsedQuestion?.blanks[index]?.candidateSlots.some((location) => sameLocation(location, candidate.location));
    const current = cellTextAt(grid, candidate.location);
    if (!stillResolvable && current !== value && current !== previousValue) {
      throw new AppError(409, errorCodes.conflict, "無法唯一確認題號對應的答案空格，未執行回填。");
    }
    return { location: candidate.location, value };
  });

  if (targets.every((target) => cellTextAt(grid, target.location) === target.value)) {
    return { alreadyWritten: true, targets };
  }
  return { alreadyWritten: false, sheetTitle: grid.title, targets };
}

export async function applyGuidedNotesWriteback(
  activity: ImportedActivity,
  prepared: Extract<PreparedWriteback, { alreadyWritten: false }>,
): Promise<void> {
  await writeWorksheetAnswers(
    activity.teacherId,
    activity.spreadsheetId,
    prepared.sheetTitle,
    prepared.targets.map((target) => ({ location: target.location, answer: target.value })),
  );
  const verified = await readWorksheet(activity.teacherId, activity.spreadsheetId, activity.sheetId);
  const written = prepared.targets.every((target) => cellTextAt(verified, target.location) === target.value);
  if (!written || structureFingerprint(parseWorksheetGrid(verified)) !== activity.structureFingerprint) {
    throw new AppError(409, errorCodes.conflict, "回填後工作表與預期不符，請檢查原工作表。");
  }
}
