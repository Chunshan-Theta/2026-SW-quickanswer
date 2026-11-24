import "server-only";
import { google } from "googleapis";
import { getGoogleTokens, saveGoogleTokens } from "@/server/auth/google-token-store";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import type { CellLocation, MergeRange, WorksheetGrid, WorksheetRow } from "@/features/sheets/domain/worksheet-parser";

export interface SheetTab {
  sheetId: number;
  title: string;
  index: number;
}

function googleError(error: unknown): AppError {
  const status = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
  if (status === 401 || status === 403) {
    return new AppError(403, errorCodes.forbidden, "Google 工作表權限已失效，請重新授權。");
  }
  return new AppError(503, errorCodes.serviceUnavailable, "無法連線至 Google 工作表，請稍後重試。");
}

async function sheetsForTeacher(teacherId: string) {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  try {
    const credentials = await getGoogleTokens(teacherId);
    auth.setCredentials(credentials);
    await auth.getAccessToken();
    if (JSON.stringify(auth.credentials) !== JSON.stringify(credentials)) {
      await saveGoogleTokens(teacherId, auth.credentials);
    }
    return google.sheets({ version: "v4", auth });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw googleError(error);
  }
}

export async function readWorksheet(teacherId: string, spreadsheetId: string, sheetId: number): Promise<WorksheetGrid> {
  try {
    const response = await (await sheetsForTeacher(teacherId)).spreadsheets.get({ spreadsheetId, includeGridData: true });
    const sheet = response.data.sheets?.find((item) => (item.properties?.sheetId ?? 0) === sheetId);
    if (!sheet) throw new AppError(404, errorCodes.notFound, "找不到指定的工作表分頁，請重新選擇。");
    const rows: WorksheetRow[] = [];
    for (const block of sheet.data ?? []) {
      const startRow = block.startRow ?? 0;
      const startColumn = block.startColumn ?? 0;
      for (const [offset, row] of (block.rowData ?? []).entries()) {
        const index = startRow + offset;
        rows[index] ??= { values: [] };
        for (const [column, cell] of (row.values ?? []).entries()) {
          rows[index].values![startColumn + column] = {
            formattedValue: cell.formattedValue ?? undefined,
            note: cell.note ?? undefined,
            userEnteredValue: {
              stringValue: cell.userEnteredValue?.stringValue ?? undefined,
              formulaValue: cell.userEnteredValue?.formulaValue ?? undefined,
              numberValue: cell.userEnteredValue?.numberValue ?? undefined,
            },
          };
        }
      }
    }
    // The API omits zero-valued GridRange fields, so default every index to 0.
    const merges: MergeRange[] = (sheet.merges ?? []).map((merge) => ({
      startRow: merge.startRowIndex ?? 0,
      endRow: merge.endRowIndex ?? 0,
      startColumn: merge.startColumnIndex ?? 0,
      endColumn: merge.endColumnIndex ?? 0,
    }));
    return { sheetId, title: sheet.properties?.title ?? "", rows: Array.from(rows, (row) => row ?? { values: [] }), merges };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw googleError(error);
  }
}

export async function listSheetTabs(teacherId: string, spreadsheetId: string): Promise<SheetTab[]> {
  try {
    const response = await (await sheetsForTeacher(teacherId)).spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(sheetId,title,index)",
    });
    return (response.data.sheets ?? [])
      .map((sheet) => ({
        sheetId: sheet.properties?.sheetId ?? 0,
        title: sheet.properties?.title ?? "",
        index: sheet.properties?.index ?? 0,
      }))
      .sort((left, right) => left.index - right.index);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const status = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
    if (status === 404) throw new AppError(404, errorCodes.notFound, "找不到試算表，請重新選取。");
    throw googleError(error);
  }
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export async function writeWorksheetAnswers(
  teacherId: string,
  spreadsheetId: string,
  sheetTitle: string,
  updates: Array<{ location: CellLocation; answer: string }>,
): Promise<void> {
  if (updates.length === 0) return;
  try {
    const sheets = await sheetsForTeacher(teacherId);
    const escapedTitle = sheetTitle.replace(/'/g, "''");
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.map(({ location, answer }) => ({
          range: `'${escapedTitle}'!${columnName(location.columnIndex)}${location.rowIndex + 1}`,
          values: [[answer]],
        })),
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw googleError(error);
  }
}