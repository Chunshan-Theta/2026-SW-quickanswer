import { createHmac } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { expect, test, type BrowserContext } from "@playwright/test";

// One browser context = one cookie jar shared by all tabs (like two windows of one browser,
// or two incognito windows). Reproduces the reported defect end to end.

const activityId = "e2e-tab-seat-activity";
const teacherId = "e2e-tab-seat-teacher";
const joinCode = "TAB234";
const secret = process.env.SESSION_SECRET ?? "e2e-session-secret-with-at-least-32-bytes";
let redis: RedisClientType;
let roundId: string | undefined;

function teacherToken(): string {
  const payload = Buffer.from(JSON.stringify({ sub: teacherId, role: "teacher", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function joinInNewTab(context: BrowserContext, group: string) {
  const page = await context.newPage();
  await page.goto(`/join/${joinCode}`);
  await page.getByRole("button", { name: "查詢" }).click();
  await expect(page.getByText("活動可加入")).toBeVisible();
  await page.getByLabel("選擇組別").selectOption(group);
  await page.getByLabel("顯示名稱").fill(`${group} Student`);
  await page.getByRole("button", { name: "加入組別" }).click();
  await expect(page).toHaveURL(/\/student\/activity\?seat=[A-Za-z0-9_-]{22}$/);
  await expect(page.getByText(`組別：${group}`)).toBeVisible();
  return page;
}

async function clear() {
  const keys = [`activity:${activityId}:meta`, `activity:${activityId}:events`, `activity:join:${joinCode}`];
  if (roundId) keys.push(`round:${roundId}:state`, `round:${roundId}:submissions`, `round:${roundId}:order`, `round:${roundId}:winner`);
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

test("two groups and the teacher share one browser without overwriting each other", async ({ browser }) => {
  await clear();
  await redis.set(`activity:${activityId}:meta`, JSON.stringify({
    activityId,
    teacherId,
    joinCode,
    phase: "ready",
    stateVersion: 0,
    groupNames: ["Blue", "Red"],
    questions: [{ questionNumber: "1", prompt: "Name the process.", kind: "single", mappingStatus: "confirmed" }],
  }), { EX: 120 });
  await redis.set(`activity:join:${joinCode}`, activityId, { EX: 120 });

  const context = await browser.newContext();
  try {
    await context.addCookies([{ name: "qa_teacher", value: teacherToken(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    const teacher = await context.newPage();
    await teacher.goto(`/teacher/activities/${activityId}`);
    await expect(teacher.getByText(joinCode)).toBeVisible();
    const opened = await context.request.post(`/api/activities/${activityId}/rounds/open`, { data: { questionNumber: "1" } });
    expect(opened.ok()).toBe(true);
    roundId = (await opened.json() as { roundId: string }).roundId;

    const blue = await joinInNewTab(context, "Blue");
    const red = await joinInNewTab(context, "Red");

    // The tab that joined first answers first — this used to be recorded as the last group.
    await blue.getByLabel("小組答案").fill("Photosynthesis");
    await blue.getByRole("button", { name: "送出答案" }).click();
    await expect(blue.getByText("答案已送達")).toBeVisible();
    await red.getByLabel("小組答案").fill("Respiration");
    await red.getByRole("button", { name: "送出答案" }).click();
    await expect(red.getByText("答案已送達")).toBeVisible();
    await expect(red.getByText("Photosynthesis")).toHaveCount(0);

    // The teacher tab in the same browser is still the teacher and sees both groups.
    await expect(teacher.getByText("Photosynthesis")).toBeVisible();
    await expect(teacher.getByText("Respiration")).toBeVisible();

    // Reloading keeps every tab on its own group.
    await blue.reload();
    await expect(blue.getByText("組別：Blue")).toBeVisible();
    await red.reload();
    await expect(red.getByText("組別：Red")).toBeVisible();

    const closed = await context.request.post(`/api/activities/${activityId}/rounds/${roundId}/close`);
    expect(closed.ok()).toBe(true);
    expect(await closed.json()).toMatchObject({ winnerGroupId: "Blue" });
  } finally {
    await context.close();
  }
});

test("a copied student URL does not carry the group to another browser", async ({ browser }) => {
  const other = await browser.newContext();
  try {
    const page = await other.newPage();
    await page.goto("/student/activity?seat=AAAAAAAAAAAAAAAAAAAAAA");
    await expect(page).toHaveURL(/\/join$/);
  } finally {
    await other.close();
  }
});
