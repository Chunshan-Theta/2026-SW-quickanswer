import "server-only";
import { parseWorksheetGrid, type CellLocation, type WorksheetGrid } from "@/features/sheets/domain/worksheet-parser";
import type { ImportedActivity } from "@/features/sheets/application/import-guided-notes";
import { worksheetFingerprint } from "@/features/sheets/application/worksheet-fingerprint";
import { writeWorksheetAnswers, readWorksheet } from "@/features/sheets/google-sheets.adapter";
import { errorCodes } from "@/lib/errors/error-codes";
import { AppError } from "@/server/http/errors";

export type PreparedWriteback =
  | { alreadyWritten: true; expectedFingerprint: string }
  | { alreadyWritten: false; expectedFingerprint: string; sheetTitle: string; location: CellLocation };

function updatedGrid(grid: WorksheetGrid, location: CellLocation, answer: string): WorksheetGrid {
  const rows = grid.rows.map((row) => ({ ...row, values: row.values?.map((cell) => ({ ...cell })) }));
  const cell = rows[location.rowIndex]?.values?.[location.columnIndex];
  if (!cell) throw new AppError(409, errorCodes.conflict, "答案空格已無法確認，請重新匯入工作表。");
  rows[location.rowIndex].values![location.columnIndex] = {
    ...cell,
    formattedValue: answer,
    userEnteredValue: { ...cell.userEnteredValue, stringValue: answer, formulaValue: undefined, numberValue: undefined },
  };
  return { ...grid, rows };
}

export async function prepareGuidedNotesWriteback(
  activity: ImportedActivity,
  questionNumber: string,
  answer: string,
  expectedAfterFingerprint?: string,
): Promise<PreparedWriteback> {
  const grid = await readWorksheet(activity.teacherId, activity.spreadsheetId, activity.sheetId);
  const currentFingerprint = worksheetFingerprint(grid);
  if (expectedAfterFingerprint && currentFingerprint === expectedAfterFingerprint) {
    return { alreadyWritten: true, expectedFingerprint: expectedAfterFingerprint };
  }
  if (currentFingerprint !== activity.fingerprint) {
    throw new AppError(409, errorCodes.conflict, "工作表自匯入後已變更，未執行回填。");
  }

  const question = activity.questions.find((item) => item.questionNumber === questionNumber);
  if (!question || question.mappingStatus !== "confirmed" || !question.selectedToken) {
    throw new AppError(409, errorCodes.conflict, "題目答案空格尚未確認，未執行回填。");
  }
  const candidate = question.candidates.find((item) => item.token === question.selectedToken);
  const parsedQuestion = parseWorksheetGrid(grid).questions.find((item) => item.questionNumber === questionNumber);
  if (
    !candidate ||
    !parsedQuestion?.candidateSlots.some((location) =>
      location.sheetId === candidate.location.sheetId &&
      location.rowIndex === candidate.location.rowIndex &&
      location.columnIndex === candidate.location.columnIndex
    )
  ) {
    throw new AppError(409, errorCodes.conflict, "無法唯一確認題號對應的答案空格，未執行回填。");
  }

  const expectedFingerprint = worksheetFingerprint(updatedGrid(grid, candidate.location, answer));
  return {
    alreadyWritten: false,
    expectedFingerprint,
    sheetTitle: grid.title,
    location: candidate.location,
  };
}

export async function applyGuidedNotesWriteback(
  activity: ImportedActivity,
  prepared: Extract<PreparedWriteback, { alreadyWritten: false }>,
  answer: string,
): Promise<void> {
  await writeWorksheetAnswers(activity.teacherId, activity.spreadsheetId, prepared.sheetTitle, [
    { location: prepared.location, answer },
  ]);
  const verified = await readWorksheet(activity.teacherId, activity.spreadsheetId, activity.sheetId);
  if (worksheetFingerprint(verified) !== prepared.expectedFingerprint) {
    throw new AppError(409, errorCodes.conflict, "回填後工作表與預期不符，請檢查原工作表。");
  }
}
