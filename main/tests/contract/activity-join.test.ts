import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ joinActivity: vi.fn() }));
vi.mock("@/features/activities/application/join-activity", () => ({ joinActivity: mocks.joinActivity }));

import { POST } from "@/app/api/activities/[activityId]/join/route";
import { verifySession } from "@/server/auth/session";
import { AppError } from "@/server/http/errors";

function request(body: unknown) {
  return new Request("http://localhost/api/activities/activity-1/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ activityId: "activity-1" }) };

describe("activity join API", () => {
  beforeEach(() => vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes"));

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("binds the issued HttpOnly session to the selected activity group", async () => {
    mocks.joinActivity.mockResolvedValue({ activityId: "activity-1", groupId: "Blue", displayName: "Sam", phase: "ready" });
    const response = await POST(request({ joinCode: "ABC234", groupId: "Blue", displayName: "Sam" }), context);
    const cookie = response.headers.get("set-cookie")?.split(";")[0].split("=")[1];

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ groupId: "Blue", phase: "ready" });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(verifySession(decodeURIComponent(cookie!))).toMatchObject({ role: "student", activityId: "activity-1", groupId: "Blue" });
  });

  it("rejects malformed join information before lookup", async () => {
    const response = await POST(request({ joinCode: "bad", groupId: "Blue", displayName: "" }), context);
    expect(response.status).toBe(422);
    expect(mocks.joinActivity).not.toHaveBeenCalled();
  });

  it("returns the service error for an unknown join code", async () => {
    mocks.joinActivity.mockRejectedValue(new AppError(404, "NOT_FOUND", "活動代碼不存在或已過期。"));
    const response = await POST(request({ joinCode: "ABC234", groupId: "Blue", displayName: "Sam" }), context);
    expect(response.status).toBe(404);
  });
});
