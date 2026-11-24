# HTTP API Contract Changes: 002

只列出相對 `specs/001-live-classroom-quiz/contracts/http-api.md` 的新增與變更。錯誤格式沿用：`{ error: { code, message, requestId, details? } }`。

## NEW `GET /api/sheets/{spreadsheetId}/tabs`

- **Auth**: teacher session.
- **200**: `{ tabs: [{ sheetId: number, title: string, index: number }] }`（依 index 排序）
- **403**: Google 授權失效或無檔案權限。**404**: 找不到試算表。**503**: Google 暫時無法連線。

## CHANGED `POST /api/activities/import`

- Request 不變：`{ spreadsheetId, sheetId, groupNames }`（`sheetId` 由分頁清單取得）。
- **201** response — `questions[]` 每項新增：
  ```json
  {
    "questionNumber": "1",
    "prompt": "子題一／子題二",
    "kind": "group",
    "mappingStatus": "confirmed",
    "candidateSlotTokens": [],
    "blanks": [
      { "label": "（1）", "prompt": "子題一", "mappingStatus": "confirmed" },
      { "label": "（2）", "prompt": "子題二", "mappingStatus": "confirmed" }
    ]
  }
  ```
  另回傳 `layout: "table" | "marker"`。
- **404**: 分頁不存在（訊息改為「找不到指定的工作表分頁，請重新選擇。」）。
- **422** `INVALID_INPUT`：`details` 為 issue 陣列，**保證至少一項**：
  ```json
  [{ "code": "missing_answer_slot", "questionNumber": "3", "rowNumber": 9, "message": "第 3 題（第 9 列）找不到作答格。" }]
  ```
  新增代碼：`no_questions_found`、`header_missing_answer_column`。

## CHANGED `POST /api/activities/{activityId}/mappings/confirm`

- 比對改用結構快照；工作表結構改變時 **409**「工作表題目結構已變更，請重新匯入。」其餘不變（僅單題、記號版面會出現 ambiguous）。

## CHANGED `POST /api/activities/{activityId}/rounds/open`

- **200** 與 `phase.changed` 事件 `data` 新增 `kind` 與 `blanks: [{ label, prompt }]`。

## CHANGED `POST /api/activities/{activityId}/rounds/{roundId}/submissions`

- Request：`{ answers: string[], requestId }`（每項 trim 後 1–4000 字，1–20 項）；舊格式 `{ answer, requestId }` 仍接受並視為 `answers: [answer]`。
- **201**: 沿用，另含 `answers`。
- **422** `INVALID_INPUT`：答案數量與子題數不符或有空白子題 —「請填寫所有子題的答案。」（不分配順位）。
- `submission.accepted` / `submission.receipt` / `results.finalized` 事件與結果查詢中的 submission 新增 `answers`，`answer` 為顯示文字。

## CHANGED `POST /api/activities/{activityId}/rounds/{roundId}/writeback`

- 行為：可對**任一**已結束且有得獎組別的回合排入回填（不限目前回合）。
- worker 失敗碼：結構改變 → `CONFLICT`（狀態 `failed`），不寫入任何儲存格。

## CHANGED teacher activity view (`GET` page data via `getTeacherActivity`)

- 新增 `completedRounds: [{ roundId, questionNumber, prompt, kind, winnerGroupId, submissions, writebackJob? }]`。
- `questions[]` 新增 `kind` 與 `blanks`。
