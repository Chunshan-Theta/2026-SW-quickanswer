import { listTeacherActivities } from "@/features/activities/application/teacher-activities";
import { getRequestSession } from "@/server/auth/session";
import { requireRole } from "@/server/http/guards";
import { jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

/** 「我的課堂活動」: the signed-in teacher's own activities only (the id comes from the session). */
export async function GET(request: Request) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    return jsonResponse({ activities: await listTeacherActivities(teacher.sub) }, id);
  });
}
