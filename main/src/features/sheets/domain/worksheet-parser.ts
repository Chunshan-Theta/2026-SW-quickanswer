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

/** A merged range in 0-based grid coordinates; end indexes are exclusive (Google Sheets GridRange). */
export interface MergeRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface WorksheetGrid {
  sheetId: number;
  title: string;
  rows: WorksheetRow[];
  merges?: MergeRange[];
}

export interface CellLocation {
  sheetId: number;
  rowIndex: number;
  columnIndex: number;
}

export type WorksheetIssueCode =
  | "duplicate_question_number"
  | "missing_question_number"
  | "unrecognized_question_row"
  | "question_count_mismatch"
  | "missing_answer_slot"
  | "ambiguous_answer_slot"
  | "orphan_answer_slot"
  | "no_questions_found"
  | "header_missing_answer_column";

export interface WorksheetIssue {
  code: WorksheetIssueCode;
  questionNumber?: string;
  /** 1-based spreadsheet row number, when the issue can be located. */
  rowNumber?: number;
  message: string;
}

export type MappingStatus = "confirmed" | "ambiguous" | "missing";

export interface ParsedBlank {
  /** Sub-question marker found at the start of the answer cell, e.g. "（1）". */
  label: string | null;
  prompt: string;
  answerSlot: CellLocation | null;
  candidateSlots: CellLocation[];
  mappingStatus: MappingStatus;
}

export interface ParsedQuestion {
  questionNumber: string;
  prompt: string;
  kind: "single" | "group";
  firstRow: number;
  lastRow: number;
  blanks: ParsedBlank[];
  /** Compatibility fields: the first blank's slot data. */
  answerSlot: CellLocation | null;
  candidateSlots: CellLocation[];
  mappingStatus: MappingStatus;
}

export interface WorksheetLayout {
  kind: "table" | "marker";
  headerRow?: number;
  numberColumn?: number;
  promptColumn?: number | null;
  answerColumn?: number;
}

export interface WorksheetParseResult {
  valid: boolean;
  layout: WorksheetLayout;
  questions: ParsedQuestion[];
  issues: WorksheetIssue[];
  /**
   * Serializable description of the question structure (numbers, rows and answer-cell positions).
   * It never contains answer-cell contents, so writing answers back does not change it.
   */
  structure: unknown;
}

const questionPattern = /^(?:q(?:uestion)?\s*)?(\d+)\s*(?:[.)、:：]|題[.、:：]?)\s*(.+)$/i;
const questionLikePattern = /^(?:q(?:uestion)?(?:\s*\d+)?\b|\d+\s*(?:[.)、:：]|題)|\d+\s+\S)/i;
const answerMarkerPattern = /\{\{\s*(?:answer|blank)\s*:\s*(\d+)\s*\}\}|\[\[\s*answer\s*:\s*(\d+)\s*\]\]/gi;
const tableNumberPattern = /^(?:第\s*)?(?:q\s*)?(\d+)\s*(?:題)?\s*[.、．:：)）]?$/i;
export const blankLabelPattern = /^[（(]\s*\d+\s*[)）]/;

const numberHeaders = new Set(["題號"]);
const promptHeaders = new Set(["題目"]);
const answerHeaders = new Set(["作答", "答案"]);

const supportedFormatsHint =
  "支援的格式：表格標題列含「題號」與「作答」（或「答案」）欄；或題目格以「1. 題目」開頭並在答案格放入 {{answer:1}}。";

function cellText(cell: WorksheetCell | undefined): string {
  if (!cell) return "";
  if (typeof cell.formattedValue === "string") return cell.formattedValue.trim();
  if (typeof cell.userEnteredValue?.stringValue === "string") {
    return cell.userEnteredValue.stringValue.trim();
  }
  return "";
}

/** Text of the cell at a location (no merge resolution; callers pass merge top-left locations). */
export function cellTextAt(grid: WorksheetGrid, location: Pick<CellLocation, "rowIndex" | "columnIndex">): string {
  return cellText(grid.rows[location.rowIndex]?.values?.[location.columnIndex]);
}

export function blankLabel(text: string): string | null {
  return blankLabelPattern.exec(text.trim())?.[0] ?? null;
}

