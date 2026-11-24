import { finishAllOpenRounds } from "@/features/activities/application/round-service";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

/** Closes every question that is open when the request arrives, at the same instant. */
export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const { activityId } = await context.params;
    return jsonResponse(await finishAllOpenRounds(activityId, teacher.sub), id);
  });
}
