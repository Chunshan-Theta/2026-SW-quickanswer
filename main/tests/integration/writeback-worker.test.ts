import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type RedisClientType } from "redis";
import { AppError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  readWritebackJob: vi.fn(),
  updateWritebackStatus: vi.fn(),
  prepareGuidedNotesWriteback: vi.fn(),
  applyGuidedNotesWriteback: vi.fn(),
}));

vi.mock("@/server/redis/client", () => ({ getRedisClient: mocks.getRedisClient }));
vi.mock("@/server/redis/writeback-queue", () => ({
  readWritebackJob: mocks.readWritebackJob,
  updateWritebackStatus: mocks.updateWritebackStatus,
}));
vi.mock("@/features/sheets/application/writeback-guided-notes", () => ({
  prepareGuidedNotesWriteback: mocks.prepareGuidedNotesWriteback,
  applyGuidedNotesWriteback: mocks.applyGuidedNotesWriteback,
}));

import { jobAnswers, processWritebackEntry, runSheetsWritebackWorker } from "@/server/workers/sheets-writeback";

const job = {
  jobId: "activity-1:round-1",
  activityId: "activity-1",
  roundId: "round-1",
  teacherId: "teacher-1",
  questionNumber: "1",
  winnerGroupId: "Blue",
  answer: "=1+1",
  status: "queued" as const,
  attempt: "0",
};

describe("writeback worker recovery", () => {
  let redis: RedisClientType;

  beforeEach(() => {
    vi.resetAllMocks();
    redis = createClient({ url: "redis://127.0.0.1:6379" });
    vi.spyOn(redis, "get").mockResolvedValue(JSON.stringify({}));
    mocks.getRedisClient.mockResolvedValue(redis);
  });

  afterAll(() => {
    if (redis?.isOpen) redis.destroy();
  });

  it("leaves transient failures pending for a bounded retry", async () => {
    mocks.readWritebackJob.mockResolvedValue(job);
    mocks.prepareGuidedNotesWriteback.mockRejectedValue(new AppError(503, "SERVICE_UNAVAILABLE", "temporarily unavailable"));

    await expect(processWritebackEntry(redis, job.jobId, { retryDelayMs: 0 })).resolves.toBe(false);
    expect(mocks.updateWritebackStatus).toHaveBeenLastCalledWith(redis, job, "retryable", 1, "SERVICE_UNAVAILABLE");
  });

  it("fails permanent stale-mapping errors without retrying", async () => {
    mocks.readWritebackJob.mockResolvedValue(job);
    mocks.prepareGuidedNotesWriteback.mockRejectedValue(new AppError(409, "CONFLICT", "stale mapping"));

    await expect(processWritebackEntry(redis, job.jobId, { retryDelayMs: 0 })).resolves.toBe(true);
    expect(mocks.updateWritebackStatus).toHaveBeenLastCalledWith(redis, job, "failed", 1, "CONFLICT");
  });

  it("marks a write successful without repeating an already verified Sheet update", async () => {
    mocks.readWritebackJob.mockResolvedValue(job);
    mocks.prepareGuidedNotesWriteback.mockResolvedValue({ alreadyWritten: true, targets: [] });

    await expect(processWritebackEntry(redis, job.jobId)).resolves.toBe(true);
    expect(mocks.applyGuidedNotesWriteback).not.toHaveBeenCalled();
    expect(mocks.updateWritebackStatus).toHaveBeenLastCalledWith(redis, job, "succeeded", 1);
  });

  it("passes every blank's answer from the job and applies the prepared targets", async () => {
    const groupJob = { ...job, answer: "（1）CPU；（2）OS", answers: JSON.stringify(["CPU", "OS"]) };
    const prepared = { alreadyWritten: false, sheetTitle: "學習單", targets: [] };
    mocks.readWritebackJob.mockResolvedValue(groupJob);
    mocks.prepareGuidedNotesWriteback.mockResolvedValue(prepared);

    await expect(processWritebackEntry(redis, job.jobId)).resolves.toBe(true);
    expect(mocks.prepareGuidedNotesWriteback).toHaveBeenCalledWith({}, "1", ["CPU", "OS"]);
    expect(mocks.applyGuidedNotesWriteback).toHaveBeenCalledWith({}, prepared);
    expect(mocks.updateWritebackStatus).toHaveBeenLastCalledWith(redis, groupJob, "succeeded", 1);
  });

  it("falls back to the single answer for jobs queued before question groups", () => {
    expect(jobAnswers({ answer: "=1+1" })).toEqual(["=1+1"]);
    expect(jobAnswers({ answer: "x", answers: JSON.stringify(["a", "b"]) })).toEqual(["a", "b"]);
  });

  it("stops retrying after the configured attempt limit", async () => {
    mocks.readWritebackJob.mockResolvedValue({ ...job, attempt: "4" });
    mocks.prepareGuidedNotesWriteback.mockRejectedValue(new AppError(503, "SERVICE_UNAVAILABLE", "temporarily unavailable"));

    await expect(processWritebackEntry(redis, job.jobId, { retryDelayMs: 0 })).resolves.toBe(true);
    expect(mocks.updateWritebackStatus).toHaveBeenLastCalledWith(redis, { ...job, attempt: "4" }, "failed", 5, "SERVICE_UNAVAILABLE");
  });

  it("reclaims a pending job after a simulated crash and acknowledges only after success", async () => {
    const controller = new AbortController();
    let delivery = 0;
    vi.spyOn(redis, "xGroupCreate").mockResolvedValue("OK");
    vi.spyOn(redis, "xAutoClaim").mockImplementation(async () => {
      delivery += 1;
      return {
        nextId: "0-0",
        messages: [{ id: "1-0", message: { jobId: job.jobId } }],
        deletedMessages: [],
      };
    });
    vi.spyOn(redis, "xReadGroup").mockResolvedValue(null);
    vi.spyOn(redis, "xAck").mockImplementation(async () => {
      controller.abort();
      return 1;
    });
    vi.spyOn(redis, "xDel").mockResolvedValue(1);
    mocks.readWritebackJob
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, status: "succeeded", attempt: "1" });
    mocks.prepareGuidedNotesWriteback.mockRejectedValueOnce(new AppError(503, "SERVICE_UNAVAILABLE", "crash before ack"));

    await runSheetsWritebackWorker(controller.signal);

    expect(delivery).toBe(2);
    expect(redis.xAck).toHaveBeenCalledTimes(1);
  });
});
