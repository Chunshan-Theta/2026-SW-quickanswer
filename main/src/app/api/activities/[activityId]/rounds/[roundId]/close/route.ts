import { closeRound } from "@/server/redis/round-store";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string; roundId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const { activityId, roundId } = await context.params;
    return jsonResponse(await closeRound(activityId, roundId, teacher.sub), id);
  });
}