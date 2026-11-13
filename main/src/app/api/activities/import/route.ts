import { activityImportSchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { importGuidedNotes } from "@/features/sheets/application/import-guided-notes";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const body = await request.json().catch(() => null);
    const parsed = activityImportSchema.safeParse(body);
    if (!parsed.success) throw new AppError(422, errorCodes.invalidInput, "請檢查工作表與組別資料。", parsed.error.flatten());
    const activity = await importGuidedNotes(teacher.sub, parsed.data);
    return jsonResponse(activity, id, 201);
  });
}