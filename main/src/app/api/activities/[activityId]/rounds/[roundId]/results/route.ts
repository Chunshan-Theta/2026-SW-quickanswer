import { getRoundResults } from "@/features/activities/application/results-service";
import { errorCodes } from "@/lib/errors/error-codes";
import { getRequestSession } from "@/server/auth/session";
import { AppError, errorResponse, requestId } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ activityId: string; roundId: string }> }): Promise<Response> {
  const id = requestId(request);
  try {
    const session = getRequestSession(request);
    if (!session) throw new AppError(401, errorCodes.unauthorized, "請先加入或登入活動。");
    const { activityId, roundId } = await context.params;
    const results = await getRoundResults(activityId, roundId, session);
    return Response.json(results, { headers: { "cache-control": "no-store", "x-request-id": id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}
