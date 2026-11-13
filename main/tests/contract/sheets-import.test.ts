import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  importGuidedNotes: vi.fn(),
  confirmMappings: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/features/sheets/application/import-guided-notes", () => ({
  importGuidedNotes: mocks.importGuidedNotes,
  confirmMappings: mocks.confirmMappings,
}));

import { POST as importPost } from "@/app/api/activities/import/route";
import { POST as confirmPost } from "@/app/api/activities/[activityId]/mappings/confirm/route";

const teacher = { sub: "teacher-123", role: "teacher", exp: 4_000_000_000 };
const params = Promise.resolve({ activityId: "activity-123" });

function request(body: unknown): Request {
  return new Request("http://localhost/api/activities/import", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "classroom_session=valid" },
    body: JSON.stringify(body),
  });
}

describe("Guided Notes import API contract", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns a ready activity for a uniquely mapped worksheet", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.importGuidedNotes.mockResolvedValue({ activityId: "a1", phase: "ready", questions: [] });

    const response = await importPost(request({ spreadsheetId: "sheet-1", sheetId: 7, groupNames: ["A", "B"] }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ phase: "ready", activityId: "a1" });
  });

  it("returns mapping_review with opaque candidates instead of stranding ambiguous work", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.importGuidedNotes.mockResolvedValue({
      activityId: "a2",
      phase: "mapping_review",
      questions: [{ questionNumber: "1", mappingStatus: "ambiguous", candidateSlotTokens: ["opaque-token-123456"] }],
    });

    const response = await importPost(request({ spreadsheetId: "sheet-1", sheetId: 7, groupNames: ["A", "B"] }));

    expect(response.status).toBe(201);
    expect((await response.json()).questions[0]).toMatchObject({ mappingStatus: "ambiguous" });
  });

  it("rejects malformed or duplicate-numbered input with 422", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    const response = await importPost(request({ spreadsheetId: "", sheetId: -1, groupNames: ["A"] }));

    expect(response.status).toBe(422);
    expect(mocks.importGuidedNotes).not.toHaveBeenCalled();
  });

  it("rejects expired candidate tokens with 409", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.confirmMappings.mockRejectedValue(Object.assign(new Error("候選答案格已過期，請重新匯入。"), {
      status: 409,
      code: "CONFLICT",
    }));

    const response = await confirmPost(
      request({ resolutions: [{ questionNumber: "1", answerSlotToken: "opaque-token-123456" }] }),
      { params },
    );

    expect(response.status).toBe(409);
  });

  it("rejects using one answer slot for multiple questions", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.confirmMappings.mockRejectedValue(Object.assign(new Error("同一答案格不可重複使用。"), {
      status: 409,
      code: "CONFLICT",
    }));

    const response = await confirmPost(
      request({ resolutions: [
        { questionNumber: "1", answerSlotToken: "opaque-token-123456" },
        { questionNumber: "2", answerSlotToken: "opaque-token-123456" },
      ] }),
      { params },
    );

    expect(response.status).toBe(409);
  });
});
