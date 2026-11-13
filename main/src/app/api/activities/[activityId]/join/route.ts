import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { joinActivitySchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { joinActivity } from "@/features/activities/application/join-activity";
import { setSessionCookie, signSession } from "@/server/auth/session";
import { AppError, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  return withApi(request, async (id) => {
    const body = await request.json().catch(() => null);
    const parsed = joinActivitySchema.safeParse(body);
    if (!parsed.success) throw new AppError(422, errorCodes.invalidInput, "請檢查活動代碼與組別資料。", parsed.error.flatten());
    const { activityId } = await context.params;
    const joined = await joinActivity(activityId, parsed.data);
    const response = NextResponse.json(joined, { headers: { "x-request-id": id, "cache-control": "no-store" } });
    setSessionCookie(response, signSession({ sub: randomUUID(), role: "student", activityId, groupId: joined.groupId }));
    return response;
  });
}