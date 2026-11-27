import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  enqueueWriteback: vi.fn(),
  getWritebackStatus: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/server/redis/writeback-queue", () => ({
  enqueueWriteback: mocks.enqueueWriteback,
  getWritebackStatus: mocks.getWritebackStatus,
}));

import { GET, POST } from "@/app/api/activities/[activityId]/rounds/[roundId]/writeback/route";

const params = { params: Promise.resolve({ activityId: "activity-1", roundId: "round-1" }) };
const teacher = { sub: "teacher-1", role: "teacher", exp: 4_000_000_000 };

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/activities/activity-1/rounds/round-1/writeback", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("writeback API", () => {
  afterEach(() => vi.resetAllMocks());

  it("queues a closed-round winner answer and returns 202", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.enqueueWriteback.mockResolvedValue({ jobId: "activity-1:round-1", status: "queued", existing: false });

    const response = await POST(request("POST", { requestId: "123e4567-e89b-42d3-a456-426614174000" }), params);

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued" });
    expect(mocks.enqueueWriteback).toHaveBeenCalledWith("activity-1", "round-1", "teacher-1", undefined);
  });

  it("passes the teacher's chosen group or typed answer to the queue (005)", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.enqueueWriteback.mockResolvedValue({ jobId: "activity-1:round-1", status: "queued", existing: false, revision: 1 });
    const requestId = "123e4567-e89b-42d3-a456-426614174000";

    expect((await POST(request("POST", { requestId, selection: { source: "group", groupId: " teamB " } }), params)).status).toBe(202);
    expect(mocks.enqueueWriteback).toHaveBeenLastCalledWith("activity-1", "round-1", "teacher-1", { source: "group", groupId: "teamB" });

    expect((await POST(request("POST", { requestId, selection: { source: "teacher", answers: ["CPU", " OS "] } }), params)).status).toBe(202);
    expect(mocks.enqueueWriteback).toHaveBeenLastCalledWith("activity-1", "round-1", "teacher-1", { source: "teacher", answers: ["CPU", "OS"] });
  });

  it("rejects an incomplete selection before it reaches the queue (005)", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    const requestId = "123e4567-e89b-42d3-a456-426614174000";

    for (const selection of [{ source: "teacher", answers: [] }, { source: "teacher", answers: ["CPU", " "] }, { source: "group", groupId: "" }]) {
      expect((await POST(request("POST", { requestId, selection }), params)).status).toBe(422);
    }
    expect(mocks.enqueueWriteback).not.toHaveBeenCalled();
  });

  it("only lets the teacher choose the answer to write back (005)", async () => {
    mocks.getRequestSession.mockReturnValue({ sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", exp: 4_000_000_000 });

    const response = await POST(request("POST", { requestId: "123e4567-e89b-42d3-a456-426614174000", selection: { source: "group", groupId: "Blue" } }), params);

    expect(response.status).toBe(403);
    expect(mocks.enqueueWriteback).not.toHaveBeenCalled();
  });

  it("rejects malformed queue requests", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);

    const response = await POST(request("POST", {}), params);

    expect(response.status).toBe(422);
    expect(mocks.enqueueWriteback).not.toHaveBeenCalled();
  });

  it("returns the persisted job status to its teacher", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.getWritebackStatus.mockResolvedValue({ jobId: "activity-1:round-1", status: "succeeded", attempt: 1 });

    const response = await GET(request("GET"), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "succeeded" });
  });
});
