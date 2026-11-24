# Quickstart: 驗證官方範本匯入、題組搶答與逐題回填

## 前置條件

- 依 `specs/001-live-classroom-quiz/quickstart.md` 完成 Google OAuth / Picker 設定與 `.env.local`。
- `docker compose up -d redis`、`pnpm dev`、`pnpm worker:sheets-writeback` 皆已啟動。
- 在自己的雲端硬碟準備兩份官方範本**複本**（不要修改內容、不要加任何記號）：
  - 單題範本複本（6 題）
  - 題組+單題範本複本（4 題：第 1、2 題為題組各 2 子題，第 3、4 題為單題）

## 自動化檢查

```text
pnpm test:unit          # 解析器：表格版面、合併、題組分組、結構快照、回填目標
pnpm test:contract      # 匯入 422 details、分頁清單、answers[] 提交
pnpm test:integration   # 需 Redis：題組提交原子驗證、worker answers[] 回填
pnpm lint && pnpm typecheck
```

## 人工驗證情境

### A. 單題範本直接匯入（US1）
1. 教師登入 → 從雲端硬碟選取單題範本複本。
2. **預期**：分頁「學習單」自動選好，畫面上沒有 gid 輸入框。
3. 匯入並預覽 → **預期**：6 題、題號 1–6、每題「作答格已確認」。
4. 在複本的題號欄左邊插入一欄、在標題列上方插入兩列後重新匯入 → **預期**：結果相同。

### B. 錯誤訊息（US3）
1. 在另一份複本把第 3 題題號改成 2 → 匯入 → **預期**：列出「題號 2 重複」與「缺少題號 3」，附列號。
2. 選一個空白分頁匯入 → **預期**：「找不到題目」並說明支援的格式。

### C. 題組範本完整流程（US4）
1. 匯入題組+單題範本複本 → **預期**：4 題；第 1、2 題標示「題組 · 2 小題」並列出子題敘述。
2. 開兩個無痕視窗以 A、B 組加入。
3. 開啟第 1 題 → **預期**：學生端顯示 2 個子題輸入欄位。
4. A 組只填（1）就送出 → **預期**：被拒絕、提示要填所有子題；教師端看不到 A 組提交。
5. A 組填完整送出，B 組接著送出 → 結束本題 → **預期**：A 組勝出，結果顯示兩組各子題答案。
6. 回填第 1 題 → **預期**：試算表第 1 題兩個作答格分別變成「（1）A組答案一」「（2）A組答案二」。

### D. 逐題回填（US2）
1. 接續 C，依序完成第 2、3、4 題，每題結束後**不要**馬上回填。
2. 在「已結束題目」清單中逐題按回填 → **預期**：每題都成功，試算表各題作答格寫入得獎答案，其他儲存格不變。
3. 修改試算表標題文字後再回填某題 → **預期**：仍成功。
4. 刪除第 4 題那一列後回填第 4 題 → **預期**：回填失敗並提示結構已變更，試算表沒有被寫入。

## 預期結果

所有自動化檢查通過；A–D 情境全部符合預期。任何 Google API 限制（例如測試帳戶 7 天授權到期）記錄於本文件末。

## Diagram alignment verification (T033, 2026-11-23)

逐一核對 `diagrams/002-component.puml`、`002-class.puml`、`002-sequence.puml` 與更新後的 `class.puml`、`sequence.puml`：

