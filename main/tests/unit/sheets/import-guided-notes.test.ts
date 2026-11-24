import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readWorksheet: vi.fn(), getRedisClient: vi.fn(), set: vi.fn(), multi: vi.fn(), exec: vi.fn() }));
vi.mock("@/features/sheets/google-sheets.adapter", () => ({ readWorksheet: mocks.readWorksheet }));
vi.mock("@/server/redis/client", () => ({ getRedisClient: mocks.getRedisClient }));

import { importGuidedNotes } from "@/features/sheets/application/import-guided-notes";
import { AppError } from "@/server/http/errors";

const input = { spreadsheetId: "sheet-1", sheetId: 7, groupNames: ["A", "B"] };

/** A MULTI that records every queued command; `exec` resolves like node-redis. */
function recordingMulti() {
  const commands: Array<[string, ...unknown[]]> = [];
  const transaction = {
    set: (...args: unknown[]) => { commands.push(["set", ...args]); return transaction; },
    zAdd: (...args: unknown[]) => { commands.push(["zAdd", ...args]); return transaction; },
    expire: (...args: unknown[]) => { commands.push(["expire", ...args]); return transaction; },
    exec: mocks.exec,
  };
  mocks.multi.mockReturnValue(transaction);
  mocks.exec.mockResolvedValue(["OK", 1, 1]);
  return commands;
}

function redisWithMulti() {
  const commands = recordingMulti();
  mocks.getRedisClient.mockResolvedValue({ set: mocks.set, multi: mocks.multi });
  mocks.set.mockResolvedValue("OK");
  return commands;
}
const grid = {
  sheetId: 7,
  title: "Guided Notes",
  rows: [
    { values: [{ formattedValue: "1. First question" }, { formattedValue: "{{answer:1}}" }] },
    { values: [{ formattedValue: "2. Second question" }, { formattedValue: "{{answer:2}}" }] },
  ],
};

describe("importGuidedNotes", () => {
  afterEach(() => vi.resetAllMocks());

  it("creates a ready activity with dynamically scanned questions", async () => {
    mocks.readWorksheet.mockResolvedValue(grid);
    const commands = redisWithMulti();

    const result = await importGuidedNotes("teacher-1", input);

    expect(result.phase).toBe("ready");
    expect(result.questions.map((question) => question.questionNumber)).toEqual(["1", "2"]);
    expect(result.questions.every((question) => question.mappingStatus === "confirmed")).toBe(true);
    expect(commands[0]).toEqual(["set", expect.stringMatching(/^activity:.+:meta$/), expect.any(String), { EX: 604800 }]);
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });

  it("records the activity for its teacher in the same transaction as the activity (006)", async () => {
    mocks.readWorksheet.mockResolvedValue(grid);
    const commands = redisWithMulti();
    const before = Date.now();

    const result = await importGuidedNotes("teacher-1", { ...input, spreadsheetTitle: "Unit 3 Notes" });

    const stored = JSON.parse(commands[0][2] as string) as { createdAt: string; sheetTitle: string; spreadsheetTitle: string };
    expect(stored.sheetTitle).toBe("Guided Notes");
    expect(stored.spreadsheetTitle).toBe("Unit 3 Notes");
    const createdAtMs = Date.parse(stored.createdAt);
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    expect(commands.slice(1)).toEqual([
      ["zAdd", "teacher:teacher-1:activities", { score: createdAtMs, value: result.activityId }],
      ["expire", "teacher:teacher-1:activities", 604800],
    ]);
  });

  it("omits the spreadsheet title when the import did not send one", async () => {
    mocks.readWorksheet.mockResolvedValue(grid);
    const commands = redisWithMulti();

    await importGuidedNotes("teacher-1", input);

    expect(JSON.parse(commands[0][2] as string)).not.toHaveProperty("spreadsheetTitle");
  });

  it("returns mapping_review with opaque candidates for ambiguous slots", async () => {
    mocks.readWorksheet.mockResolvedValue({
      sheetId: 7,
      title: "Guided Notes",
      rows: [{ values: [{ formattedValue: "1. First question" }, { formattedValue: "{{answer:1}}" }, { formattedValue: "{{blank:1}}" }] }],
    });
    redisWithMulti();

    const result = await importGuidedNotes("teacher-1", input);

    expect(result.phase).toBe("mapping_review");
    expect(result.questions[0].candidateSlotTokens).toHaveLength(2);
    expect(result.questions[0].candidateSlotTokens[0]).not.toContain("rowIndex");
  });

  it("rejects duplicate or missing question numbers before writing an activity", async () => {
    mocks.readWorksheet.mockResolvedValue({
      sheetId: 7,
      title: "Broken Notes",
      rows: [{ values: [{ formattedValue: "1. First" }, { formattedValue: "{{answer:1}}" }, { formattedValue: "3. Third" }, { formattedValue: "{{answer:3}}" }] }],
    });

    await expect(importGuidedNotes("teacher-1", input)).rejects.toBeInstanceOf(AppError);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.multi).not.toHaveBeenCalled();
  });
});
