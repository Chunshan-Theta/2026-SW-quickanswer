import { NextResponse } from "next/server";
import { joinCodeSchema } from "@/lib/validation/schemas";
import { errorCodes } from "@/lib/errors/error-codes";
import { lookupActivityByJoinCode } from "@/features/activities/application/join-activity";
import { AppError, withApi } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApi(request, async (id) => {
    const code = joinCodeSchema.safeParse(new URL(request.url).searchParams.get("code"));
    if (!code.success) throw new AppError(422, errorCodes.invalidInput, "請輸入 6 碼活動代碼。");
    return NextResponse.json(await lookupActivityByJoinCode(code.data), { headers: { "x-request-id": id, "cache-control": "no-store" } });
  });
}