| 圖表元素 | 實作位置 | 結果 |
|---|---|---|
| Teacher Import UI（Picker＋分頁選擇） | `src/components/teacher/guided-notes-import.tsx` | 一致 |
| Teacher Round Control（已結束題目＋回填） | `src/components/teacher/round-control.tsx`、`features/activities/application/teacher-activity.ts`（`completedRounds`） | 一致 |
| Student Answer Form（單題／題組） | `src/components/student/answer-form.tsx`、`activity-round.tsx` | 一致 |
| Sheet Tabs Route | `src/app/api/sheets/[spreadsheetId]/tabs/route.ts` → `listSheetTabs` | 一致 |
| Worksheet Parser / Table Layout / Marker Layout / Merge Resolver | `worksheet-parser.ts`：`parseWorksheetGrid`、`findHeader`＋`parseTableLayout`、`parseMarkerLayout`、`mergeResolver` | 一致 |
| Structure Snapshot（不含作答格內容） | `worksheet-fingerprint.ts`：`structureFingerprint(parsed.structure)`；匯入時保存、回填前後比對 | 一致 |
| Google Sheets Adapter（grid＋merges、properties-only、RAW 寫入） | `google-sheets.adapter.ts` | 一致 |
| Round Store（Lua）answers[] | `open-round.lua`（blanks/blankCount/roundIdsByQuestion）、`submit-answer.lua`（`INCOMPLETE_ANSWERS`）、`enqueue-writeback.lua`（answers） | 一致 |
| Writeback Worker（多格、保留標記、冪等） | `server/workers/sheets-writeback.ts`、`writeback-guided-notes.ts` | 一致 |
| Class：ParsedQuestion/ParsedBlank/WorksheetIssue(rowNumber)/ImportedQuestion/ImportedBlank/Submission.answers[]/WritebackJob.answers[] | 對應型別定義於上述檔案 | 一致 |
| Sequence：分頁自動選取 → 匯入 422 逐項問題 → 題組回合 → 不完整答案拒絕 → 任一已結束題目回填 → 結構不符 fail closed / 已寫入視為成功 | 程式流程與測試（見下） | 一致 |

未發現不一致。

## Manual verification results (T034, 2026-11-23)

環境：本機 Next.js dev server＋worker＋Docker Redis，真實 Google 帳戶與使用者雲端硬碟中的官方範本**複本**。學生端以獨立 cookie 透過 API 模擬 A、B 兩組；教師端使用瀏覽器。

| 情境 | 結果 |
|---|---|
| A-1/A-2 選取單題範本複本，分頁「學習單」自動選取、無 gid 欄位 | ✅ |
| A-3 單題範本匯入：6 題、全部「作答格已確認」（此檔案在修改前匯入失敗） | ✅ |
| A-4 插入欄／列後重新匯入 | ⚪ 未在真實試算表操作；由單元測試 `re-detects questions after rows and columns are inserted` 涵蓋 |
| B 錯誤訊息 | ⚪ 未在真實試算表製造錯誤；由 parser 單元測試、`tests/contract/import-issues.test.ts` 與 e2e `teacher shows per-question import issues` 涵蓋 |
| C-1 題組範本匯入：4 題，第 1、2 題「題組 · 2 小題」並列出子題 | ✅ |
| C-3 學生端題組畫面：2 個作答欄、標籤「（1）…」「（2）…」 | ✅（以學生 session 取得伺服器渲染頁面確認） |
| C-4 只填一個子題送出 → 422「請填寫所有子題的答案。」，`nextOrder` 仍為 0 | ✅ |
| C-5 A、B 送出完整答案 → A 第 1 位勝出；教師端逐子題顯示答案；重複送出被拒 | ✅ |
| C-6 回填第 1 題 → 試算表 G5「（1）CPU」、G6「（2）作業系統」，其他格不變 | ✅ |
| D-1/D-2 第 3、4 題結束後不立即回填，於「已結束題目」清單逐題回填 → 皆 succeeded；試算表 G11「0」、G13「IP」，第 2 題保持「（1）」「（2）」 | ✅（修正前第 2 次以後的回填必定失敗） |
| D-3/D-4 修改標題後回填／刪除題目列後回填 | ⚪ 為避免破壞使用者試算表未在真實檔案操作；由 `tests/unit/sheets/writeback-guided-notes.test.ts` 涵蓋 |
| 學生於回合開放時查詢結果只看到自己組、看不到得獎組 | ✅ |
| 舊格式 `{ answer }` 提交仍可受理 | ✅ |

其他紀錄：
- 原 `pnpm worker:sheets-writeback` 指令在 Next.js 外執行會因 `server-only` 拋錯且未載入 `.env.local`，已修正（T001）。
- `tests/e2e` 已更新，但本機未安裝 Playwright 瀏覽器，e2e 尚未執行；安裝後以 `pnpm exec playwright install chromium && pnpm test:e2e` 執行。
- Google OAuth 測試模式下，含 `drive.file` 的授權約 7 天失效，Demo 前需重新登入。
