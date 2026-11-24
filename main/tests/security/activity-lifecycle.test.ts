import { beforeEach, describe, expect, it, vi } from "vitest";

// Real session module; only the services behind the routes are replaced.
const mocks = vi.hoisted(() => ({ listTeacherActivities: vi.fn(), closeActivityRoom: vi.fn() }));
vi.mock("@/features/activities/application/teacher-activities", () => ({ listTeacherActivities: mocks.listTeacherActivities }));
vi.mock("@/features/activities/application/round-service", () => ({ closeActivityRoom: mocks.closeActivityRoom }));

import { GET as listActivities } from "@/app/api/teacher/activities/route";
import { POST as closeRoom } from "@/app/api/activities/[activityId]/close/route";
import { SEAT_HEADER } from "@/lib/session/seat";
import { createSeatId, signSession } from "@/server/auth/session";

const teacherCookie = (sub = "teacher-1") => `qa_teacher=${signSession({ sub, role: "teacher" })}`;
const seatCookie = (seat: string) =>
  `qa_seat_${seat}=${signSession({ sub: "student-1", role: "student", activityId: "activity-1", groupId: "Blue", seatId: seat })}`;

function list(cookie: string, options: { seat?: string; query?: string } = {}) {
  const headers = new Headers({ cookie });
  if (options.seat) headers.set(SEAT_HEADER, options.seat);
  return listActivities(new Request(`http://localhost/api/teacher/activities${options.query ?? ""}`, { headers }));
}

function close(cookie: string, seat?: string) {
  const headers = new Headers({ cookie });
  if (seat) headers.set(SEAT_HEADER, seat);
  return closeRoom(new Request("http://localhost/api/activities/activity-1/close", { method: "POST", headers }), {
    params: Promise.resolve({ activityId: "activity-1" }),
  });
}

describe("activity lifecycle boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SESSION_SECRET", "a-secret-with-at-least-thirty-two-bytes");
    mocks.listTeacherActivities.mockResolvedValue([]);
    mocks.closeActivityRoom.mockResolvedValue({ phase: "ended", endedAt: "t", rounds: [], stateVersion: 1, alreadyEnded: false });
  });

  it("never lets a student seat list or close rooms, even in the teacher's browser", async () => {
    const seat = createSeatId();
    const browser = `${teacherCookie()}; ${seatCookie(seat)}`;

    expect((await list(browser, { seat })).status).toBe(403);
    expect((await close(browser, seat)).status).toBe(403);
    expect(mocks.listTeacherActivities).not.toHaveBeenCalled();
    expect(mocks.closeActivityRoom).not.toHaveBeenCalled();
  });

  it("lists only the session teacher, whatever the query says", async () => {
    expect((await list(teacherCookie("teacher-1"), { query: "?teacherId=teacher-2" })).status).toBe(200);
    expect(mocks.listTeacherActivities).toHaveBeenCalledWith("teacher-1");
  });

  it("closes as the session teacher only", async () => {
    expect((await close(teacherCookie("teacher-2"))).status).toBe(200);
    expect(mocks.closeActivityRoom).toHaveBeenCalledWith("activity-1", "teacher-2");
  });

  it("rejects requests without a valid teacher cookie", async () => {
    expect((await list("qa_teacher=forged")).status).toBe(401);
    expect((await close("")).status).toBe(401);
  });
});
