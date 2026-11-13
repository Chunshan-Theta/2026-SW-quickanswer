export interface WorksheetCell {
  formattedValue?: string;
  userEnteredValue?: {
    stringValue?: string;
    formulaValue?: string;
    numberValue?: number;
  };
  note?: string;
}

export interface WorksheetRow {
  values?: WorksheetCell[];
}

export interface WorksheetGrid {
  sheetId: number;
  title: string;
  rows: WorksheetRow[];
}

export interface CellLocation {
  sheetId: number;
  rowIndex: number;
  columnIndex: number;
}

export interface WorksheetIssue {
  code:
    | "duplicate_question_number"
    | "missing_question_number"
    | "missing_answer_slot"
    | "ambiguous_answer_slot"
    | "orphan_answer_slot"
    ;
  questionNumber?: string;
  message: string;
}

export interface ParsedQuestion {
  questionNumber: string;
  prompt: string;
  answerSlot: CellLocation | null;
  candidateSlots: CellLocation[];
  mappingStatus: "confirmed" | "ambiguous" | "missing";
}

export interface WorksheetParseResult {
  valid: boolean;
  questions: ParsedQuestion[];
  issues: WorksheetIssue[];
}

const questionPattern = /^(?:q(?:uestion)?\s*)?(\d+)\s*(?:[.)、:：]|題[.、:：]?)\s*(.+)$/i;
const answerMarkerPattern = /\{\{\s*(?:answer|blank)\s*:\s*(\d+)\s*\}\}|\[\[\s*answer\s*:\s*(\d+)\s*\]\]/gi;

function cellText(cell: WorksheetCell): string {
  if (typeof cell.formattedValue === "string") return cell.formattedValue.trim();
  if (typeof cell.userEnteredValue?.stringValue === "string") {
    return cell.userEnteredValue.stringValue.trim();
  }
  return "";
}

function normalizeQuestionNumber(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function compareQuestionNumbers(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

export function parseWorksheetGrid(grid: WorksheetGrid): WorksheetParseResult {
  const issues: WorksheetIssue[] = [];
  const prompts = new Map<string, { prompt: string; occurrences: number }>();
  const slots = new Map<string, CellLocation[]>();
  const markers: Array<{ questionNumber: string; location: CellLocation }> = [];

  for (const [rowIndex, row] of grid.rows.entries()) {
    for (const [columnIndex, cell] of (row.values ?? []).entries()) {
      const location = { sheetId: grid.sheetId, rowIndex, columnIndex };
      const texts = [cellText(cell), cell.note?.trim() ?? ""].filter(Boolean);

      for (const text of texts) {
        const promptMatch = questionPattern.exec(text);
        if (promptMatch) {
          const questionNumber = normalizeQuestionNumber(promptMatch[1]);
          const existing = prompts.get(questionNumber);
          prompts.set(questionNumber, {
            prompt: promptMatch[2].trim(),
            occurrences: (existing?.occurrences ?? 0) + 1,
          });
        }

        answerMarkerPattern.lastIndex = 0;
        let markerMatch: RegExpExecArray | null;
        while ((markerMatch = answerMarkerPattern.exec(text)) !== null) {
          const questionNumber = normalizeQuestionNumber(markerMatch[1] ?? markerMatch[2]);
          markers.push({ questionNumber, location });
          const locations = slots.get(questionNumber) ?? [];
          locations.push(location);
          slots.set(questionNumber, locations);
        }
      }
    }
  }

  for (const [questionNumber, prompt] of prompts) {
    if (prompt.occurrences > 1) {
      issues.push({
        code: "duplicate_question_number",
        questionNumber,
        message: `題號 ${questionNumber} 重複。`,
      });
    }
  }

  const sortedNumbers = [...prompts.keys()].sort(compareQuestionNumbers);
  for (const [index, questionNumber] of sortedNumbers.entries()) {
    const expectedNumber = String(index + 1);
    if (questionNumber !== expectedNumber) {
      issues.push({
        code: "missing_question_number",
        questionNumber: expectedNumber,
        message: `缺少題號 ${expectedNumber}。`,
      });
      break;
    }
  }

  for (const { questionNumber } of markers) {
    if (!prompts.has(questionNumber)) {
      issues.push({
        code: "orphan_answer_slot",
        questionNumber,
        message: `答案空格標記 ${questionNumber} 沒有對應題目。`,
      });
    }
  }

  const questions = [...prompts.entries()]
    .sort(([left], [right]) => compareQuestionNumbers(left, right))
    .map(([questionNumber, { prompt }]) => {
      const candidateSlots = slots.get(questionNumber) ?? [];
      const mappingStatus =
        candidateSlots.length === 1 ? "confirmed" : candidateSlots.length === 0 ? "missing" : "ambiguous";

      if (mappingStatus === "missing") {
        issues.push({
          code: "missing_answer_slot",
          questionNumber,
          message: `題號 ${questionNumber} 找不到答案空格標記。`,
        });
      } else if (mappingStatus === "ambiguous") {
        issues.push({
          code: "ambiguous_answer_slot",
          questionNumber,
          message: `題號 ${questionNumber} 對應多個答案空格。`,
        });
      }

      return {
        questionNumber,
        prompt,
        answerSlot: mappingStatus === "confirmed" ? candidateSlots[0] : null,
        candidateSlots,
        mappingStatus,
      } satisfies ParsedQuestion;
    });

  return { valid: issues.length === 0 && questions.length > 0, questions, issues };
}
