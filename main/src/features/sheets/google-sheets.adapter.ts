import "server-only";
import { google } from "googleapis";
import { getGoogleTokens, saveGoogleTokens } from "@/server/auth/google-token-store";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";
import type { WorksheetGrid, WorksheetRow } from "@/features/sheets/domain/worksheet-parser";

export async function readWorksheet(teacherId: string, spreadsheetId: string, sheetId: number): Promise<WorksheetGrid> {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  const credentials = await getGoogleTokens(teacherId);
  auth.setCredentials(credentials);
  try {
    await auth.getAccessToken();
    if (JSON.stringify(auth.credentials) !== JSON.stringify(credentials)) {
      await saveGoogleTokens(teacherId, auth.credentials);
    }
    const response = await google.sheets({ version: "v4", auth }).spreadsheets.get({ spreadsheetId, includeGridData: true });
    const sheet = response.data.sheets?.find((item) => item.properties?.sheetId === sheetId);
    if (!sheet) throw new AppError(404, errorCodes.notFound, "找不到指定的工作表。");
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
    return { sheetId, title: sheet.properties?.title ?? "", rows: Array.from(rows, (row) => row ?? { values: [] }) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, errorCodes.serviceUnavailable, "無法讀取 Google 工作表，請檢查權限並重試。");
  }
}