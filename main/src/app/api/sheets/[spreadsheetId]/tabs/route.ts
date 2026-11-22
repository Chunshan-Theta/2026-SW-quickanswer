import { listSheetTabs } from "@/features/sheets/google-sheets.adapter";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ spreadsheetId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const { spreadsheetId } = await context.params;
    if (!/^[A-Za-z0-9_-]{10,256}$/.test(spreadsheetId)) {
      throw new AppError(422, errorCodes.invalidInput, "試算表識別碼無效。");
    }
    return jsonResponse({ tabs: await listSheetTabs(teacher.sub, spreadsheetId) }, id);
  });
}
