import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  getActivitySnapshot: vi.fn(),
  replayActivityEvents: vi.fn(),
  subscribeToActivityEvents: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getRequestSession: mocks.getRequestSession }));
vi.mock("@/features/activities/application/activity-snapshot", () => ({ getActivitySnapshot: mocks.getActivitySnapshot }));
vi.mock("@/server/events/activity-event-reader", () => ({
  replayActivityEvents: mocks.replayActivityEvents,
  subscribeToActivityEvents: mocks.subscribeToActivityEvents,
}));

import { GET } from "@/app/api/activities/[activityId]/events/route";
import type { ActivityEvent } from "@/features/activities/domain/types";

const teacher = { sub: "teacher-1", role: "teacher", exp: 4_000_000_000 };
const event = {
  activityId: "activity-1",
  stateVersion: 4,
  type: "phase.changed",
  occurredAt: "2026-11-13T00:00:00.000Z",
  data: { roundId: "round-1", phase: "open" },
};

describe("activity SSE replay", () => {
  afterEach(() => vi.resetAllMocks());

  it("replays retained events after Last-Event-ID without requiring a teacher activity cookie", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.subscribeToActivityEvents.mockResolvedValue(vi.fn());
    mocks.replayActivityEvents.mockResolvedValue({ available: true, events: [event], latestVersion: 4 });

    const response = await GET(
      new Request("http://localhost/api/activities/activity-1/events", { headers: { "last-event-id": "3" } }),
      { params: Promise.resolve({ activityId: "activity-1" }) },
    );
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    await reader.cancel();

    expect(text).toContain("id: 4\nevent: phase.changed");
    expect(text).toContain('"stateVersion":4');
    expect(mocks.replayActivityEvents).toHaveBeenCalledWith("activity-1", 3);
    expect(mocks.getActivitySnapshot).not.toHaveBeenCalled();
  });

  it("sends a current filtered snapshot when retained replay is unavailable", async () => {
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.subscribeToActivityEvents.mockResolvedValue(vi.fn());
    mocks.replayActivityEvents.mockResolvedValue({ available: false });
    mocks.getActivitySnapshot.mockResolvedValue({ activityId: "activity-1", stateVersion: 8, currentRound: null });

    const response = await GET(
      new Request("http://localhost/api/activities/activity-1/events", { headers: { "last-event-id": "2" } }),
      { params: Promise.resolve({ activityId: "activity-1" }) },
    );
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    await reader.cancel();

    expect(text).toContain("id: 8\nevent: activity.snapshot");
    expect(text).toContain('"stateVersion":8');
  });

  it("refreshes the snapshot when the live reader detects a version gap", async () => {
    let emit: ((event: ActivityEvent | null) => void) | undefined;
    mocks.getRequestSession.mockReturnValue(teacher);
    mocks.subscribeToActivityEvents.mockImplementation(async (_activityId: string, listener: (event: ActivityEvent | null) => void) => {
      emit = listener;
      return vi.fn();
    });
    mocks.getActivitySnapshot
      .mockResolvedValueOnce({ activityId: "activity-1", stateVersion: 4, currentRound: null })
      .mockResolvedValueOnce({ activityId: "activity-1", stateVersion: 6, currentRound: null });

    const response = await GET(
      new Request("http://localhost/api/activities/activity-1/events"),
      { params: Promise.resolve({ activityId: "activity-1" }) },
    );
    const reader = response.body!.getReader();
    await reader.read();
    emit?.(null);
    const recovered = await reader.read();
    const text = new TextDecoder().decode(recovered.value);
    await reader.cancel();

    expect(text).toContain("id: 6\nevent: activity.snapshot");
    expect(text).toContain('"stateVersion":6');
  });
});
