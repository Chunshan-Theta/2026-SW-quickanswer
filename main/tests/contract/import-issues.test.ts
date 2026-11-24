import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRequestSession: vi.fn(), readWorksheet: vi.fn(), set: vi.fn() }));

vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/features/sheets/google-sheets.adapter", () => ({ readWorksheet: mocks.readWorksheet }));
vi.mock("@/server/redis/client", () => ({ getRedisClient: async () => ({ set: mocks.set, del: vi.fn() }) }));

import { POST } from "@/app/api/activities/import/route";
import { gridFromA1, groupTemplateGrid } from "../fixtures/guided-notes-templates";

const teacher = { sub: "teacher-123", role: "teacher", exp: 4_000_000_000 };
const request = () => new Request("http://localhost/api/activities/import", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ spreadsheetId: "sheet-1", sheetId: 1167716485, groupNames: ["A", "B"] }),
});

describe("Import issues API contract (002)", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns 422 with at least one located issue when the sheet cannot be imported (regression)", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.readWorksheet.mockResolvedValue(gridFromA1({ B4: "題號", C4: "題目", G4: "作答", B5: "1", B9: "1" }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_question_number", questionNumber: "1", rowNumber: 9, message: expect.any(String) }),
    ]));
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("explains an empty worksheet instead of failing silently (regression)", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.readWorksheet.mockResolvedValue({ sheetId: 0, title: "空白", rows: [] });

    const body = await (await POST(request())).json();

    expect(body.error.details).toEqual([expect.objectContaining({ code: "no_questions_found", message: expect.stringContaining("題號") })]);
  });

  it("imports the official group template and exposes blanks without slot tokens", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.readWorksheet.mockResolvedValue(groupTemplateGrid());
    mocks.set.mockResolvedValue("OK");

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ phase: "ready", layout: "table" });
    expect(body.questions).toHaveLength(4);
    expect(body.questions[0]).toMatchObject({ kind: "group", blanks: [{ label: "（1）" }, { label: "（2）" }] });
    expect(JSON.stringify(body)).not.toMatch(/candidates|selectedToken|rowIndex/);
  });
});
