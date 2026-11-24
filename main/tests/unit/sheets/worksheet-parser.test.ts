import { describe, expect, it } from "vitest";
import { parseWorksheetGrid } from "@/features/sheets/domain/worksheet-parser";
import { structureFingerprint } from "@/features/sheets/application/worksheet-fingerprint";
import {
  gridFromA1,
  groupTemplateGrid,
  singlePrompts,
  singleTemplateCells,
  singleTemplateGrid,
  withCells,
} from "../../fixtures/guided-notes-templates";

function cell(formattedValue: string) {
  return { formattedValue };
}

describe("parseWorksheetGrid", () => {
  it("maps numbered short-answer prompts to explicit answer markers by content", () => {
    const parsed = parseWorksheetGrid({
      sheetId: 7,
      title: "Guided Notes",
      rows: [
        { values: [cell("Notes"), cell("2. Why does the leaf need light?"), cell("{{answer:2}}"), cell("1. Name the process.")] },
        { values: [cell("{{answer:1}}"), cell("Teacher note")] },
      ],
    });

    expect(parsed.valid).toBe(true);
    expect(parsed.questions.map(({ questionNumber }) => questionNumber)).toEqual(["1", "2"]);
    expect(parsed.questions[0]).toMatchObject({
      prompt: "Name the process.",
      answerSlot: { rowIndex: 1, columnIndex: 0 },
      mappingStatus: "confirmed",
    });
    expect(parsed.questions[1]).toMatchObject({
      prompt: "Why does the leaf need light?",
      answerSlot: { rowIndex: 0, columnIndex: 2 },
      mappingStatus: "confirmed",
    });
  });

  it("reports duplicate, missing, and non-contiguous question numbers", () => {
    const parsed = parseWorksheetGrid({
      sheetId: 1,
      title: "Broken Notes",
      rows: [
        { values: [cell("1. First"), cell("{{answer:1}}"), cell("1. Duplicate")] },
        { values: [cell("3. Third"), cell("{{answer:3}}") ] },
      ],
    });

    expect(parsed.valid).toBe(false);
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_question_number", questionNumber: "1" }),
      expect.objectContaining({ code: "missing_question_number", questionNumber: "2" }),
    ]));
  });

  it("keeps ambiguous answer slots unresolved and reports missing markers", () => {
    const parsed = parseWorksheetGrid({
      sheetId: 3,
      title: "Ambiguous Notes",
      rows: [
        { values: [cell("1. First"), cell("{{answer:1}}"), cell("{{blank:1}}"), cell("2. Second")] },
      ],
    });

    expect(parsed.valid).toBe(false);
    expect(parsed.questions[0]).toMatchObject({ mappingStatus: "ambiguous", answerSlot: null });
    expect(parsed.questions[1]).toMatchObject({ mappingStatus: "missing", answerSlot: null });
    expect(parsed.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ambiguous_answer_slot",
      "missing_answer_slot",
    ]));
  });

  it("detects answer markers that do not reference a numbered question", () => {
    const parsed = parseWorksheetGrid({
      sheetId: 2,
      title: "Orphan Marker",
      rows: [{ values: [cell("1. Prompt"), cell("{{answer:8}}"), cell("{{answer:1}}") ] }],
    });

    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "orphan_answer_slot", questionNumber: "8" }),
    ]));
  });

  it("fails closed when a question-like row has an unsupported format", () => {
    const parsed = parseWorksheetGrid({
      sheetId: 2,
      title: "Unsupported Question",
      rows: [{ values: [cell("1. Prompt"), cell("{{answer:1}}"), cell("2 Prompt"), cell("{{answer:2}}")] }],
    });

    expect(parsed.valid).toBe(false);
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unrecognized_question_row" }),
    ]));
  });

  it("compares the answer-marker source count with parsed question count", () => {
    const parsed = parseWorksheetGrid({
      sheetId: 2,
      title: "Question Count Mismatch",
      rows: [{ values: [cell("1. First"), cell("{{answer:1}}"), cell("2. Second")] }],
    });

    expect(parsed.valid).toBe(false);
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_answer_slot", questionNumber: "2" }),
      expect.objectContaining({ code: "question_count_mismatch" }),
    ]));
  });

  it("preserves a worksheet with more than 200 consecutively numbered questions", () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      values: [cell(`${index + 1}. Prompt ${index + 1}`), cell(`{{answer:${index + 1}}}`)],
    }));
    const parsed = parseWorksheetGrid({ sheetId: 5, title: "Large Notes", rows });

    expect(parsed.valid).toBe(true);
    expect(parsed.questions).toHaveLength(205);
    expect(parsed.questions.at(-1)?.questionNumber).toBe("205");
  });
});

