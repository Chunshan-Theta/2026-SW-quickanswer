import { roundOpenSchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { openRound } from "@/server/redis/round-store";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const body = await request.json().catch(() => null);
    const parsed = roundOpenSchema.safeParse(body);
    if (!parsed.success) throw new AppError(422, errorCodes.invalidInput, "請選擇有效題號。", parsed.error.flatten());
    const { activityId } = await context.params;
    return jsonResponse(await openRound(activityId, teacher.sub, parsed.data.questionNumber), id);
  });
}