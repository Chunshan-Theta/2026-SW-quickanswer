import { roundSubmissionSchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { acceptRoundAnswer } from "@/features/activities/application/round-service";
import { getRequestSession } from "@/server/auth/session";
import { requireActivity, requireRole } from "@/server/http/guards";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string; roundId: string }> }) {
  return withApi(request, async (id) => {
    const student = requireRole(getRequestSession(request), "student");
    const { activityId, roundId } = await context.params;
    requireActivity(student, activityId);
    const body = await request.json().catch(() => null);
    const parsed = roundSubmissionSchema.safeParse(body);
    if (!parsed.success) throw new AppError(422, errorCodes.invalidInput, "請輸入有效答案。", parsed.error.flatten());
    const result = await acceptRoundAnswer(activityId, roundId, student.groupId!, parsed.data.answer);
    return jsonResponse({ accepted: true, ...result }, id, 201);
  });
}