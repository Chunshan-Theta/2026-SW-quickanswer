import { createHmac } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { expect, test, type Browser, type Page } from "@playwright/test";

const activityId = "e2e-writeback-activity";
const roundId = "e2e-writeback-round";
const teacherId = "e2e-writeback-teacher";
const secret = process.env.SESSION_SECRET ?? "e2e-session-secret-with-at-least-32-bytes";
let redis: RedisClientType;

function sessionCookie(subject = teacherId, role = "teacher"): string {
  const payload = Buffer.from(JSON.stringify({
    sub: subject,
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function seedReadyActivity(id: string, code: string) {
  await redis.set(`activity:${id}:meta`, JSON.stringify({
    activityId: id,
    teacherId,
    spreadsheetId: "test-spreadsheet",
    sheetId: 0,
    joinCode: code,
    phase: "ready",
    stateVersion: 0,
    layout: "table",
    structureFingerprint: "test-structure",
    groupNames: ["Blue", "Red"],
    questions: [{
      questionNumber: "1",
      prompt: "Name the process.",
      kind: "single",
      mappingStatus: "confirmed",
      blanks: [{
        label: null,
        prompt: "Name the process.",
        mappingStatus: "confirmed",
        selectedToken: "test-answer-slot",
        candidates: [{ token: "test-answer-slot", location: { sheetId: 0, rowIndex: 0, columnIndex: 1 } }],
      }],
    }, {
      questionNumber: "2",
      prompt: "CPU？／OS？",
      kind: "group",
      mappingStatus: "confirmed",
      blanks: [
        { label: "（1）", prompt: "CPU？", mappingStatus: "confirmed", selectedToken: "g1", candidates: [{ token: "g1", location: { sheetId: 0, rowIndex: 4, columnIndex: 6 } }] },
        { label: "（2）", prompt: "OS？", mappingStatus: "confirmed", selectedToken: "g2", candidates: [{ token: "g2", location: { sheetId: 0, rowIndex: 5, columnIndex: 6 } }] },
      ],
    }],
  }), { EX: 60 });
  await redis.set(`activity:join:${code}`, id, { EX: 60 });
}

async function clearActivity(id: string, code: string) {
  const rawActivity = await redis.get(`activity:${id}:meta`);
  const roundIds = rawActivity ? Object.values((JSON.parse(rawActivity) as { roundIdsByQuestion?: Record<string, string> }).roundIdsByQuestion ?? {}) : [];
  const keys = [`activity:${id}:meta`, `activity:${id}:events`, `activity:join:${code}`];
  for (const roundId of roundIds) keys.push(`round:${roundId}:state`, `round:${roundId}:submissions`, `round:${roundId}:order`, `round:${roundId}:winner`);
  await redis.del(keys);
}

async function addTeacherCookie(page: Page) {
  await page.context().addCookies([{
    name: "qa_teacher",
    value: sessionCookie(),
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

async function joinGroup(browser: Browser, code: string, group: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await page.getByRole("button", { name: "查詢" }).click();
  await expect(page.getByText("活動可加入")).toBeVisible();
  await page.getByLabel("選擇組別").selectOption(group);
  await page.getByLabel("顯示名稱").fill(`${group} Student`);
  await page.getByRole("button", { name: "加入組別" }).click();
  await expect(page).toHaveURL(/\/student\/activity\?seat=[A-Za-z0-9_-]{22}$/);
  return { context, page };
}

test.beforeAll(async () => {
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  redis = createClient({ url: process.env.REDIS_URL });
  redis.on("error", () => undefined);
  await redis.connect();
});

test.afterAll(async () => {
  await redis?.del([
    `activity:${activityId}:meta`,
    `activity:${activityId}:events`,
    `round:${roundId}:state`,
    `round:${roundId}:submissions`,
    `round:${roundId}:order`,
    `round:${roundId}:winner`,
  ]);
  await redis?.quit();
});

test("teacher chooses a non-fastest answer to write back and sees its status (005)", async ({ page, context }) => {
  await redis.del([
    `activity:${activityId}:meta`,
    `activity:${activityId}:events`,
    `round:${roundId}:state`,
    `round:${roundId}:submissions`,
    `round:${roundId}:order`,
    `round:${roundId}:winner`,
  ]);
  await redis.set(`activity:${activityId}:meta`, JSON.stringify({
    activityId,
    teacherId,
    joinCode: "ABC234",
    phase: "completed",
    stateVersion: 4,
    roundIdsByQuestion: { 1: roundId },
    groupNames: ["Blue", "Red"],
    completedQuestionNumbers: ["1"],
    questions: [{ questionNumber: "1", prompt: "Name the process.", mappingStatus: "confirmed" }],
  }), { EX: 60 });
  await redis.hSet(`round:${roundId}:state`, {
    activityId,
    phase: "closed",
    questionNumber: "1",
    prompt: "Name the process.",
    winnerGroupId: "Blue",
    stateVersion: "4",
  });
  await redis.hSet(`round:${roundId}:submissions`, {
    Blue: JSON.stringify({ groupId: "Blue", answer: "Photosynthesis", acceptedOrder: 1, acceptedAt: "t1" }),
    Red: JSON.stringify({ groupId: "Red", answer: "Respiration", acceptedOrder: 2, acceptedAt: "t2" }),
  });
  await context.addCookies([{
    name: "qa_teacher",
    value: sessionCookie(),
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  let postedSelection: unknown;
  await page.route(`**/api/activities/${activityId}/rounds/${roundId}/writeback`, async (route) => {
    if (route.request().method() === "POST") {
      postedSelection = (route.request().postDataJSON() as { selection?: unknown }).selection;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId: `${activityId}:${roundId}`, status: "queued", existing: false, revision: 1, adopted: { source: "group", groupId: "Red", answer: "Respiration", answers: ["Respiration"] } }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/teacher/activities/${activityId}`);
  await expect(page.getByText("Photosynthesis")).toBeVisible();
  // The fastest group is preselected, but the teacher may adopt another group's answer.
  await expect(page.getByRole("radio", { name: /Blue/ })).toBeChecked();
  await page.getByRole("radio", { name: /Red/ }).check();
  await page.getByRole("button", { name: "回填所選答案" }).click();
  await expect(page.getByText("回填中：Red 的答案…")).toBeVisible();
  expect(postedSelection).toEqual({ source: "group", groupId: "Red" });
});

test("teacher can type the correct answer instead of adopting a group's (005)", async ({ page, context }) => {
  await context.addCookies([{ name: "qa_teacher", value: sessionCookie(), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  let postedSelection: unknown;
  await page.route(`**/api/activities/${activityId}/rounds/${roundId}/writeback`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    postedSelection = (route.request().postDataJSON() as { selection?: unknown }).selection;
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: `${activityId}:${roundId}`, status: "queued", adopted: { source: "teacher", groupId: null, answer: "Light reaction", answers: ["Light reaction"] } }) });
  });

  await page.goto(`/teacher/activities/${activityId}`);
  await page.getByRole("radio", { name: "自行輸入正確答案" }).check();
  await expect(page.getByRole("button", { name: "回填所選答案" })).toBeDisabled();
  await page.getByLabel("正確答案", { exact: true }).fill("Light reaction");
  await page.getByRole("button", { name: "回填所選答案" }).click();
  await expect(page.getByText("回填中：老師提供的答案…")).toBeVisible();
  expect(postedSelection).toEqual({ source: "teacher", answers: ["Light reaction"] });
});

test("students see only their own answer, then the teacher-adopted answer once published (005)", async ({ browser }) => {
  const id = "e2e-published-activity";
  const code = "PUB234";
  const closedRoundId = "e2e-published-round";
  await clearActivity(id, code);
  await seedReadyActivity(id, code);
  const raw = JSON.parse((await redis.get(`activity:${id}:meta`))!) as Record<string, unknown>;
  await redis.set(`activity:${id}:meta`, JSON.stringify({ ...raw, phase: "active", roundIdsByQuestion: { 1: closedRoundId }, completedQuestionNumbers: ["1"] }), { EX: 60 });
  await redis.hSet(`round:${closedRoundId}:state`, { activityId: id, phase: "closed", questionNumber: "1", prompt: "Name the process.", kind: "single", winnerGroupId: "Blue" });
  await redis.hSet(`round:${closedRoundId}:submissions`, {
    Blue: JSON.stringify({ groupId: "Blue", answer: "Photosynthesis", answers: ["Photosynthesis"], acceptedOrder: 1, acceptedAt: "t1" }),
    Red: JSON.stringify({ groupId: "Red", answer: "Respiration", answers: ["Respiration"], acceptedOrder: 2, acceptedAt: "t2" }),
  });
  let red: Awaited<ReturnType<typeof joinGroup>> | undefined;
  try {
    red = await joinGroup(browser, code, "Red");
    const card = red.page.locator(".final-result", { hasText: "第 1 題" });
    await expect(card.getByText("你們的答案 · 第 2 個送出")).toBeVisible();
    await expect(card.getByText("Respiration")).toBeVisible();
    await expect(card.getByText("等待老師公布正確答案")).toBeVisible();
    await expect(red.page.getByText("Photosynthesis")).toHaveCount(0);
    await expect(red.page.getByText("Blue", { exact: true })).toHaveCount(0);

    await redis.hSet(`round:${closedRoundId}:state`, { publishedSource: "group", publishedGroupId: "Blue", publishedAnswers: JSON.stringify(["Photosynthesis"]), publishedAnswer: "Photosynthesis", publishedAt: "t9" });
    await red.page.reload();
    await expect(card.getByText("正確答案（老師採用：Blue）")).toBeVisible();
    await expect(card.getByText("Photosynthesis")).toBeVisible();
    await expect(card.getByText("Respiration")).toBeVisible();
  } finally {
    await red?.context.close();
    await redis.del([`round:${closedRoundId}:state`, `round:${closedRoundId}:submissions`]);
    await clearActivity(id, code);
  }
});

test("teacher and students open, answer, close, and see role-filtered results", async ({ browser }) => {
  const id = "e2e-round-activity";
  const code = "DEF234";
  await clearActivity(id, code);
  await seedReadyActivity(id, code);
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  let blue: Awaited<ReturnType<typeof joinGroup>> | undefined;
  let red: Awaited<ReturnType<typeof joinGroup>> | undefined;
  try {
    await addTeacherCookie(teacherPage);
    await teacherPage.goto(`/teacher/activities/${id}`);
    await expect(teacherPage.getByText(code)).toBeVisible();
    // No dropdown: questions are cards with checkboxes.
    await expect(teacherPage.locator("select")).toHaveCount(0);
    await teacherPage.getByLabel("選取第 1 題").check();
    await teacherPage.getByRole("button", { name: "開放所選題目" }).click();
    await expect(teacherPage.getByRole("button", { name: "結束本題" })).toBeVisible();

    blue = await joinGroup(browser, code, "Blue");
    await expect(blue.page.getByLabel("小組答案")).toBeVisible();
    await blue.page.getByLabel("小組答案").fill("Photosynthesis");
    await blue.page.getByRole("button", { name: "送出答案" }).click();
    await expect(blue.page.getByText("答案已送達")).toBeVisible();

    red = await joinGroup(browser, code, "Red");
    await expect(red.page.getByLabel("小組答案")).toBeVisible();
    await expect(red.page.getByText("Photosynthesis")).toHaveCount(0);
    await expect(red.page.getByText("Blue", { exact: true })).toHaveCount(0);
    await red.page.getByLabel("小組答案").fill("Respiration");
    await red.page.getByRole("button", { name: "送出答案" }).click();
    await expect(red.page.getByText("答案已送達")).toBeVisible();
    await expect(teacherPage.getByText("Photosynthesis")).toBeVisible();
    await expect(teacherPage.getByText("Respiration")).toBeVisible();

    await teacherPage.getByRole("button", { name: "結束本題" }).click();
    await expect(teacherPage.getByText("最快作答：Blue")).toBeVisible();
    // 005: after close a student still sees only their own answer until the teacher publishes one.
    await expect(red.page.getByText("等待老師公布正確答案")).toBeVisible();
    await expect(red.page.getByText("Respiration")).toBeVisible();
    await expect(red.page.getByText("Photosynthesis")).toHaveCount(0);
    await red.page.reload();
    await expect(red.page.getByText("等待老師公布正確答案")).toBeVisible();
    await expect(red.page.getByText("Respiration")).toBeVisible();
    await expect(red.page.getByText("Photosynthesis")).toHaveCount(0);
  } finally {
    await Promise.all([blue?.context.close(), red?.context.close(), teacherContext.close()]);
    await clearActivity(id, code);
  }
});

test("teacher selects a spreadsheet and previews the imported questions", async ({ page }) => {
  await addTeacherCookie(page);
  await page.route("https://apis.google.com/js/api.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.gapi={load:(_name,options)=>options.callback()};function PickerBuilder(){this.callback=()=>{}}PickerBuilder.prototype.addView=function(){return this};PickerBuilder.prototype.setOAuthToken=function(){return this};PickerBuilder.prototype.setDeveloperKey=function(){return this};PickerBuilder.prototype.setAppId=function(){return this};PickerBuilder.prototype.setCallback=function(callback){this.callback=callback;return this};PickerBuilder.prototype.build=function(){const callback=this.callback;return {setVisible:visible=>visible&&callback({action:"picked",docs:[{id:"selected-spreadsheet",name:"Guided Notes"}]})}};window.google={picker:{PickerBuilder,ViewId:{SPREADSHEETS:"spreadsheets"},Action:{PICKED:"picked"}}};`,
  }));
  await page.route("**/api/auth/google/picker-token", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ accessToken: "picker-access-token" }),
  }));
  await page.route("**/api/sheets/selected-spreadsheet/tabs", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ tabs: [{ sheetId: 1167716485, title: "學習單", index: 0 }] }),
  }));
  let importedSheetId: number | undefined;
  await page.route("**/api/activities/import", async (route) => {
    importedSheetId = (route.request().postDataJSON() as { sheetId: number }).sheetId;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        activityId: "e2e-import-activity",
        joinCode: "GHJ234",
        phase: "ready",
        layout: "table",
        questions: [
          { questionNumber: "1", prompt: "Name the process.", kind: "single", mappingStatus: "confirmed", candidateSlotTokens: [], blanks: [{ label: null, prompt: "Name the process.", mappingStatus: "confirmed" }] },
          { questionNumber: "2", prompt: "CPU？／OS？", kind: "group", mappingStatus: "confirmed", candidateSlotTokens: [], blanks: [{ label: "（1）", prompt: "CPU？", mappingStatus: "confirmed" }, { label: "（2）", prompt: "OS？", mappingStatus: "confirmed" }] },
        ],
      }),
    });
  });

  await page.goto("/teacher/import");
  await page.getByRole("button", { name: "從 Google 雲端硬碟選取" }).click();
  await expect(page.getByLabel("已選取試算表")).toHaveValue(/Guided Notes/);
  // A single worksheet tab is selected automatically; no gid has to be typed.
  await expect(page.getByLabel("工作表分頁")).toHaveValue("1167716485");
  await page.getByRole("button", { name: "匯入並預覽" }).click();
  await expect(page.getByRole("heading", { name: "題目預覽" })).toBeVisible();
  await expect(page.getByText("2 題 · 已確認")).toBeVisible();
  await expect(page.getByText("題組 · 2 小題")).toBeVisible();
  expect(importedSheetId).toBe(1167716485);
  await expect(page.getByRole("link", { name: "進入教師控制台" })).toHaveAttribute("href", "/teacher/activities/e2e-import-activity");
});

