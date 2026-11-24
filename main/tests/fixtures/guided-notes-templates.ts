import type { MergeRange, WorksheetGrid, WorksheetRow } from "@/features/sheets/domain/worksheet-parser";

/** "C5" → { row: 4, column: 2 } (0-based). */
export function a1(reference: string): { row: number; column: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(reference);
  if (!match) throw new Error(`Invalid A1 reference ${reference}`);
  const column = [...match[1]].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(match[2]) - 1, column };
}

function mergeRange(range: string): MergeRange {
  const [from, to] = range.split(":").map(a1);
  return { startRow: from.row, endRow: to.row + 1, startColumn: from.column, endColumn: to.column + 1 };
}

/**
 * Builds a grid the way the Sheets API returns it: only the top-left cell of a merge carries a value.
 * `offset` shifts every cell and merge (simulates inserted rows/columns).
 */
export function gridFromA1(
  cells: Record<string, string>,
  merges: string[] = [],
  options: { sheetId?: number; title?: string; offset?: { rows: number; columns: number } } = {},
): WorksheetGrid {
  const offset = options.offset ?? { rows: 0, columns: 0 };
  const rows: WorksheetRow[] = [];
  for (const [reference, value] of Object.entries(cells)) {
    const { row, column } = a1(reference);
    const target = (rows[row + offset.rows] ??= { values: [] });
    target.values![column + offset.columns] = { formattedValue: value, userEnteredValue: { stringValue: value } };
  }
  return {
    sheetId: options.sheetId ?? 1167716485,
    title: options.title ?? "學習單",
    rows: Array.from(rows, (row) => row ?? { values: [] }).map((row) => ({ values: Array.from(row.values ?? [], (cell) => cell ?? {}) })),
    merges: merges.map(mergeRange).map((merge) => ({
      startRow: merge.startRow + offset.rows,
      endRow: merge.endRow + offset.rows,
      startColumn: merge.startColumn + offset.columns,
      endColumn: merge.endColumn + offset.columns,
    })),
  };
}

export const singlePrompts = [
  "電腦系統中負責執行程式指令的核心硬體元件，英文縮寫是什麼？",
  "電腦底層資料最終會轉換為由數字 1 與哪一個數字組成的二進位系統？",
  "每一台連上網路的設備都需要的識別號碼稱為什麼位址？",
  "負責管理電腦硬體資源的系統軟體統稱為什麼？",
  "具有「後進先出」特性的資料結構稱為什麼？",
  "解決特定問題的明確步驟與規則集合稱為什麼？",
];

/** Mirrors the official 單題範本: header on row 4, questions on rows 5,7,…,15, merged spacer rows between. */
export function singleTemplateCells(): { cells: Record<string, string>; merges: string[] } {
  const cells: Record<string, string> = { B2: "計算機概論基礎 學習單", B4: "題號", C4: "題目", G4: "作答" };
  const merges = ["B2:H2", "B3:H3", "C4:F4", "G4:H4"];
  singlePrompts.forEach((prompt, index) => {
    const row = 5 + index * 2;
    cells[`B${row}`] = String(index + 1);
    cells[`C${row}`] = prompt;
    merges.push(`C${row}:F${row}`, `G${row}:H${row}`);
    if (index < singlePrompts.length - 1) merges.push(`B${row + 1}:H${row + 1}`);
  });
  return { cells, merges };
}

export function singleTemplateGrid(options?: Parameters<typeof gridFromA1>[2]): WorksheetGrid {
  const { cells, merges } = singleTemplateCells();
  return gridFromA1(cells, merges, options);
}

/** Mirrors the official 題組+單題範本: Q1 and Q2 are groups (merged number over two rows, （1）/（2） labels). */
export function groupTemplateCells(): { cells: Record<string, string>; merges: string[] } {
  return {
    cells: {
      B2: "計算機概論基礎 學習單",
      B4: "題號", C4: "題目", G4: "作答",
      B5: "1", C5: "小明升級的電腦「大腦」硬體，英文簡稱是什麼？", G5: "（1）",
      C6: "他安裝的 Windows 這種系統軟體統稱為什麼？", G6: "（2）",
      B8: "2", C8: "步驟明確的邏輯在程式設計中稱為什麼？", G8: "（1）",
      C9: "「後進先出」的資料結構中文稱為什麼？", G9: "（2）",
      B11: "3", C11: "二進位訊號由 1 和哪一個數字構成？",
      B13: "4", C13: "網路世界中辨識身分的編碼稱為什麼位址？",
    },
    merges: [
      "B2:G2", "C4:F4",
      "B5:B6", "C5:F5", "C6:F6",
      "B8:B9", "C8:F8", "C9:F9",
      "C11:F11", "G11:H11",
      "C13:F13", "G13:H13",
    ],
  };
}

export function groupTemplateGrid(options?: Parameters<typeof gridFromA1>[2]): WorksheetGrid {
  const { cells, merges } = groupTemplateCells();
  return gridFromA1(cells, merges, options);
}

/** Returns a copy of the grid with the given cells overwritten (e.g. after a writeback). */
export function withCells(grid: WorksheetGrid, cells: Record<string, string>): WorksheetGrid {
  const rows = grid.rows.map((row) => ({ values: [...(row.values ?? [])].map((cell) => ({ ...cell })) }));
  for (const [reference, value] of Object.entries(cells)) {
    const { row, column } = a1(reference);
    while (rows.length <= row) rows.push({ values: [] });
    const values = rows[row].values!;
    while (values.length <= column) values.push({});
    values[column] = { formattedValue: value, userEnteredValue: { stringValue: value } };
  }
  return { ...grid, rows };
}
