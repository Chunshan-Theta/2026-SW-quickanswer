import { finishActivityRound } from "@/features/activities/application/round-service";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string; roundId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const { activityId, roundId } = await context.params;
    return jsonResponse(await finishActivityRound(activityId, roundId, teacher.sub), id);
  });
}