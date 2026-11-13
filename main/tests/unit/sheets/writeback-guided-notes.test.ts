import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readWorksheet: vi.fn(),
  writeWorksheetAnswers: vi.fn(),
}));

vi.mock("@/features/sheets/google-sheets.adapter", () => ({
  readWorksheet: mocks.readWorksheet,
  writeWorksheetAnswers: mocks.writeWorksheetAnswers,
}));

import { applyGuidedNotesWriteback, prepareGuidedNotesWriteback } from "@/features/sheets/application/writeback-guided-notes";
import { worksheetFingerprint } from "@/features/sheets/application/worksheet-fingerprint";
import type { WorksheetGrid } from "@/features/sheets/domain/worksheet-parser";
import type { ImportedActivity } from "@/features/sheets/application/import-guided-notes";
import { AppError } from "@/server/http/errors";

const grid: WorksheetGrid = {
  sheetId: 7,
  title: "Notes",
  rows: [{ values: [{ formattedValue: "1. Prompt" }, { formattedValue: "{{answer:1}}" }, { formattedValue: "Keep this note" }] }],
};
const activity: ImportedActivity = {
  activityId: "activity-1",
  teacherId: "teacher-1",
  spreadsheetId: "sheet-1",
  sheetId: 7,
  joinCode: "ABC234",
  phase: "ready",
  fingerprint: worksheetFingerprint(grid),
  groupNames: ["Blue", "Red"],
  questions: [{
    questionNumber: "1",
    prompt: "Prompt",
    mappingStatus: "confirmed",
    candidates: [{ token: "slot-token", location: { sheetId: 7, rowIndex: 0, columnIndex: 1 } }],
    selectedToken: "slot-token",
  }],
};

function updatedGrid(answer: string): WorksheetGrid {
  const prompt = grid.rows[0].values?.[0];
  if (!prompt) throw new Error("Missing test prompt cell.");
  return {
    ...grid,
    rows: [{ values: [{ ...prompt }, { formattedValue: answer, userEnteredValue: { stringValue: answer } }, { formattedValue: "Keep this note" }] }],
  };
}

describe("Guided Notes writeback", () => {
  afterEach(() => vi.resetAllMocks());

  it("writes only the confirmed dynamic target and verifies the resulting scan", async () => {
    mocks.readWorksheet.mockResolvedValueOnce(grid).mockResolvedValueOnce(updatedGrid("=1+1"));

    const prepared = await prepareGuidedNotesWriteback(activity, "1", "=1+1");
    expect(prepared).toMatchObject({
      alreadyWritten: false,
      location: { sheetId: 7, rowIndex: 0, columnIndex: 1 },
    });
    if (prepared.alreadyWritten) throw new Error("Expected an unapplied writeback.");
    await applyGuidedNotesWriteback(activity, prepared, "=1+1");

    expect(mocks.writeWorksheetAnswers).toHaveBeenCalledWith("teacher-1", "sheet-1", "Notes", [
      { location: { sheetId: 7, rowIndex: 0, columnIndex: 1 }, answer: "=1+1" },
    ]);
  });

  it("fails closed when the sheet changed after import", async () => {
    mocks.readWorksheet.mockResolvedValue({ ...grid, rows: [{ values: [{ formattedValue: "changed" }] }] });

    await expect(prepareGuidedNotesWriteback(activity, "1", "answer")).rejects.toMatchObject({ status: 409 });
    expect(mocks.writeWorksheetAnswers).not.toHaveBeenCalled();
  });

  it("recognizes a previously applied write from its persisted expected fingerprint", async () => {
    const postWriteFingerprint = worksheetFingerprint(updatedGrid("answer"));
    mocks.readWorksheet.mockResolvedValue(updatedGrid("answer"));

    await expect(prepareGuidedNotesWriteback(activity, "1", "answer", postWriteFingerprint)).resolves.toEqual({
      alreadyWritten: true,
      expectedFingerprint: postWriteFingerprint,
    });
  });

  it("reports revoked Google access without attempting a write", async () => {
    mocks.readWorksheet.mockRejectedValue(new AppError(403, "FORBIDDEN", "Google access revoked"));

    await expect(prepareGuidedNotesWriteback(activity, "1", "answer")).rejects.toMatchObject({ status: 403 });
    expect(mocks.writeWorksheetAnswers).not.toHaveBeenCalled();
  });
});
