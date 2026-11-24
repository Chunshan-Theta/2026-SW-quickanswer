import { createHmac } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { expect, test } from "@playwright/test";

// 006: the teacher leaves the console, comes back through 「我的課堂活動」, and closes the room
// while a student page is open.

const activityId = "e2e-lifecycle-activity";
const teacherId = "e2e-lifecycle-teacher";
const joinCode = "END234";
const secret = process.env.SESSION_SECRET ?? "e2e-session-secret-with-at-least-32-bytes";
let redis: RedisClientType;
let roundIds: string[] = [];

function teacherToken(): string {
  const payload = Buffer.from(JSON.stringify({ sub: teacherId, role: "teacher", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function clear() {
  const keys = [`activity:${activityId}:meta`, `activity:${activityId}:events`, `activity:join:${joinCode}`, `teacher:${teacherId}:activities`];
  for (const roundId of roundIds) keys.push(`round:${roundId}:state`, `round:${roundId}:submissions`, `round:${roundId}:order`, `round:${roundId}:winner`);
  await redis.del(keys);
}

test.beforeAll(async () => {
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  redis = createClient({ url: process.env.REDIS_URL });
  redis.on("error", () => undefined);
  await redis.connect();
});

test.afterAll(async () => {
  await clear();
  await redis?.quit();
});

test("teacher returns from the activity list and closes the room; students see it at once", async ({ browser }) => {
  await clear();
  const createdAt = new Date().toISOString();
  await redis.set(`activity:${activityId}:meta`, JSON.stringify({
    activityId,
    teacherId,
    joinCode,
    phase: "ready",
    stateVersion: 0,
    createdAt,
    spreadsheetTitle: "E2E 學習單",
    groupNames: ["Blue", "Red"],
    questions: ["1", "2"].map((questionNumber) => ({ questionNumber, prompt: `Question ${questionNumber}`, kind: "single", mappingStatus: "confirmed" })),
  }), { EX: 120 });
  await redis.set(`activity:join:${joinCode}`, activityId, { EX: 120 });
  await redis.zAdd(`teacher:${teacherId}:activities`, { score: Date.parse(createdAt), value: activityId });

  const context = await browser.newContext();
  try {
    await context.addCookies([{ name: "qa_teacher", value: teacherToken(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);

    // The teacher's way back: the workspace lists the activity.
    const teacher = await context.newPage();
    await teacher.goto("/teacher/import");
    const entry = teacher.getByRole("link", { name: /進行中：E2E 學習單，活動代碼 END234/ });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(teacher).toHaveURL(new RegExp(`/teacher/activities/${activityId}$`));

    const opened = await context.request.post(`/api/activities/${activityId}/rounds/open`, { data: { questionNumbers: ["1", "2"] } });
    expect(opened.ok()).toBe(true);
    roundIds = (await opened.json() as { rounds: Array<{ roundId: string }> }).rounds.map((round) => round.roundId);

    const student = await context.newPage();
    await student.goto(`/join/${joinCode}`);
    await student.getByRole("button", { name: "查詢" }).click();
    await student.getByLabel("選擇組別").selectOption("Blue");
    await student.getByLabel("顯示名稱").fill("Blue Student");
    await student.getByRole("button", { name: "加入組別" }).click();
    await expect(student.getByText("2 題搶答進行中")).toBeVisible();

    // Close with the in-page confirmation; cancelling first changes nothing.
    await teacher.getByRole("button", { name: "關閉房間" }).click();
    await expect(teacher.getByText(/開放中的 2 題會同時結束/)).toBeVisible();
    await teacher.getByRole("button", { name: "取消" }).click();
    await teacher.getByRole("button", { name: "關閉房間" }).click();
    await teacher.getByRole("button", { name: "確認關閉房間" }).click();
    await expect(teacher.getByText("房間已關閉 · 可查看結果與回填")).toBeVisible();
    await expect(teacher.getByRole("button", { name: "開放所選題目" })).toBeDisabled();

    await expect(student.getByText("活動已結束")).toBeVisible();
    await expect(student.getByRole("button", { name: "送出答案" })).toHaveCount(0);

    const lookup = await context.request.get(`/api/activities/join?code=${joinCode}`);
    expect(lookup.status()).toBe(409);
    expect((await lookup.json() as { error: { message: string } }).error.message).toBe("此活動已關閉，無法加入。");

    await teacher.goto("/teacher/import");
    await expect(teacher.getByRole("link", { name: /已關閉：E2E 學習單/ })).toBeVisible();
  } finally {
    await context.close();
  }
});
