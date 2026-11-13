import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readWorksheet: vi.fn(), getRedisClient: vi.fn(), set: vi.fn() }));
vi.mock("@/features/sheets/google-sheets.adapter", () => ({ readWorksheet: mocks.readWorksheet }));
vi.mock("@/server/redis/client", () => ({ getRedisClient: mocks.getRedisClient }));

import { importGuidedNotes } from "@/features/sheets/application/import-guided-notes";
import { AppError } from "@/server/http/errors";

const input = { spreadsheetId: "sheet-1", sheetId: 7, groupNames: ["A", "B"] };
const grid = {
  sheetId: 7,
  title: "Guided Notes",
  rows: [
    { values: [{ formattedValue: "1. First question" }, { formattedValue: "{{answer:1}}" }] },
    { values: [{ formattedValue: "2. Second question" }, { formattedValue: "{{answer:2}}" }] },
  ],
};

describe("importGuidedNotes", () => {
  afterEach(() => vi.resetAllMocks());

  it("creates a ready activity with dynamically scanned questions", async () => {
    mocks.readWorksheet.mockResolvedValue(grid);
    mocks.getRedisClient.mockResolvedValue({ set: mocks.set });
    mocks.set.mockResolvedValue("OK");

    const result = await importGuidedNotes("teacher-1", input);

    expect(result.phase).toBe("ready");
    expect(result.questions.map((question) => question.questionNumber)).toEqual(["1", "2"]);
    expect(result.questions.every((question) => question.mappingStatus === "confirmed")).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith(expect.stringMatching(/^activity:.+:meta$/), expect.any(String), { EX: 604800 });
  });

  it("returns mapping_review with opaque candidates for ambiguous slots", async () => {
    mocks.readWorksheet.mockResolvedValue({
      sheetId: 7,
      title: "Guided Notes",
      rows: [{ values: [{ formattedValue: "1. First question" }, { formattedValue: "{{answer:1}}" }, { formattedValue: "{{blank:1}}" }] }],
    });
    mocks.getRedisClient.mockResolvedValue({ set: mocks.set });
    mocks.set.mockResolvedValue("OK");

    const result = await importGuidedNotes("teacher-1", input);

    expect(result.phase).toBe("mapping_review");
    expect(result.questions[0].candidateSlotTokens).toHaveLength(2);
    expect(result.questions[0].candidateSlotTokens[0]).not.toContain("rowIndex");
  });

  it("rejects duplicate or missing question numbers before writing an activity", async () => {
    mocks.readWorksheet.mockResolvedValue({
      sheetId: 7,
      title: "Broken Notes",
      rows: [{ values: [{ formattedValue: "1. First" }, { formattedValue: "{{answer:1}}" }, { formattedValue: "3. Third" }, { formattedValue: "{{answer:3}}" }] }],
    });

    await expect(importGuidedNotes("teacher-1", input)).rejects.toBeInstanceOf(AppError);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
