# Quickstart: 驗證「我的課堂活動」清單與關閉房間

## 前置條件

- 依 `specs/001-live-classroom-quiz/quickstart.md` 完成 Google OAuth / Picker 設定與 `.env.local`。
- `docker compose up -d redis`、`pnpm dev`、`pnpm worker:sheets-writeback` 皆已啟動。
- 準備一份乾淨的官方範本複本（題組+單題範本，4 題）。
- 本功能上線前建立的舊活動不會出現在清單中，請重新匯入。

## 自動化檢查

```text
pnpm typecheck && pnpm lint
pnpm exec vitest run tests/unit tests/contract tests/security tests/architecture tests/integration tests/load
```

- `tests/unit/activities/activity-lifecycle.test.ts`：清單狀態、排序、已關閉狀態不會被覆寫
- `tests/integration/activity-lifecycle.test.ts`（需 Redis）：匯入時登記、只列自己的活動、過期活動移除、關閉房間原子性與冪等、關閉後拒絕加入／開題／作答、關閉後仍可回填
- `tests/contract/activity-lifecycle.test.ts`、`tests/security/activity-lifecycle.test.ts`：路由權限與回應格式
- `tests/e2e/activity-lifecycle.spec.ts`：需 `pnpm exec playwright install chromium` 後以 `pnpm test:e2e` 執行

## 人工驗證情境

### A. 離開控制台後從清單回來（US1）
1. 教師登入 → 匯入範本複本 → 進入教師控制台 → 勾選第 1、2 題開放。
2. 學生分頁以 A 組加入並回答第 1 題。
3. 關閉教師控制台分頁（或按「返回教師工作區」）。
4. **預期**：學生端第 1、2 題仍可作答，不受影響。
5. 從左側導覽「教師工作區」進入 → **預期**：「我的課堂活動」第一筆為此活動，顯示「進行中」、活動代碼、4 題、搶答中 2 題、建立時間與學習單名稱。
6. 點選此活動 → **預期**：回到控制台，第 1、2 題仍在搶答中，A 組的送出在第 1 題排名上。

### B. 關閉房間（US2）
1. 接續 A，按「關閉房間」→ **預期**：頁面內出現確認區塊，說明會結束 2 題開放中的題目、學生無法再加入或作答、結果與回填保留；按「取消」後一切不變。
2. 再按「關閉房間」→「確認關閉房間」→ **預期**：第 1、2 題同時結束，第 1 題得獎為 A 組；控制台標示「房間已關閉」，開放／結束按鈕停用。
3. 學生端（不重新整理）→ **預期**：顯示「活動已結束」與第 1、2 題的結果，沒有作答欄位；重新整理後相同。
4. 用活動代碼在 `/join` 查詢 → **預期**：「此活動已關閉，無法加入。」
5. 在控制台回填第 1 題 → **預期**：回填成功，試算表寫入 A 組答案。
6. 回到教師工作區 → **預期**：此活動顯示「已關閉」並排在進行中活動之後，仍可點進控制台查看。

### C. 權限
1. 以另一個 Google 帳戶登入教師 → **預期**：清單看不到第一位老師的活動。
2. 學生分頁直接呼叫 `GET /api/teacher/activities` 或 `POST /api/activities/{id}/close` → **預期**：403。

## 預期結果

所有自動化檢查通過；A–C 情境全部符合預期。
