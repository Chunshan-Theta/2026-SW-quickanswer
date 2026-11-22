import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRequestSession: vi.fn(), listSheetTabs: vi.fn() }));

vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/features/sheets/google-sheets.adapter", () => ({ listSheetTabs: mocks.listSheetTabs }));

import { GET } from "@/app/api/sheets/[spreadsheetId]/tabs/route";
import { AppError } from "@/server/http/errors";

const spreadsheetId = "1DCQc-KWwNdm3emF7_5MKMOy9ZAoQ6vWo";
const teacher = { sub: "teacher-123", role: "teacher", exp: 4_000_000_000 };
const request = () => new Request(`http://localhost/api/sheets/${spreadsheetId}/tabs`);
const params = (id = spreadsheetId) => ({ params: Promise.resolve({ spreadsheetId: id }) });

describe("Sheet tabs API contract", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns the worksheet tabs for a teacher", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.listSheetTabs.mockResolvedValue([{ sheetId: 1167716485, title: "學習單", index: 0 }]);

    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tabs: [{ sheetId: 1167716485, title: "學習單", index: 0 }] });
    expect(mocks.listSheetTabs).toHaveBeenCalledWith("teacher-123", spreadsheetId);
  });

  it("rejects students and anonymous requests", async () => {
    mocks.getRequestSession.mockReturnValue({ sub: "s", role: "student", activityId: "a", groupId: "A", exp: 4_000_000_000 });
    expect((await GET(request(), params())).status).toBe(403);
    mocks.getRequestSession.mockReturnValue(null);
    expect((await GET(request(), params())).status).toBe(401);
    expect(mocks.listSheetTabs).not.toHaveBeenCalled();
  });

  it("validates the spreadsheet id and forwards Google permission errors", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    expect((await GET(request(), params("../etc"))).status).toBe(422);

    mocks.listSheetTabs.mockRejectedValue(new AppError(403, "FORBIDDEN", "Google 工作表權限已失效，請重新授權。"));
    const response = await GET(request(), params());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});
