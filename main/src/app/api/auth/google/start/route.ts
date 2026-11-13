import { NextResponse } from "next/server";
import type { Auth } from "googleapis";
import { createOAuthState, googleOAuthClient, OAUTH_COOKIE } from "@/server/auth/google-oauth";

export const runtime = "nodejs";

export async function GET() {
  const client = googleOAuthClient();
  const { state, challenge, cookie } = createOAuthState();
  const url = client.generateAuthUrl({
    access_type: "offline", prompt: "consent", state, code_challenge: challenge,
    code_challenge_method: "S256" as Auth.CodeChallengeMethod,
    scope: ["openid", "https://www.googleapis.com/auth/drive.file"],
  });
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return response;
}