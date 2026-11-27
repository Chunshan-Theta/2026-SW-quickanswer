import { closeActivityRoom } from "@/features/activities/application/round-service";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

/** 關閉房間: the owning teacher ends the activity (every open question closes at once). */
export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const { activityId } = await context.params;
    return jsonResponse(await closeActivityRoom(activityId, teacher.sub), id);
  });
}
