import { NextResponse } from "next/server";
import { googleOAuthClient, OAUTH_COOKIE, verifyOAuthState } from "@/server/auth/google-oauth";
import { saveGoogleTokens } from "@/server/auth/google-token-store";
import { setTeacherSessionCookie, signSession } from "@/server/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${OAUTH_COOKIE}=`))?.slice(OAUTH_COOKIE.length + 1);
  const verifier = verifyOAuthState(cookie, url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!verifier || !code) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Google 登入狀態無效或已過期。" } }, { status: 400 });
  try {
    const client = googleOAuthClient();
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token || !tokens.refresh_token) throw new Error("Missing Google identity or refresh token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const teacherId = ticket.getPayload()?.sub;
    if (!teacherId) throw new Error("Missing Google subject");
    await saveGoogleTokens(teacherId, tokens);
    const response = NextResponse.redirect(new URL("/teacher/import", process.env.APP_BASE_URL ?? url.origin));
    setTeacherSessionCookie(response, signSession({ sub: teacherId, role: "teacher" }));
    response.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Google 登入失敗，請重新嘗試。" } }, { status: 401 });
  }
}