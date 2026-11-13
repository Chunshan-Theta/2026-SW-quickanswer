import { describe, expect, it } from "vitest";
import { parseWorksheetGrid } from "@/features/sheets/domain/worksheet-parser";

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
