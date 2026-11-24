import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  listTeacherActivities: vi.fn(),
  closeActivityRoom: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/features/activities/application/teacher-activities", () => ({ listTeacherActivities: mocks.listTeacherActivities }));
vi.mock("@/features/activities/application/round-service", () => ({ closeActivityRoom: mocks.closeActivityRoom }));

import { GET as listActivities } from "@/app/api/teacher/activities/route";
import { POST as closeRoom } from "@/app/api/activities/[activityId]/close/route";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";

const teacher = { sub: "teacher-1", role: "teacher", exp: 4_000_000_000 };
const student = { sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 };
const params = { params: Promise.resolve({ activityId: "activity-1" }) };
const summary = {
  activityId: "activity-1", joinCode: "K7Q2MZ", phase: "active", status: "ongoing", title: "Unit 6",
  questionCount: 4, openQuestionCount: 2, completedQuestionCount: 1, groupCount: 3,
  createdAt: "2026-11-25T01:00:00.000Z", endedAt: null,
};

const listRequest = () => new Request("http://localhost/api/teacher/activities", { headers: { cookie: "qa_teacher=valid" } });
const closeRequest = () => new Request("http://localhost/api/activities/activity-1/close", { method: "POST", headers: { cookie: "qa_teacher=valid" } });

describe("teacher activity list route", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns the signed-in teacher's activities", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.listTeacherActivities.mockResolvedValue([summary]);

    const response = await listActivities(listRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ activities: [summary] });
    expect(mocks.listTeacherActivities).toHaveBeenCalledWith("teacher-1");
  });

  it("rejects anonymous visitors and students", async () => {
    mocks.getRequestSession.mockReturnValue(null);
    expect((await listActivities(listRequest())).status).toBe(401);
    mocks.getRequestSession.mockReturnValue(student);
    expect((await listActivities(listRequest())).status).toBe(403);
    expect(mocks.listTeacherActivities).not.toHaveBeenCalled();
  });
});

describe("close room route", () => {
  afterEach(() => vi.resetAllMocks());

  it("closes the room as the signed-in teacher", async () => {
    const result = { phase: "ended", endedAt: "2026-11-25T02:00:00.000Z", rounds: [], stateVersion: 3, alreadyEnded: false };
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.closeActivityRoom.mockResolvedValue(result);

    const response = await closeRoom(closeRequest(), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.closeActivityRoom).toHaveBeenCalledWith("activity-1", "teacher-1");
  });

  it("rejects anonymous visitors and students before touching the room", async () => {
    mocks.getRequestSession.mockReturnValue(null);
    expect((await closeRoom(closeRequest(), params)).status).toBe(401);
    mocks.getRequestSession.mockReturnValue(student);
    expect((await closeRoom(closeRequest(), params)).status).toBe(403);
    expect(mocks.closeActivityRoom).not.toHaveBeenCalled();
  });

  it("passes ownership and missing-activity errors through", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.closeActivityRoom.mockRejectedValueOnce(new AppError(403, errorCodes.forbidden, "沒有權限執行此操作。"));
    expect((await closeRoom(closeRequest(), params)).status).toBe(403);
    mocks.closeActivityRoom.mockRejectedValueOnce(new AppError(404, errorCodes.notFound, "找不到課堂活動。"));
    const missing = await closeRoom(closeRequest(), params);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { message: "找不到課堂活動。" } });
  });
});
