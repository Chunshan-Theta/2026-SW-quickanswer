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
import { structureFingerprint } from "@/features/sheets/application/worksheet-fingerprint";
import { parseWorksheetGrid, type WorksheetGrid } from "@/features/sheets/domain/worksheet-parser";
import type { ImportedActivity } from "@/features/sheets/application/import-guided-notes";
import { AppError } from "@/server/http/errors";
import { gridFromA1, groupTemplateCells, groupTemplateGrid, withCells } from "../../fixtures/guided-notes-templates";

/** Builds the activity the import use case would persist for this grid. */
function activityFor(grid: WorksheetGrid): ImportedActivity {
  const parsed = parseWorksheetGrid(grid);
  return {
    activityId: "activity-1",
    teacherId: "teacher-1",
    spreadsheetId: "sheet-1",
    sheetId: grid.sheetId,
    joinCode: "ABC234",
    phase: "ready",
    layout: parsed.layout.kind,
    structureFingerprint: structureFingerprint(parsed),
    groupNames: ["Blue", "Red"],
    questions: parsed.questions.map((question) => ({
      questionNumber: question.questionNumber,
      prompt: question.prompt,
      kind: question.kind,
      mappingStatus: question.mappingStatus,
      blanks: question.blanks.map((blank, index) => ({
        label: blank.label,
        prompt: blank.prompt,
        mappingStatus: blank.mappingStatus,
        candidates: blank.candidateSlots.map((location, slot) => ({ token: `q${question.questionNumber}-b${index}-s${slot}`, location })),
        selectedToken: blank.mappingStatus === "confirmed" ? `q${question.questionNumber}-b${index}-s0` : null,
      })),
    })),
  };
}

const template = groupTemplateGrid();
const activity = activityFor(template);