test("teacher shows per-question import issues", async ({ page }) => {
  await addTeacherCookie(page);
  await page.route("https://apis.google.com/js/api.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.gapi={load:(_name,options)=>options.callback()};function PickerBuilder(){this.callback=()=>{}}PickerBuilder.prototype.addView=function(){return this};PickerBuilder.prototype.setOAuthToken=function(){return this};PickerBuilder.prototype.setDeveloperKey=function(){return this};PickerBuilder.prototype.setAppId=function(){return this};PickerBuilder.prototype.setCallback=function(callback){this.callback=callback;return this};PickerBuilder.prototype.build=function(){const callback=this.callback;return {setVisible:visible=>visible&&callback({action:"picked",docs:[{id:"selected-spreadsheet",name:"Guided Notes"}]})}};window.google={picker:{PickerBuilder,ViewId:{SPREADSHEETS:"spreadsheets"},Action:{PICKED:"picked"}}};`,
  }));
  await page.route("**/api/auth/google/picker-token", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accessToken: "picker-access-token" }) }));
  await page.route("**/api/sheets/selected-spreadsheet/tabs", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ tabs: [{ sheetId: 0, title: "封面", index: 0 }, { sheetId: 42, title: "學習單", index: 1 }] }),
  }));
  await page.route("**/api/activities/import", (route) => route.fulfill({
    status: 422,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "INVALID_INPUT", message: "無法匯入學習單，請依下列問題修正後重新匯入。", details: [{ code: "duplicate_question_number", questionNumber: "2", rowNumber: 9, message: "題號 2 重複（第 7 列與第 9 列）。" }] } }),
  }));

  await page.goto("/teacher/import");
  await page.getByRole("button", { name: "從 Google 雲端硬碟選取" }).click();
  await expect(page.getByRole("button", { name: "匯入並預覽" })).toBeDisabled();
  await page.getByLabel("工作表分頁").selectOption({ label: "學習單" });
  await page.getByRole("button", { name: "匯入並預覽" }).click();
  await expect(page.getByText("題號 2 重複（第 7 列與第 9 列）。")).toBeVisible();
});