describe("parseWorksheetGrid – official table templates (002)", () => {
  it("imports the unmodified official single-question template without markers", () => {
    const parsed = parseWorksheetGrid(singleTemplateGrid());

    expect(parsed.valid).toBe(true);
    expect(parsed.layout).toMatchObject({ kind: "table", headerRow: 3, numberColumn: 1, promptColumn: 2, answerColumn: 6 });
    expect(parsed.questions.map((question) => question.questionNumber)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(parsed.questions.every((question) => question.kind === "single" && question.mappingStatus === "confirmed")).toBe(true);
    expect(parsed.questions[0]).toMatchObject({
      prompt: singlePrompts[0],
      blanks: [{ label: null, answerSlot: { rowIndex: 4, columnIndex: 6 } }],
    });
    expect(parsed.questions[5].blanks[0].answerSlot).toMatchObject({ rowIndex: 14, columnIndex: 6 });
  });

  it("re-detects questions after rows and columns are inserted (no fixed coordinates)", () => {
    const parsed = parseWorksheetGrid(singleTemplateGrid({ offset: { rows: 2, columns: 1 } }));

    expect(parsed.valid).toBe(true);
    expect(parsed.questions).toHaveLength(6);
    expect(parsed.questions[0].blanks[0].answerSlot).toMatchObject({ rowIndex: 6, columnIndex: 7 });
  });

  it("accepts the 答案 header synonym, common number formats, and a missing prompt column", () => {
    const parsed = parseWorksheetGrid(gridFromA1({
      A1: "題 號", B1: "答案",
      A2: "第1題", A3: "Q2", A4: "3.",
    }));

    expect(parsed.valid).toBe(true);
    expect(parsed.layout.promptColumn).toBeNull();
    expect(parsed.questions.map((question) => [question.questionNumber, question.blanks[0].answerSlot?.columnIndex])).toEqual([
      ["1", 1], ["2", 1], ["3", 1],
    ]);
  });

  it("prefers the table layout when a header row exists", () => {
    const { cells, merges } = singleTemplateCells();
    const parsed = parseWorksheetGrid(gridFromA1({ ...cells, J1: "{{answer:1}}" }, merges));

    expect(parsed.layout.kind).toBe("table");
    expect(parsed.valid).toBe(true);
  });

  it("recognises the official group template: merged numbers and （n） labels form one question", () => {
    const parsed = parseWorksheetGrid(groupTemplateGrid());

    expect(parsed.valid).toBe(true);
    expect(parsed.questions.map((question) => [question.questionNumber, question.kind, question.blanks.length])).toEqual([
      ["1", "group", 2], ["2", "group", 2], ["3", "single", 1], ["4", "single", 1],
    ]);
    expect(parsed.questions[0].blanks).toMatchObject([
      { label: "（1）", prompt: expect.stringContaining("大腦"), answerSlot: { rowIndex: 4, columnIndex: 6 } },
      { label: "（2）", prompt: expect.stringContaining("Windows"), answerSlot: { rowIndex: 5, columnIndex: 6 } },
    ]);
    expect(parsed.questions[0].prompt).toContain("／");
  });

  it("treats unmerged sub-question rows directly below a question as part of a group", () => {
    const parsed = parseWorksheetGrid(gridFromA1({
      B1: "題號", C1: "題目", D1: "作答",
      B2: "1", C2: "first part", D2: "(1)",
      C3: "second part", D3: "(2)",
      B5: "2", C5: "single",
    }));

    expect(parsed.valid).toBe(true);
    expect(parsed.questions[0]).toMatchObject({ kind: "group", blanks: [{ label: "(1)" }, { label: "(2)" }] });
    expect(parsed.questions[1]).toMatchObject({ kind: "single" });
  });

  it("groups adjacent rows that repeat the same number without merging", () => {
    const parsed = parseWorksheetGrid(gridFromA1({
      A1: "題號", B1: "題目", C1: "作答",
      A2: "1", B2: "a", A3: "1", B3: "b",
    }));

    expect(parsed.valid).toBe(true);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].blanks).toHaveLength(2);
  });

  it("reports non-adjacent duplicate numbers, gaps and unreadable numbers with row numbers", () => {
    const parsed = parseWorksheetGrid(gridFromA1({
      A1: "題號", B1: "題目", C1: "作答",
      A2: "1", B2: "a",
      A4: "1", B4: "again",
      A6: "3", B6: "c",
      A8: "一", B8: "d",
    }));

    expect(parsed.valid).toBe(false);
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_question_number", questionNumber: "1", rowNumber: 4 }),
      expect.objectContaining({ code: "missing_question_number", questionNumber: "2" }),
      expect.objectContaining({ code: "unrecognized_question_row", rowNumber: 8 }),
    ]));
  });

  it("always explains why nothing was imported", () => {
    const headerOnly = parseWorksheetGrid(gridFromA1({ A1: "題號", B1: "作答" }));
    const noAnswerColumn = parseWorksheetGrid(gridFromA1({ A3: "題號", B3: "題目", A4: "1", B4: "x" }));
    const empty = parseWorksheetGrid({ sheetId: 1, title: "空白", rows: [] });

    expect(headerOnly.issues).toEqual([expect.objectContaining({ code: "no_questions_found", rowNumber: 1 })]);
    expect(noAnswerColumn.issues).toEqual([expect.objectContaining({ code: "header_missing_answer_column", rowNumber: 3 })]);
    expect(empty.issues).toEqual([expect.objectContaining({ code: "no_questions_found" })]);
    for (const parsed of [headerOnly, noAnswerColumn, empty]) {
      expect(parsed.valid).toBe(false);
      expect(parsed.issues[0].message.length).toBeGreaterThan(0);
    }
  });
});

