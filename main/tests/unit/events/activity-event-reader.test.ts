import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ xRange: vi.fn() }));
vi.mock("@/server/redis/client", () => ({
  getRedisClient: async () => ({ xRange: mocks.xRange }),
}));

import { replayActivityEvents } from "@/server/events/activity-event-reader";

function entry(stateVersion: number) {
  return {
    id: `${stateVersion}-0`,
    message: {
      payload: JSON.stringify({
        activityId: "activity-1",
        stateVersion,
        type: "phase.changed",
        occurredAt: "2026-11-13T00:00:00.000Z",
        data: { phase: "open" },
      }),
    },
  };
}

describe("activity event replay", () => {
  afterEach(() => vi.resetAllMocks());

  it("replays a contiguous retained range after the requested version", async () => {
    mocks.xRange.mockResolvedValue([entry(3), entry(4), entry(5)]);

    const result = await replayActivityEvents("activity-1", 3);

    expect(result).toEqual({ available: true, events: [expect.objectContaining({ stateVersion: 4 }), expect.objectContaining({ stateVersion: 5 })], latestVersion: 5 });
  });

  it("requires a fresh snapshot when the requested version was trimmed or missing", async () => {
    mocks.xRange.mockResolvedValue([entry(8), entry(10)]);

    await expect(replayActivityEvents("activity-1", 3)).resolves.toEqual({ available: false });
  });
});
