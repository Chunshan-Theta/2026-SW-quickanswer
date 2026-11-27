import { writebackRequestSchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { enqueueWriteback, getWritebackStatus } from "@/server/redis/writeback-queue";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string; roundId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const body = await request.json().catch(() => null);
    const parsed = writebackRequestSchema.safeParse(body);
    if (!parsed.success) throw new AppError(422, errorCodes.invalidInput, "無效的回填請求。", parsed.error.flatten());
    const { activityId, roundId } = await context.params;
    return jsonResponse(await enqueueWriteback(activityId, roundId, teacher.sub, parsed.data.selection), id, 202);
  });
}

export async function GET(request: Request, context: { params: Promise<{ activityId: string; roundId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const { activityId, roundId } = await context.params;
    const status = await getWritebackStatus(activityId, roundId, teacher.sub);
    if (!status) throw new AppError(404, errorCodes.notFound, "找不到回填工作。");
    return jsonResponse(status, id);
  });
}
