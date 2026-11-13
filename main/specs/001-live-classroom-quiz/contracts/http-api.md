# HTTP and SSE Contracts

Base path: `/api`. All endpoints are served by the Next.js App Router on the Node.js runtime. JSON errors use `{ "error": { "code": string, "message": string, "requestId": string } }`. Role and activity scope are derived from the server-validated session, never trusted from a request body.

## Authentication and Activity Setup

### `GET /api/auth/google/start`

Starts teacher OAuth authorization for selecting a Google Sheet. Use the narrowest supported file scope (`drive.file`) and server-side OAuth state/PKCE validation. Tokens remain server-side and are encrypted at rest.

### `GET /api/auth/google/callback`

Validates OAuth state, stores encrypted credentials, and establishes a secure HttpOnly teacher session. No access/refresh token is returned to the browser.

### `POST /api/activities/import`

Teacher-only. Imports and validates one selected spreadsheet/work sheet.

Request:

```json
{
  "spreadsheetId": "google-file-id",
  "sheetId": 123456,
  "groupNames": ["A", "B"]
}
```

Response `201`: `{ "activityId": "...", "phase": "ready|mapping_review", "questions": [{ "questionNumber": "1", "prompt": "...", "mappingStatus": "confirmed|ambiguous|missing", "candidateSlotTokens": ["opaque-token"] }] }`.

題號重複、題數不符或結構無效回傳 `422`。只有答案空格映射歧義時仍建立 `mapping_review` 活動，提供題號、原因與本次掃描的 opaque 候選 token，避免 dead-end。response 不提供 A1 座標供 client 寫入，也不暴露 access tokens。

### `POST /api/activities/{activityId}/mappings/confirm`

Teacher-only. 用匯入預覽回傳的候選 token 確認每題答案空格；server 驗證 token 綁定該 activity 目前的 sheet scan，全部映射唯一後將活動轉為 `ready`。

Request: `{ "resolutions": [{ "questionNumber": "1", "answerSlotToken": "opaque-token" }] }`.

過期 token 或重複使用同一 slot 回傳 `409` 並要求重新掃描；不得接受 client 傳入固定 cell coordinate。

### `POST /api/activities/{activityId}/join`

Student join-code flow. Server validates the activity and group, binds the resulting signed session to one group, then returns only activity phase and that group's own state.

## Round Controls and Answers

### `POST /api/activities/{activityId}/rounds/{roundId}/open`

Teacher-only. Requires a ready or active activity and a confirmed, not-yet-completed question mapping. A question cannot be reopened after close; conflicting state returns `409`.

### `POST /api/activities/{activityId}/rounds/{roundId}/submissions`

Student-only. The group is taken from the authenticated session; clients cannot choose a group ID or accepted order.

Request: `{ "answer": "...", "requestId": "client-generated-id" }`.

Accepted response `201`: `{ "accepted": true, "acceptedOrder": 1, "acceptedAt": "server timestamp" }`. A duplicate group submission returns `409`; a closed round returns `409`. No other group's identity, answer, order, or winner is returned to students while the round is open.

### `POST /api/activities/{activityId}/rounds/{roundId}/close`

Teacher-only. Atomically closes the round, rejects later submissions, fixes the final order/winner, and returns `{ "phase": "closed", "winnerGroupId": "...", "resultVersion": 12 }`. If no group submitted, `winnerGroupId` is `null`.

## Results, Events, and Writeback

### `GET /api/activities/{activityId}/rounds/{roundId}/results`

Teacher may read live submissions and order. A student may read only their own submission while open; all group results become available only after `phase == closed`.

### `GET /api/activities/{activityId}/events`

Authenticated SSE stream. Server derives actor, role, activity and group from the session; client query parameters cannot elevate access. Events include an Activity-wide monotonically increasing `stateVersion` used as the SSE event id:

- `phase.changed`: safe for every activity member.
- `submission.receipt`: only the submitting group.
- `submission.accepted`: teacher-only live status/order.
- `results.finalized`: all members, emitted only after the round closes.
- `writeback.status`: teacher-only.

On connect/reconnect, the server starts an independent Redis Stream reader before recovery and buffers concurrent events. A fresh connection receives a role-filtered snapshot; a reconnect with a retained `Last-Event-ID` receives later retained events through the same role projection. If the event id is invalid, trimmed, or separated by a version gap, the server sends a fresh filtered snapshot instead. In either path, only contiguous events newer than the recovered state are sent; a later detected gap triggers another snapshot. A teacher snapshot may include live group status/order. An open-round student snapshot contains only their own submission and phase; it MUST NOT serialize the unfiltered round hash or other groups' data. A closed-round student snapshot may include final group results. Heartbeats keep the HTTP stream alive. `Cache-Control: no-cache, no-transform` and streaming-compatible deployment are required.

### `POST /api/activities/{activityId}/rounds/{roundId}/writeback`

Teacher-only and allowed only after close. Enqueues the immutable winner result in a Redis Stream; returns `202` with `{ "jobId": "...", "status": "queued" }`. Repeated requests use the same idempotency key and do not enqueue duplicate writes.

The worker re-scans the sheet and compares the dynamic SheetBinding fingerprint immediately before writing; a stale/ambiguous mapping or revoked Google permission fails closed with a conflict/permission status. Transient errors are retryable. Consumer recovery claims idle pending jobs with `XAUTOCLAIM`; ack only after verified completion, and the idempotency key prevents duplicate writes after a crash. Google Sheets does not provide arbitrary cell compare-and-swap, so source edits during the final scan/batch-update interval are an explicit operational limitation; tests must verify detected pre-write changes are rejected. The browser never communicates with Redis or Google Sheets credentials directly.

### `GET /api/activities/{activityId}/rounds/{roundId}/writeback`

Teacher-only. Returns the persisted job id, status, attempt count, and safe error code for the activity's idempotent `activityId:roundId` writeback job. Returns `404` when no job has been queued.