test("students must answer every blank of a question group in one submission", async ({ browser }) => {
  const id = "e2e-group-activity";
  const code = "GRP234";
  await clearActivity(id, code);
  await seedReadyActivity(id, code);
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  let blue: Awaited<ReturnType<typeof joinGroup>> | undefined;
  try {
    await addTeacherCookie(teacherPage);
    await teacherPage.goto(`/teacher/activities/${id}`);
    await teacherPage.getByLabel("選取第 2 題").check();
    await teacherPage.getByRole("button", { name: "開放所選題目" }).click();
    await expect(teacherPage.getByRole("button", { name: "結束本題" })).toBeVisible();

    blue = await joinGroup(browser, code, "Blue");
    await expect(blue.page.getByLabel("（1） CPU？")).toBeVisible();
    await blue.page.getByLabel("（1） CPU？").fill("中央處理器");
    await expect(blue.page.getByRole("button", { name: "送出答案" })).toBeDisabled();
    await blue.page.getByLabel("（2） OS？").fill("作業系統");
    await blue.page.getByRole("button", { name: "送出答案" }).click();
    await expect(blue.page.getByText("答案已送達")).toBeVisible();
    await expect(teacherPage.getByText("作業系統")).toBeVisible();

    await teacherPage.getByRole("button", { name: "結束本題" }).click();
    await expect(teacherPage.getByText("最快作答：Blue")).toBeVisible();
    await expect(blue.page.getByText("中央處理器")).toBeVisible();
  } finally {
    await Promise.all([blue?.context.close(), teacherContext.close()]);
    await clearActivity(id, code);
  }
});