describe("structureFingerprint (002)", () => {
  it("is unchanged after answers are written into answer cells (table layout)", () => {
    const before = structureFingerprint(parseWorksheetGrid(groupTemplateGrid()));
    const after = structureFingerprint(parseWorksheetGrid(withCells(groupTemplateGrid(), {
      G5: "（1）CPU", G6: "（2）作業系統", G11: "0", B2: "新的標題",
    })));

    expect(after).toBe(before);
  });

  it("is unchanged after a marker is replaced by its answer (marker layout)", () => {
    const grid = { sheetId: 1, title: "Notes", rows: [{ values: [cell("1. First"), cell("{{answer:1}}"), cell("2. Second"), cell("{{answer:2}}")] }] };
    const written = { ...grid, rows: [{ values: [cell("1. First"), cell("Photosynthesis"), cell("2. Second"), cell("{{answer:2}}")] }] };

    expect(structureFingerprint(parseWorksheetGrid(written))).toBe(structureFingerprint(parseWorksheetGrid(grid)));
  });

  it("changes when a question row is removed or moved", () => {
    const original = structureFingerprint(parseWorksheetGrid(singleTemplateGrid()));
    const { cells, merges } = singleTemplateCells();
    delete cells.B15;
    delete cells.C15;

    expect(structureFingerprint(parseWorksheetGrid(gridFromA1(cells, merges)))).not.toBe(original);
    expect(structureFingerprint(parseWorksheetGrid(singleTemplateGrid({ offset: { rows: 1, columns: 0 } })))).not.toBe(original);
  });
});
