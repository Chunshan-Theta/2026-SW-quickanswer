# Quickstart: 驗證多題同時開放搶答與教師題目卡片介面

## 前置條件

- 依 `specs/001-live-classroom-quiz/quickstart.md` 完成 Google OAuth / Picker 設定與 `.env.local`。
- `docker compose up -d redis`、`pnpm dev`、`pnpm worker:sheets-writeback` 皆已啟動。
- 雲端硬碟中有一份乾淨的「題組＋單題範本」複本（4 題：第 1、2 題為題組，第 3、4 題為單題）。
- 學生端以不同瀏覽器或不同瀏覽器設定檔分別代表 A、B 組（同一瀏覽器多分頁的組別隔離由 003 處理）。

## 自動化檢查

```text
pnpm test:unit          # round-state 純函式、open 請求驗證
pnpm test:contract      # open（陣列／舊格式）、close、close-all 路由
pnpm test:integration   # 需 Redis：全有或全無開放、各題獨立順位、單題／全部結束、失敗回填重排
pnpm test:security
pnpm exec vitest run tests/architecture
pnpm lint && pnpm typecheck
```

## 人工驗證情境

### A. 同時開放多題（US1）
1. 教師匯入範本複本並進入控制台。**預期**：4 張題目卡片，沒有下拉式選單；第 1、2 題標示「題組 · 2 小題」並列出子題。
2. 勾選第 1、2 題 → 工具列顯示「已選 2 題」→ 按「開放所選題目」。**預期**：兩張卡片同時變成「● 搶答中」並開始計時。
3. 勾選第 3 題再開放。**預期**：第 3 題也開始搶答，第 1、2 題不受影響。
4. 開兩個教師視窗：視窗 1 勾選第 4 題但先不送出，視窗 2 開放第 4 題。**預期**：視窗 1 的第 4 題即時變成「搶答中」、勾選框消失、已選題數歸零；若仍以舊狀態送出含第 4 題的開放請求，整批被拒並指出第 4 題（由 `tests/integration/multi-round.test.ts` 覆蓋）。

### B. 學生同時作答（US2）
1. A、B 組加入。**預期**：學生畫面依題號列出所有開放中題目卡片，各有作答欄位。
2. A 組先送出第 2 題、再送出第 1 題；B 組送出第 1 題。**預期**：A 組第 2 題卡片顯示「答案已送達」而第 1 題仍可作答；教師端第 1 題排名依實際送出先後、第 2 題只有 A 組。
3. 學生重新整理。**預期**：開放中題目與已送出狀態完整恢復，看不到其他組的答案。

### C. 結束單題與一次結束（US1）
1. 教師在第 1 題按「結束本題」。**預期**：第 1 題卡片顯示得獎組別；學生端第 1 題顯示結果，第 2 題仍可作答。
2. 有學生畫面尚未更新時送出第 1 題。**預期**：提示「此搶答回合已結束」，第 2 題照常可送出。
3. 按「結束全部開放中」。**預期**：第 2、3、4 題同時結束，各題結果獨立；所有題目結束後活動顯示已完成，沒有任何勾選框。

### D. 介面與回填（US3）
1. 以 360px 寬（瀏覽器開發者工具裝置模式）檢視教師控制台與學生頁。**預期**：長題目完整換行、沒有水平捲動，工具列按鈕可點。
2. 捲動題目清單。**預期**：工具列固定在畫面上方。
3. 逐題按「回填得獎答案」。**預期**：卡片依序顯示回填處理中 → 已回填，試算表各題作答格寫入得獎答案。
4. 刻意刪除某題的列後回填該題。**預期**：顯示「回填失敗」與原因及「重新回填」；把列復原後按「重新回填」即成功。

## 預期結果

所有自動化檢查通過；A–D 情境全部符合預期。

## Diagram alignment verification (T030, 2026-11-25)

逐一核對 `diagrams/004-component.puml`、`004-class.puml`、`004-sequence.puml` 與更新後的 `class.puml`、`sequence.puml`：