test("teacher opens several questions at once, groups answer different questions, and closes them all", async ({ browser }) => {
  const id = "e2e-multi-activity";
  const code = "MLT234";
  await clearActivity(id, code);
  await seedReadyActivity(id, code);
  const teacherContext = await browser.newContext();
  const teacherPage = await teacherContext.newPage();
  let blue: Awaited<ReturnType<typeof joinGroup>> | undefined;
  let red: Awaited<ReturnType<typeof joinGroup>> | undefined;
  try {
    await addTeacherCookie(teacherPage);
    await teacherPage.goto(`/teacher/activities/${id}`);
    await teacherPage.getByLabel("選取第 1 題").check();
    await teacherPage.getByLabel("選取第 2 題").check();
    await expect(teacherPage.getByText("已選 2 題")).toBeVisible();
    await teacherPage.getByRole("button", { name: "開放所選題目" }).click();
    await expect(teacherPage.getByRole("button", { name: "結束本題" })).toHaveCount(2);
    await expect(teacherPage.getByText("搶答中 2 題")).toBeVisible();

    blue = await joinGroup(browser, code, "Blue");
    red = await joinGroup(browser, code, "Red");
    const blueSingle = blue.page.locator(".student-round-card", { hasText: "Name the process." });
    const redGroup = red.page.locator(".student-round-card", { hasText: "CPU？" });
    await expect(blue.page.locator(".student-round-card")).toHaveCount(2);

    await blueSingle.getByLabel("小組答案").fill("Photosynthesis");
    await blueSingle.getByRole("button", { name: "送出答案" }).click();
    await expect(blueSingle.getByText("答案已送達")).toBeVisible();
    // Blue's other open question is still answerable.
    await expect(blue.page.getByLabel("（1） CPU？")).toBeVisible();

    await redGroup.getByLabel("（1） CPU？").fill("中央處理器");
    await redGroup.getByLabel("（2） OS？").fill("作業系統");
    await redGroup.getByRole("button", { name: "送出答案" }).click();
    await expect(redGroup.getByText("答案已送達")).toBeVisible();
    await expect(red.page.getByText("Photosynthesis")).toHaveCount(0);

    await expect(teacherPage.getByText("Photosynthesis")).toBeVisible();
    await expect(teacherPage.getByText("作業系統")).toBeVisible();
    await teacherPage.getByRole("button", { name: "結束全部開放中" }).click();
    await expect(teacherPage.getByText("最快作答：Blue")).toBeVisible();
    await expect(teacherPage.getByText("最快作答：Red")).toBeVisible();
    await expect(teacherPage.getByText("活動已完成")).toBeVisible();
    await expect(red.page.getByText("已結束的題目")).toBeVisible();
    // 005: Blue's answer to question 1 stays private for Red.
    await expect(red.page.getByText("Photosynthesis")).toHaveCount(0);
  } finally {
    await Promise.all([blue?.context.close(), red?.context.close(), teacherContext.close()]);
    await clearActivity(id, code);
  }
});
