import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGoogleTokens: vi.fn(),
  saveGoogleTokens: vi.fn(),
  getSheet: vi.fn(),
  batchUpdate: vi.fn(),
  refreshAccessToken: false,
  authInstances: [] as Array<{ credentials: Record<string, unknown>; setCredentials: (value: Record<string, unknown>) => void; getAccessToken: () => Promise<{ token: string }> }>,
}));

vi.mock("@/server/auth/google-token-store", () => ({ getGoogleTokens: mocks.getGoogleTokens, saveGoogleTokens: mocks.saveGoogleTokens }));
vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        credentials: Record<string, unknown> = {};
        constructor() { mocks.authInstances.push(this); }
        setCredentials(value: Record<string, unknown>) { this.credentials = value; }
        async getAccessToken() {
          if (mocks.refreshAccessToken) this.credentials = { ...this.credentials, access_token: "refreshed-token" };
          return { token: "access-token" };
        }
      },
    },
    sheets: () => ({ spreadsheets: { get: mocks.getSheet, values: { batchUpdate: mocks.batchUpdate } } }),
  },
}));

import { listSheetTabs, readWorksheet, writeWorksheetAnswers } from "@/features/sheets/google-sheets.adapter";

function worksheetResponse() {
  return {
    data: {
      sheets: [
        { properties: { sheetId: 3, title: "Unused" }, data: [{ rowData: [{ values: [{ formattedValue: "wrong tab" }] }] }] },
        { properties: { sheetId: 17, title: "Notes" }, data: [{ startRow: 4, startColumn: 2, rowData: [{ values: [{ formattedValue: "12. Prompt", note: "question note" }, { formattedValue: "{{answer:12}}" }] }] }] },
      ],
    },
  };
}

describe("Google Sheets adapter", () => {
  afterEach(() => {
    vi.resetAllMocks();
    mocks.refreshAccessToken = false;
    mocks.authInstances.length = 0;
  });

  it("scans only the selected sheet and preserves dynamic row/column offsets", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "old-token", refresh_token: "refresh" });
    mocks.getSheet.mockResolvedValue(worksheetResponse());

    const grid = await readWorksheet("teacher-1", "spreadsheet-1", 17);

    expect(mocks.getSheet).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet-1", includeGridData: true });
    expect(grid.title).toBe("Notes");
    expect(grid.rows[4].values?.[2]).toMatchObject({ formattedValue: "12. Prompt", note: "question note" });
    expect(grid.rows[4].values?.[3]?.formattedValue).toBe("{{answer:12}}");
    expect(grid.rows[0].values?.[0]).toBeUndefined();
  });

  it("returns a service error when sheet access is denied", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "token" });
    mocks.getSheet.mockRejectedValue(new Error("forbidden"));

    await expect(readWorksheet("teacher-1", "spreadsheet-1", 17)).rejects.toMatchObject({ status: 503 });
  });

  it("does not hide errors persisting refreshed credentials", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.refreshAccessToken = true;
    mocks.getGoogleTokens.mockResolvedValue({ refresh_token: "refresh" });
    mocks.saveGoogleTokens.mockRejectedValue(new Error("redis unavailable"));

    await expect(readWorksheet("teacher-1", "spreadsheet-1", 17)).rejects.toMatchObject({ status: 503 });
    expect(mocks.getSheet).not.toHaveBeenCalled();
  });

  it("writes dynamically resolved targets as RAW values", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "token" });
    mocks.batchUpdate.mockResolvedValue({ data: { totalUpdatedCells: 1 } });

    await writeWorksheetAnswers("teacher-1", "spreadsheet-1", "Teacher's Notes", [
      { location: { sheetId: 17, rowIndex: 5, columnIndex: 26 }, answer: "=1+1" },
    ]);

    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "spreadsheet-1",
      requestBody: {
        valueInputOption: "RAW",
        data: [{ range: "'Teacher''s Notes'!AA6", values: [["=1+1"]] }],
      },
    });
  });

  it("maps merged ranges, defaulting indexes the API omits when they are zero", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "token" });
    mocks.getSheet.mockResolvedValue({
      data: {
        sheets: [{
          // sheetId 0 is omitted by the API, exactly like startRowIndex 0 below.
          properties: { title: "學習單" },
          data: [{ rowData: [{ values: [{ formattedValue: "題號" }] }] }],
          merges: [
            { endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 8 },
            { startRowIndex: 4, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 2 },
          ],
        }],
      },
    });

    const grid = await readWorksheet("teacher-1", "spreadsheet-1", 0);

    expect(grid.merges).toEqual([
      { startRow: 0, endRow: 2, startColumn: 1, endColumn: 8 },
      { startRow: 4, endRow: 6, startColumn: 1, endColumn: 2 },
    ]);
  });

  it("explains a missing worksheet tab", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "token" });
    mocks.getSheet.mockResolvedValue(worksheetResponse());

    await expect(readWorksheet("teacher-1", "spreadsheet-1", 0)).rejects.toMatchObject({ status: 404, message: expect.stringContaining("分頁") });
  });

  it("lists worksheet tabs by index using a properties-only request", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "token" });
    mocks.getSheet.mockResolvedValue({ data: { sheets: [
      { properties: { sheetId: 1167716485, title: "學習單", index: 1 } },
      { properties: { title: "封面" } },
    ] } });

    const tabs = await listSheetTabs("teacher-1", "spreadsheet-1");

    expect(mocks.getSheet).toHaveBeenCalledWith({ spreadsheetId: "spreadsheet-1", fields: "sheets.properties(sheetId,title,index)" });
    expect(tabs).toEqual([
      { sheetId: 0, title: "封面", index: 0 },
      { sheetId: 1167716485, title: "學習單", index: 1 },
    ]);
  });

  it("maps a missing spreadsheet and revoked access when listing tabs", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost/callback");
    mocks.getGoogleTokens.mockResolvedValue({ access_token: "token" });
    mocks.getSheet.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: 404 }));
    mocks.getSheet.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { code: 403 }));

    await expect(listSheetTabs("teacher-1", "missing")).rejects.toMatchObject({ status: 404 });
    await expect(listSheetTabs("teacher-1", "revoked")).rejects.toMatchObject({ status: 403 });
  });
});
