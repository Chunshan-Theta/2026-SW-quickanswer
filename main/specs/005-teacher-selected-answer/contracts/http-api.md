# HTTP / SSE Contract Changes: 005

> 給 OpenSpec 組：本功能改變了「題目結束後學生可見的內容」與回填 API 的請求格式（向下相容）。

## CHANGED `POST /api/activities/{activityId}/rounds/{roundId}/writeback`（teacher）

Request：

```json
{ "requestId": "uuid", "selection": { "source": "group", "groupId": "B" } }
{ "requestId": "uuid", "selection": { "source": "teacher", "answers": ["CPU", "作業系統"] } }
{ "requestId": "uuid" }
```

- `selection` 可省略：省略時採用最快組別（與 001–004 相同）。
- `groupId`：1–64 字；`answers`：1–20 項，每項 trim 後 1–4000 字。

Response `202`：

```json
{ "jobId": "activity:round", "status": "queued", "existing": false, "revision": 2,
  "adopted": { "source": "group", "groupId": "B", "answer": "…", "answers": ["…"] } }
```

`existing: true` 表示相同選擇已在處理中或已成功，未產生新的寫入。

Errors：

| Status | 情況 | message |
|---|---|---|
| 422 | body 格式錯誤 | 無效的回填請求。 |
| 409 | 題目尚未結束 | 回填僅能在已結束的搶答回合執行。 |
| 409 | 未指定 selection 且無人作答 | 本題沒有得獎答案可回填。 |
| 409 | 指定的組別沒有在本題送出 | 所選組別沒有在本題作答。 |
| 409 | 自行輸入的答案數與子題數不符或含空白 | 請填寫所有子題的正確答案。 |
| 409 | 同題回填處理中且選擇不同 | 目前回填處理中，請等待完成後再改選答案。 |

## CHANGED `GET …/writeback`（teacher）

Response 增加 `revision` 與 `adopted`（同上）。

## CHANGED 學生可見資料（breaking for student clients）

- `activity.snapshot`、`GET …/rounds/{roundId}/results`：學生在題目結束後只會拿到**自己組別**的 `submissions`，`winnerGroupId` 一律為 `null`；回填成功後增加 `publishedAnswer`：

```json
"publishedAnswer": { "source": "group", "groupId": "B", "answer": "…", "answers": ["…"], "publishedAt": "…" }
"publishedAnswer": { "source": "teacher", "groupId": null, "answer": "…", "answers": ["…"], "publishedAt": "…" }
```

- 教師端 snapshot：已結束題目另含 `publishedAnswer` 與 `writebackJob.adopted`。

## CHANGED SSE

- `results.finalized`（學生）：`data.submissions` 只含自己組別，`data.winnerGroupId: null`。
- `writeback.status`（教師）：queued 時 data 含 `adopted`；succeeded 時 data 含 `published`。
- NEW `answer.published`（學生，由 succeeded 的 `writeback.status` 投影而來）：

```json
{ "type": "answer.published", "stateVersion": 18,
  "data": { "roundId": "…", "questionNumber": "1",
            "published": { "source": "group", "groupId": "B", "answer": "…", "answers": ["…"], "publishedAt": "…" } } }
```

學生不會收到其他狀態的 `writeback.status`。
