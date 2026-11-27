# Quickstart: 驗證教師選擇回填答案與學生端正確答案

## 前置條件

- 依 `specs/001-live-classroom-quiz/quickstart.md` 完成 Google OAuth／Picker 設定與 `.env.local`。
- `docker compose up -d redis`、`pnpm dev`、`pnpm worker:sheets-writeback` 皆已啟動。
- 雲端硬碟中準備一份乾淨的「題組＋單題範本」複本（第 1、2 題為題組，第 3、4 題為單題）。
- 同一瀏覽器開三個分頁：教師、A 組、B 組（003 起每個分頁有自己的組別身分）。

## 自動化檢查

```text
pnpm typecheck && pnpm lint
pnpm exec vitest run tests/unit tests/contract tests/security tests/architecture tests/integration tests/load
```

## 人工驗證情境

### A. 教師選擇非最快組別（US1）
1. 匯入範本、A、B 組加入；開放第 3 題。
2. A 組先送出錯誤答案、B 組再送出正確答案；結束第 3 題。
3. **預期**：教師端第 3 題卡片依順序列出 A（01，標示最快）、B（02），預設選取 A。
4. 改選 B、按「回填所選答案」→ **預期**：卡片顯示「回填中」後變成「已回填：B 的答案」；試算表第 3 題作答格為 B 組答案。

### B. 學生端只看自己＋老師採用（US2）
1. 接續 A，在第 3 題結束、尚未回填前檢視 A、B 分頁 → **預期**：各自只看到「你們的答案」與「等待老師公布正確答案」，看不到另一組答案或最快組別。
2. 回填成功後 → **預期**：兩個分頁都出現「正確答案（老師採用）：B」與 B 組答案；重新整理後仍相同。

### C. 改選重新回填與冪等（US1）
1. 第 3 題改選 A、按「重新回填」→ **預期**：試算表改為 A 組答案；學生端正確答案改成 A。
2. 不改選、再按一次 → **預期**：按鈕顯示「已回填至工作表」，不會再寫入。

### D. 自行輸入正確答案（US3）
1. 開放並結束第 1 題（題組），選「自行輸入正確答案」→ **預期**：出現（1）（2）兩個輸入欄，任一空白時按鈕不可用。
2. 填寫後回填 → **預期**：試算表 G5／G6 寫入「（1）…」「（2）…」；學生端顯示「正確答案（老師提供）」。
3. 開放並結束第 4 題但沒有組別作答 → **預期**：只能自行輸入正確答案回填。

## 預期結果

所有自動化檢查通過；A–D 情境符合預期。

## Diagram alignment verification (T025, 2026-11-25)

逐一核對 `diagrams/005-component.puml`、`005-class.puml`、`005-sequence.puml` 與實作：

| 圖表元素 | 實作位置 | 結果 |
|---|---|---|
| Answer Adoption Panel（各組單選＋自行輸入） | `src/components/teacher/answer-adoption.tsx` | 一致 |
| Teacher Question Board 已結束卡片 | `src/components/teacher/round-control.tsx`（`AnswerAdoptionPanel`、`queueWriteback(round, selection)`） | 一致 |
| Student Closed Question Card（你們的答案＋正確答案） | `src/components/student/activity-round.tsx`（`answer.published` 監聽） | 一致 |
| Answer Adoption Helpers：`defaultAdoption`／`sameAdoption`／`describeAdoption`／`adoptionIsComplete` | `src/features/activities/domain/answer-adoption.ts` | 一致 |
| Round State Reducer：`applyWritebackStatus`（adopted／published）、`applyPublishedAnswer` | `src/features/activities/domain/round-state.ts` | 一致 |
| Writeback Route `{ requestId, selection? }` | `writeback/route.ts`、`writebackRequestSchema` | 一致 |
| `enqueue-writeback.lua`（selection、selectionKey、revision、previousAnswers、處理中拒絕） | `src/server/redis/scripts/enqueue-writeback.lua` | 一致 |
| `update-writeback-status.lua`（成功才寫入 `published*` 並在事件帶 `published`） | 同名腳本；`updateWritebackStatus` 傳入 round key | 一致 |
| Activity Snapshot／Results Service（學生：只有自己＋`publishedAnswer`） | `activity-snapshot.ts`、`results-service.ts` | 一致 |
| SSE Projection（學生 `results.finalized` 只含自己、`answer.published`） | `src/server/events/activity-event-projection.ts` | 一致 |
| Worker（`previousAnswers`） | `sheets-writeback.ts`（`jobPreviousAnswers`）、`prepareGuidedNotesWriteback(…, previousAnswers)` | 一致 |
| Class：WritebackJob／RoundState／ActivityRoundSnapshot／PublishedAnswerSnapshot／AdoptedAnswer | `writeback-queue.ts`（`WritebackJob` 含 `selectionKey`）、`domain/snapshot.ts` | 一致（核對時補上 `selectionKey` 型別欄位） |
| Sequence：處理中不同選擇 409／相同選擇 existing／改選同 job id revision+1／成功後學生收到 `answer.published`／重新整理只含自己＋公布答案 | Lua 與 `tests/integration/answer-adoption.test.ts`、`tests/security/answer-privacy.test.ts` | 一致 |

## Verification results (2026-11-25)

| 檢查 | 結果 |
|---|---|
| `pnpm typecheck`、`pnpm lint` | ✅ |
| Vitest（unit、contract、security、architecture、integration、load） | ✅ 33 files / 205 tests |
| SSR smoke（私用 port 3015、seeded Redis）：教師端單選清單與預設最快組別、回填按鈕、無下拉選單；學生端只見自己答案、等待公布、無他組答案與最快組別；公布後顯示「老師採用：組別」／「老師提供」 | ✅ 15/15 |
| e2e（`tests/e2e/sheets-writeback.spec.ts` 新增 3 個 005 情境並更新既有斷言） | ⚪ 已更新；本機未安裝 Playwright 瀏覽器，未執行 |
| 人工驗證 A–D（真實 Google Sheets） | ⚪ 待合併後於 port 3000 執行 |