describe("Guided Notes writeback (002)", () => {
  afterEach(() => vi.resetAllMocks());

  it("writes every blank of a group question with its （n） label and verifies the cells", async () => {
    const written = withCells(template, { G5: "（1）CPU", G6: "（2）作業系統" });
    mocks.readWorksheet.mockResolvedValueOnce(template).mockResolvedValueOnce(written);

    const prepared = await prepareGuidedNotesWriteback(activity, "1", ["CPU", "作業系統"]);
    if (prepared.alreadyWritten) throw new Error("Expected an unapplied writeback.");
    await applyGuidedNotesWriteback(activity, prepared);

    expect(mocks.writeWorksheetAnswers).toHaveBeenCalledWith("teacher-1", "sheet-1", "學習單", [
      { location: { sheetId: template.sheetId, rowIndex: 4, columnIndex: 6 }, answer: "（1）CPU" },
      { location: { sheetId: template.sheetId, rowIndex: 5, columnIndex: 6 }, answer: "（2）作業系統" },
    ]);
  });

  it("still writes later questions after an earlier writeback changed the sheet (regression)", async () => {
    const afterFirst = withCells(template, { G5: "（1）CPU", G6: "（2）作業系統" });
    const afterSecond = withCells(afterFirst, { G11: "0" });
    mocks.readWorksheet.mockResolvedValueOnce(afterFirst).mockResolvedValueOnce(afterSecond);

    const prepared = await prepareGuidedNotesWriteback(activity, "3", ["0"]);
    if (prepared.alreadyWritten) throw new Error("Expected an unapplied writeback.");
    await expect(applyGuidedNotesWriteback(activity, prepared)).resolves.toBeUndefined();
    expect(mocks.writeWorksheetAnswers).toHaveBeenCalledWith("teacher-1", "sheet-1", "學習單", [
      { location: { sheetId: template.sheetId, rowIndex: 10, columnIndex: 6 }, answer: "0" },
    ]);
  });

  it("tolerates edits that do not change the question structure", async () => {
    mocks.readWorksheet.mockResolvedValue(withCells(template, { B2: "改過的學習單標題", C13: "改過的題目文字" }));

    await expect(prepareGuidedNotesWriteback(activity, "4", ["IP"])).resolves.toMatchObject({ alreadyWritten: false });
  });

  it("fails closed without writing when a question row was removed", async () => {
    const { cells, merges } = groupTemplateCells();
    delete cells.B13;
    delete cells.C13;
    mocks.readWorksheet.mockResolvedValue(gridFromA1(cells, merges));

    await expect(prepareGuidedNotesWriteback(activity, "3", ["0"])).rejects.toMatchObject({ status: 409 });
    expect(mocks.writeWorksheetAnswers).not.toHaveBeenCalled();
  });

  it("rejects an answer count that does not match the blanks", async () => {
    mocks.readWorksheet.mockResolvedValue(template);

    await expect(prepareGuidedNotesWriteback(activity, "1", ["only one"])).rejects.toMatchObject({ status: 409 });
  });

  it("treats a replay whose target cells already hold the answers as done", async () => {
    mocks.readWorksheet.mockResolvedValue(withCells(template, { G5: "（1）CPU", G6: "（2）作業系統" }));

    await expect(prepareGuidedNotesWriteback(activity, "1", ["CPU", "作業系統"])).resolves.toMatchObject({ alreadyWritten: true });
    expect(mocks.writeWorksheetAnswers).not.toHaveBeenCalled();
  });

  it("does not report success when the re-read cells differ from the answers", async () => {
    mocks.readWorksheet.mockResolvedValueOnce(template).mockResolvedValueOnce(template);

    const prepared = await prepareGuidedNotesWriteback(activity, "3", ["0"]);
    if (prepared.alreadyWritten) throw new Error("Expected an unapplied writeback.");
    await expect(applyGuidedNotesWriteback(activity, prepared)).rejects.toMatchObject({ status: 409 });
  });

  it("writes RAW formula-like answers as text and keeps marker-layout writebacks independent", async () => {
    const markerGrid: WorksheetGrid = {
      sheetId: 7,
      title: "Notes",
      rows: [{ values: [{ formattedValue: "1. Prompt" }, { formattedValue: "{{answer:1}}" }, { formattedValue: "2. Next" }, { formattedValue: "{{answer:2}}" }] }],
    };
    const markerActivity = activityFor(markerGrid);
    const afterFirst = withCells(markerGrid, { B1: "=1+1" });
    mocks.readWorksheet.mockResolvedValueOnce(afterFirst).mockResolvedValueOnce(withCells(afterFirst, { D1: "second" }));

    const prepared = await prepareGuidedNotesWriteback(markerActivity, "2", ["second"]);
    if (prepared.alreadyWritten) throw new Error("Expected an unapplied writeback.");
    await applyGuidedNotesWriteback(markerActivity, prepared);
    expect(mocks.writeWorksheetAnswers).toHaveBeenCalledWith("teacher-1", "sheet-1", "Notes", [
      { location: { sheetId: 7, rowIndex: 0, columnIndex: 3 }, answer: "second" },
    ]);

    mocks.readWorksheet.mockResolvedValue(afterFirst);
    await expect(prepareGuidedNotesWriteback(markerActivity, "1", ["=1+1"])).resolves.toMatchObject({ alreadyWritten: true });
  });

  it("overwrites a marker cell that holds the previously published answer when the teacher re-selects (005)", async () => {
    const markerGrid: WorksheetGrid = {
      sheetId: 7,
      title: "Notes",
      rows: [{ values: [{ formattedValue: "1. Prompt" }, { formattedValue: "{{answer:1}}" }] }],
    };
    const markerActivity = activityFor(markerGrid);
    const afterFirst = withCells(markerGrid, { B1: "wrong" });
    mocks.readWorksheet.mockResolvedValueOnce(afterFirst).mockResolvedValueOnce(withCells(markerGrid, { B1: "right" }));

    const prepared = await prepareGuidedNotesWriteback(markerActivity, "1", ["right"], ["wrong"]);
    if (prepared.alreadyWritten) throw new Error("Expected an unapplied writeback.");
    await applyGuidedNotesWriteback(markerActivity, prepared);
    expect(mocks.writeWorksheetAnswers).toHaveBeenCalledWith("teacher-1", "sheet-1", "Notes", [
      { location: { sheetId: 7, rowIndex: 0, columnIndex: 1 }, answer: "right" },
    ]);

    // Content the app did not write still fails closed.
    mocks.readWorksheet.mockResolvedValue(withCells(markerGrid, { B1: "edited by hand" }));
    await expect(prepareGuidedNotesWriteback(markerActivity, "1", ["right"], ["wrong"])).rejects.toMatchObject({ status: 409 });
  });

  it("reports revoked Google access without attempting a write", async () => {
    mocks.readWorksheet.mockRejectedValue(new AppError(403, "FORBIDDEN", "Google access revoked"));

    await expect(prepareGuidedNotesWriteback(activity, "1", ["a", "b"])).rejects.toMatchObject({ status: 403 });
    expect(mocks.writeWorksheetAnswers).not.toHaveBeenCalled();
  });
});
