import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateAuthUrl: vi.fn(), getToken: vi.fn(), verifyIdToken: vi.fn(), saveGoogleTokens: vi.fn() }));

vi.mock("googleapis", () => ({ google: { auth: { OAuth2: class {
  generateAuthUrl = mocks.generateAuthUrl;
  getToken = mocks.getToken;
  verifyIdToken = mocks.verifyIdToken;
} } } }));
vi.mock("@/server/auth/google-token-store", () => ({ saveGoogleTokens: mocks.saveGoogleTokens }));

import { GET as start } from "@/app/api/auth/google/start/route";
import { GET as callback } from "@/app/api/auth/google/callback/route";

describe("Google OAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes");
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    mocks.generateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/auth");
  });

  it("sets a protected state cookie and sends a PKCE challenge", async () => {
    const response = await start();
    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ code_challenge_method: "S256", state: expect.any(String) }));
  });

  it("rejects callbacks without the matching state cookie", async () => {
    const response = await callback(new Request("http://localhost:3000/api/auth/google/callback?code=abc&state=wrong"));
    expect(response.status).toBe(400);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.saveGoogleTokens).not.toHaveBeenCalled();
  });

  it("stores verified tokens server-side and issues a teacher session", async () => {
    const authorization = await start();
    const cookie = authorization.headers.get("set-cookie")?.split(";")[0];
    const options = mocks.generateAuthUrl.mock.calls[0][0];
    mocks.getToken.mockResolvedValue({ tokens: { id_token: "id-token", refresh_token: "refresh-token" } });
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "teacher-id" }) });
    mocks.saveGoogleTokens.mockResolvedValue(undefined);

    const response = await callback(new Request(
      `http://localhost:3000/api/auth/google/callback?code=auth-code&state=${options.state}`,
      { headers: { cookie: cookie! } },
    ));

    expect(response.status).toBe(307);
    expect(mocks.getToken).toHaveBeenCalledWith(expect.objectContaining({ code: "auth-code", codeVerifier: expect.any(String) }));
    expect(mocks.saveGoogleTokens).toHaveBeenCalledWith("teacher-id", expect.objectContaining({ refresh_token: "refresh-token" }));
    expect(response.headers.get("set-cookie")).toContain("classroom_session=");
    expect(response.headers.get("location")).toContain("/teacher/import");
  });

  it("rejects a tampered OAuth state cookie before exchanging the code", async () => {
    const authorization = await start();
    const cookie = authorization.headers.get("set-cookie")?.split(";")[0];
    const options = mocks.generateAuthUrl.mock.calls[0][0];
    const response = await callback(new Request(
      `http://localhost:3000/api/auth/google/callback?code=auth-code&state=${options.state}`,
      { headers: { cookie: `${cookie}tampered` } },
    ));

    expect(response.status).toBe(400);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.saveGoogleTokens).not.toHaveBeenCalled();
  });
});