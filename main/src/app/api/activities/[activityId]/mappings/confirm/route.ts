import { mappingConfirmationSchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { confirmMappings } from "@/features/sheets/application/import-guided-notes";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const body = await request.json().catch(() => null);
    const parsed = mappingConfirmationSchema.safeParse(body);
    if (!parsed.success) throw new AppError(422, errorCodes.invalidInput, "請檢查答案格資料。", parsed.error.flatten());
    const { activityId } = await context.params;
    try {
      return jsonResponse(await confirmMappings(teacher.sub, activityId, parsed.data), id);
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 409 && !(error instanceof AppError)) {
        throw new AppError(409, errorCodes.conflict, error.message);
      }
      throw error;
    }
  });
}