| 圖表元素 | 實作位置 | 結果 |
|---|---|---|
| Teacher Question Board（卡片清單＋固定工具列、無下拉選單） | `src/components/teacher/round-control.tsx`、`globals.css`（`.question-board*`、`.question-card*`、`.status-badge*`） | 一致 |
| Student Open Questions（每個開放回合一張卡片＋已公布結果） | `src/components/student/activity-round.tsx`、`answer-form.tsx`（`fieldIdPrefix`） | 一致 |
| Round State Reducer（兩端共用純函式） | `src/features/activities/domain/round-state.ts`：`sortRounds`、`roundsByQuestion`、`applyRoundOpened`、`applySubmission`、`applyRoundClosed`、`applyWritebackStatus`、`questionStatus`、`formatElapsed` | 一致（類別圖已補上 `sortRounds`／`roundsByQuestion`） |
| Student API Client（events URL＋submit 集中一處） | `src/components/student/student-api.ts` | 一致 |
| Open Route `{questionNumbers[]} \| {questionNumber}` | `rounds/open/route.ts`＋`roundOpenSchema`（`legacy` 決定回應格式） | 一致 |
| Close Route / Close-All Route | `rounds/[roundId]/close/route.ts`（不變）、`rounds/close-all/route.ts`（新增） | 一致 |
| Writeback Route（失敗可重新排入） | `enqueue-writeback.lua`（`failed` 時以同一 jobId 重排） | 一致 |
| Round Service / Round Store (Lua) | `round-service.ts`；`round-store.ts`：`openRounds`、`submitAnswer`、`closeRound`、`closeAllOpenRounds`；`open-rounds.lua`、`submit-answer.lua`、`close-rounds.lua` | 一致 |
| Activity Snapshot `rounds[]` | `activity-snapshot.ts`（逐回合可見性、教師回填狀態、`openedAt`/`closedAt`）、`teacher-activity.ts` | 一致 |
| Activity SSE + Projection（逐回合隱私） | `events/route.ts`、`activity-event-projection.ts`（未變更，事件皆帶 `roundId`） | 一致 |
| Class：`ActivityRecord.openRoundIdsByQuestion`（空時移除）、`Round`、`Submission`、`OpenRoundsInput`／`OpenRoundsResult`／`CloseRoundsResult`、`ActivitySnapshot.rounds`、`ActivityRoundSnapshot.openedAt/closedAt`、`TeacherActivityView`、`QuestionStatus` | Lua 腳本、`round-store.ts` 型別、`snapshot.ts`、`types.ts`、`round-state.ts` | 一致 |
| Sequence：多題原子開放（錯誤指出題號、全部不開）→ 每回合一個 `phase.changed` → 各題獨立受理（open map 檢查）→ 加開 → 單題結束（strict）→ 已結束題目遲到答案 409、其他題照常 → 一次結束（讀取 open map 後 open-only）→ 全部結束才 completed → 逐題回填／失敗重排 | 程式流程與 `tests/integration/multi-round.test.ts`、`writeback-queue.test.ts` | 一致 |
| 共用 `class.puml`（Activity.openRoundIdsByQuestion、每題至多一個回合）／`sequence.puml`（多題開放、單題或全部結束、失敗回填重排） | 同上 | 一致 |

未發現其他不一致。

## Automated verification results (T029, 2026-11-25)

| 指令 | 結果 |
|---|---|
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm test:unit` | ✅ 8 files / 56 tests |
| `pnpm test:contract` | ✅ 9 files / 39 tests |
| `pnpm test:security` | ✅ 1 file / 2 tests |
| `pnpm test:integration`（本機 Redis） | ✅ 6 files / 44 tests |
| `pnpm exec vitest run tests/architecture` | ✅ 1 file / 2 tests |
| `pnpm test:load` | ✅ 1 file / 1 test |
| SSR smoke（私有連接埠 3014、種入 2 題開放＋1 題已結束＋1 題未確認＋1 題未開放） | ✅ 教師頁無 `<select>`、只有未開放題目有勾選框、兩張開放卡片有即時排名、長題目完整輸出、已結束卡片有得獎組別與回填；學生頁兩張開放卡片、欄位 id 不重複、只看到自己組答案、已公布結果完整 |

- `tests/e2e/sheets-writeback.spec.ts` 已更新（卡片勾選＋「開放所選題目」，新增多題同時開放／一次結束情境），但本機未安裝 Playwright 瀏覽器，尚未執行。
- 人工驗證情境 A–D 需在合併 003（同一瀏覽器多分頁身分）後，以真實 Google 試算表執行。