function normalizeQuestionNumber(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function compareQuestionNumbers(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function normalizeHeader(text: string): string {
  return text.replace(/[\s　]+/g, "").toLowerCase();
}

function aggregateStatus(blanks: ParsedBlank[]): MappingStatus {
  if (blanks.some((blank) => blank.mappingStatus === "missing")) return "missing";
  if (blanks.some((blank) => blank.mappingStatus === "ambiguous")) return "ambiguous";
  return "confirmed";
}

function buildQuestion(
  questionNumber: string,
  blanks: ParsedBlank[],
  rows: { firstRow: number; lastRow: number },
  prompt?: string,
): ParsedQuestion {
  const kind = blanks.length > 1 ? "group" : "single";
  return {
    questionNumber,
    prompt: prompt ?? (kind === "single" ? blanks[0].prompt : blanks.map((blank) => blank.prompt).filter(Boolean).join("／")),
    kind,
    firstRow: rows.firstRow,
    lastRow: rows.lastRow,
    blanks,
    answerSlot: blanks[0].answerSlot,
    candidateSlots: blanks[0].candidateSlots,
    mappingStatus: aggregateStatus(blanks),
  };
}

/** Reports duplicate and non-contiguous numbers; numbers must run 1..N. */
function validateNumbering(numbers: Array<{ questionNumber: string; rowIndex: number }>, issues: WorksheetIssue[]): void {
  const seen = new Map<string, number>();
  for (const { questionNumber, rowIndex } of numbers) {
    const firstRow = seen.get(questionNumber);
    if (firstRow === undefined) {
      seen.set(questionNumber, rowIndex);
    } else {
      issues.push({
        code: "duplicate_question_number",
        questionNumber,
        rowNumber: rowIndex + 1,
        message: `題號 ${questionNumber} 重複（第 ${firstRow + 1} 列與第 ${rowIndex + 1} 列）。`,
      });
    }
  }
  const sorted = [...seen.keys()].sort(compareQuestionNumbers);
  for (const [index, questionNumber] of sorted.entries()) {
    const expectedNumber = String(index + 1);
    if (questionNumber !== expectedNumber) {
      issues.push({
        code: "missing_question_number",
        questionNumber: expectedNumber,
        message: `缺少題號 ${expectedNumber}（題號必須從 1 開始連續編號）。`,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Merge resolution
// ---------------------------------------------------------------------------

type Resolver = (rowIndex: number, columnIndex: number) => { rowIndex: number; columnIndex: number };

function mergeResolver(merges: MergeRange[] = []): Resolver {
  const topLeft = new Map<string, { rowIndex: number; columnIndex: number }>();
  for (const merge of merges) {
    for (let row = merge.startRow; row < merge.endRow; row += 1) {
      for (let column = merge.startColumn; column < merge.endColumn; column += 1) {
        topLeft.set(`${row}:${column}`, { rowIndex: merge.startRow, columnIndex: merge.startColumn });
      }
    }
  }
  return (rowIndex, columnIndex) => topLeft.get(`${rowIndex}:${columnIndex}`) ?? { rowIndex, columnIndex };
}

// ---------------------------------------------------------------------------
// Table layout: header row with 題號 / 題目 / 作答(答案)
// ---------------------------------------------------------------------------

type HeaderSearch =
  | { found: true; row: number; numberColumn: number; promptColumn: number | null; answerColumn: number }
  | { found: false; numberHeaderRow: number | null };

function findHeader(grid: WorksheetGrid): HeaderSearch {
  for (const [rowIndex, row] of grid.rows.entries()) {
    let numberColumn: number | null = null;
    let promptColumn: number | null = null;
    let answerColumn: number | null = null;
    for (const [columnIndex, cell] of (row.values ?? []).entries()) {
      const text = normalizeHeader(cellText(cell));
      if (numberColumn === null && numberHeaders.has(text)) numberColumn = columnIndex;
      else if (promptColumn === null && promptHeaders.has(text)) promptColumn = columnIndex;
      else if (answerColumn === null && answerHeaders.has(text)) answerColumn = columnIndex;
    }
    if (numberColumn === null) continue;
    if (answerColumn === null) return { found: false, numberHeaderRow: rowIndex };
    return { found: true, row: rowIndex, numberColumn, promptColumn, answerColumn };
  }
  return { found: false, numberHeaderRow: null };
}

type DraftRow = { rowIndex: number; prompt: string; answer: { rowIndex: number; columnIndex: number }; answerText: string };
type Draft = { questionNumber: string; numberCellKey: string; firstRow: number; lastRow: number; rows: DraftRow[] };

function parseTableLayout(
  grid: WorksheetGrid,
  header: Extract<HeaderSearch, { found: true }>,
): WorksheetParseResult {
  const issues: WorksheetIssue[] = [];
  const resolve = mergeResolver(grid.merges);
  const text = (rowIndex: number, columnIndex: number) => cellTextAt(grid, resolve(rowIndex, columnIndex));
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (let rowIndex = header.row + 1; rowIndex < grid.rows.length; rowIndex += 1) {
    const numberCell = resolve(rowIndex, header.numberColumn);
    const numberText = numberCell.rowIndex > header.row ? cellTextAt(grid, numberCell) : "";
    const prompt = header.promptColumn === null ? "" : text(rowIndex, header.promptColumn);
    const answer = resolve(rowIndex, header.answerColumn);
    const answerText = cellTextAt(grid, answer);
    const draftRow: DraftRow = { rowIndex, prompt, answer, answerText };

    if (numberText) {
      const match = tableNumberPattern.exec(numberText);
      if (!match) {
        issues.push({
          code: "unrecognized_question_row",
          rowNumber: rowIndex + 1,
          message: `第 ${rowIndex + 1} 列的題號「${numberText}」無法辨識，題號欄請填入數字。`,
        });
        current = null;
        continue;
      }
      const questionNumber = normalizeQuestionNumber(match[1]);
      const numberCellKey = `${numberCell.rowIndex}:${numberCell.columnIndex}`;
      const continuesCurrent = current !== null && (
        current.numberCellKey === numberCellKey ||
        (current.questionNumber === questionNumber && current.lastRow === rowIndex - 1)
      );
      if (continuesCurrent && current) {
        current.rows.push(draftRow);
        current.lastRow = rowIndex;
      } else {
        current = { questionNumber, numberCellKey, firstRow: rowIndex, lastRow: rowIndex, rows: [draftRow] };
        drafts.push(current);
      }
      continue;
    }

    // An unnumbered row directly below a question with a sub-prompt or a "（n）" label is a sub-question.
    if (current && current.lastRow === rowIndex - 1 && (prompt || blankLabel(answerText))) {
      current.rows.push(draftRow);
      current.lastRow = rowIndex;
      continue;
    }
    current = null;
  }

  const answerOwners = new Map<string, string>();
  const questions: ParsedQuestion[] = drafts.map((draft) => {
    const blanks: ParsedBlank[] = [];
    const blankByCell = new Map<string, ParsedBlank>();
    for (const row of draft.rows) {
      const key = `${row.answer.rowIndex}:${row.answer.columnIndex}`;
      const existing = blankByCell.get(key);
      if (existing) {
        if (row.prompt && row.prompt !== existing.prompt) existing.prompt = [existing.prompt, row.prompt].filter(Boolean).join(" ");
        continue;
      }
      const owner = answerOwners.get(key);
      const location = { sheetId: grid.sheetId, ...row.answer };
      const blank: ParsedBlank = owner === undefined
        ? { label: blankLabel(row.answerText), prompt: row.prompt, answerSlot: location, candidateSlots: [location], mappingStatus: "confirmed" }
        : { label: null, prompt: row.prompt, answerSlot: null, candidateSlots: [], mappingStatus: "missing" };
      if (owner === undefined) {
        answerOwners.set(key, draft.questionNumber);
      } else {
        issues.push({
          code: "missing_answer_slot",
          questionNumber: draft.questionNumber,
          rowNumber: row.rowIndex + 1,
          message: `第 ${draft.questionNumber} 題（第 ${row.rowIndex + 1} 列）的作答格與第 ${owner} 題共用，請為每題保留獨立的作答格。`,
        });
      }
      blankByCell.set(key, blank);
      blanks.push(blank);
    }
    return buildQuestion(draft.questionNumber, blanks, draft);
  });

  validateNumbering(drafts.map((draft) => ({ questionNumber: draft.questionNumber, rowIndex: draft.firstRow })), issues);
  if (questions.length === 0) {
    issues.push({
      code: "no_questions_found",
      rowNumber: header.row + 1,
      message: `第 ${header.row + 1} 列是標題列，但下方的「題號」欄沒有任何題號。`,
    });
  }

  questions.sort((left, right) => compareQuestionNumbers(left.questionNumber, right.questionNumber));
  return {
    valid: issues.length === 0 && questions.length > 0,
    layout: {
      kind: "table",
      headerRow: header.row,
      numberColumn: header.numberColumn,
      promptColumn: header.promptColumn,
      answerColumn: header.answerColumn,
    },
    questions,
    issues,
    structure: {
      layout: "table",
      header: [header.row, header.numberColumn, header.promptColumn, header.answerColumn],
      questions: drafts.map((draft) => [
        draft.questionNumber,
        draft.firstRow,
        draft.lastRow,
        [...new Set(draft.rows.map((row) => `${row.answer.rowIndex}:${row.answer.columnIndex}`))],
      ]),
    },
  };
}

// ---------------------------------------------------------------------------
// Marker layout: "1. 題目" in one cell and {{answer:1}} in the answer cell
// ---------------------------------------------------------------------------

function parseMarkerLayout(grid: WorksheetGrid): WorksheetParseResult {
  const issues: WorksheetIssue[] = [];
  const prompts = new Map<string, { prompt: string; occurrences: number; location: CellLocation }>();
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
            prompt: existing?.prompt ?? promptMatch[2].trim(),
            occurrences: (existing?.occurrences ?? 0) + 1,
            location: existing?.location ?? location,
          });
          if (existing) {
            issues.push({
              code: "duplicate_question_number",
              questionNumber,
              rowNumber: rowIndex + 1,
              message: `題號 ${questionNumber} 重複（第 ${existing.location.rowIndex + 1} 列與第 ${rowIndex + 1} 列）。`,
            });
          }
        } else if (questionLikePattern.test(text)) {
          issues.push({
            code: "unrecognized_question_row",
            rowNumber: rowIndex + 1,
            message: `第 ${rowIndex + 1} 列無法辨識題目格式：「${text}」。`,
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

  const sortedNumbers = [...prompts.keys()].sort(compareQuestionNumbers);
  for (const [index, questionNumber] of sortedNumbers.entries()) {
    const expectedNumber = String(index + 1);
    if (questionNumber !== expectedNumber) {
      issues.push({
        code: "missing_question_number",
        questionNumber: expectedNumber,
        message: `缺少題號 ${expectedNumber}（題號必須從 1 開始連續編號）。`,
      });
      break;
    }
  }

  for (const { questionNumber, location } of markers) {
    if (!prompts.has(questionNumber)) {
      issues.push({
        code: "orphan_answer_slot",
        questionNumber,
        rowNumber: location.rowIndex + 1,
        message: `第 ${location.rowIndex + 1} 列的答案記號 ${questionNumber} 沒有對應題目。`,
      });
    }
  }

  const sourceQuestionCount = new Set(markers.map(({ questionNumber }) => questionNumber)).size;
  if (prompts.size > 0 && sourceQuestionCount !== prompts.size) {
    issues.push({
      code: "question_count_mismatch",
      message: `題目數 ${prompts.size} 與答案記號數 ${sourceQuestionCount} 不一致。`,
    });
  }

  const questions = [...prompts.entries()]
    .sort(([left], [right]) => compareQuestionNumbers(left, right))
    .map(([questionNumber, { prompt, location }]) => {
      const candidateSlots = slots.get(questionNumber) ?? [];
      const mappingStatus: MappingStatus =
        candidateSlots.length === 1 ? "confirmed" : candidateSlots.length === 0 ? "missing" : "ambiguous";

      if (mappingStatus === "missing") {
        issues.push({
          code: "missing_answer_slot",
          questionNumber,
          rowNumber: location.rowIndex + 1,
          message: `第 ${questionNumber} 題（第 ${location.rowIndex + 1} 列）找不到答案記號 {{answer:${questionNumber}}}。`,
        });
      } else if (mappingStatus === "ambiguous") {
        issues.push({
          code: "ambiguous_answer_slot",
          questionNumber,
          rowNumber: location.rowIndex + 1,
          message: `第 ${questionNumber} 題對應多個答案格，請選擇其中一個。`,
        });
      }

      const blank: ParsedBlank = {
        label: null,
        prompt,
        answerSlot: mappingStatus === "confirmed" ? candidateSlots[0] : null,
        candidateSlots,
        mappingStatus,
      };
      return buildQuestion(questionNumber, [blank], { firstRow: location.rowIndex, lastRow: location.rowIndex });
    });

  if (questions.length === 0) {
    issues.push({ code: "no_questions_found", message: `找不到任何題目。${supportedFormatsHint}` });
  }

  return {
    valid: issues.length === 0 && questions.length > 0,
    layout: { kind: "marker" },
    questions,
    issues,
    structure: {
      layout: "marker",
      questions: questions.map((question) => {
        const location = prompts.get(question.questionNumber)!.location;
        return [question.questionNumber, location.rowIndex, location.columnIndex];
      }),
    },
  };
}

export function parseWorksheetGrid(grid: WorksheetGrid): WorksheetParseResult {
  const header = findHeader(grid);
  if (header.found) return parseTableLayout(grid, header);

  const marker = parseMarkerLayout(grid);
  if (marker.questions.length === 0 && header.numberHeaderRow !== null) {
    const rowNumber = header.numberHeaderRow + 1;
    return {
      ...marker,
      issues: [{
        code: "header_missing_answer_column",
        rowNumber,
        message: `第 ${rowNumber} 列有「題號」欄，但找不到「作答」或「答案」欄。請在標題列加入作答欄。`,
      }],
    };
  }
  return marker;
}
