# Quickstart: 驗證分頁專屬的組別身分

## 前置條件

- 依 `specs/001-live-classroom-quiz/quickstart.md` 完成 `.env.local`；`docker compose up -d redis`、`pnpm dev`、`pnpm worker:sheets-writeback` 已啟動。
- 一份可匯入的學習單（例如官方範本複本），活動設定至少兩個組別（teamA、teamB）。
- **只用一個瀏覽器**（一般視窗即可；無痕視窗也可以，但所有無痕視窗同樣共用 cookie，正好用來重現原本的問題）。
- 更新後第一次使用：舊的 `classroom_session` 不再有效，教師需重新登入。

## 自動化檢查

```text
pnpm test:unit          # seat 格式、身分解析狀態表
pnpm test:contract      # join 發 seat cookie、OAuth 發 qa_teacher
pnpm test:security      # 複製網址、跨活動、教師端點
pnpm test:integration   # 需 Redis：同一 cookie jar 兩分頁搶答（使用者情境）、SSE ?seat=
pnpm lint && pnpm typecheck
```

## 人工驗證情境

### A. 同一個瀏覽器兩個組別（US1，使用者回報的情境）
1. 分頁 1：教師登入 → 匯入 → 進入教師控制台，記下活動代碼。
2. 分頁 2：開啟 `/join`，以 teamA 加入 → **預期**：網址為 `/student/activity?seat=…`，頁首顯示 teamA。
3. 分頁 3：開啟 `/join`，以 teamB 加入 → **預期**：網址的 seat 與分頁 2 不同，頁首顯示 teamB；切回分頁 2 重新整理，仍顯示 teamA。
4. 分頁 1 開放第 1 題。
5. 分頁 2 送出答案 → **預期**：顯示「答案已送達」；教師端出現 teamA 第 1 位。
6. 分頁 3 送出答案 → **預期**：成功，教師端出現 teamB 第 2 位，兩組答案內容正確、沒有互相取代。
7. 分頁 1 結束本題 → **預期**：teamA 搶答成功；分頁 2、3 各自看到最終結果。

### B. 教師與學生同一個瀏覽器（US2）
1. 接續 A，分頁 1（教師）再開放下一題並結束、執行回填 → **預期**：全部成功，不需重新登入。
2. 在分頁 2 的開發者工具 Console 執行 `fetch("/api/activities/<id>/rounds/open", { method: "POST", headers: { "content-type": "application/json", "x-quickanswer-seat": new URL(location.href).searchParams.get("seat") }, body: JSON.stringify({ questionNumber: "1" }) }).then(r => r.status)` → **預期**：`403`。

### C. 身分不可挪用（US3）
1. 複製分頁 2 的網址，貼到**另一個瀏覽器**（或另一個 Chrome 設定檔）→ **預期**：被導向 `/join`。
2. 把分頁 2 網址的 seat 改掉一個字元後開啟 → **預期**：被導向 `/join`。
3. 開啟 `/student/activity`（不帶 seat）→ **預期**：被導向 `/join`。

## 預期結果

所有自動化檢查通過；A–C 情境全部符合預期。
