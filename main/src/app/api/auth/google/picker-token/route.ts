import { getGoogleTokens, saveGoogleTokens } from "@/server/auth/google-token-store";
import { googleOAuthClient } from "@/server/auth/google-oauth";
import { getRequestSession } from "@/server/auth/session";
import { errorCodes } from "@/lib/errors/error-codes";
import { AppError, jsonResponse, withApi } from "@/server/http/errors";
import { requireRole } from "@/server/http/guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApi(request, async (id) => {
    const teacher = requireRole(getRequestSession(request), "teacher");
    const credentials = await getGoogleTokens(teacher.sub);
    const client = googleOAuthClient();
    client.setCredentials(credentials);

    let token: string | null;
    try {
      token = (await client.getAccessToken()).token ?? null;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : 0;
      if (status === 401 || status === 403) {
        throw new AppError(403, errorCodes.forbidden, "Google 授權已失效，請重新登入。");
      }
      throw new AppError(503, errorCodes.serviceUnavailable, "無法連線至 Google Picker，請稍後重試。");
    }
    if (!token) throw new AppError(503, errorCodes.serviceUnavailable, "無法取得 Google Picker 授權，請稍後重試。");

    if (JSON.stringify(client.credentials) !== JSON.stringify(credentials)) {
      await saveGoogleTokens(teacher.sub, client.credentials);
    }
    return jsonResponse({ accessToken: token }, id);
  });
}
