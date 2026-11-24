# Research: 我的課堂活動清單與關閉房間

## R1. Does leaving the console break the room?

**Finding**: No.
- Activities, rounds, submissions, order, winner and writeback jobs all live in Redis under the activity TTL (`ACTIVITY_TTL_SECONDS`, default 7 days).
- The console is a pure view. Its initial props come from `getTeacherActivity`, and SSE (`/api/activities/{id}/events`) sends a snapshot on (re)connect, then contiguous events.
- Open rounds have no timer and no dependency on a connected teacher.

**Decision**: No change to room state handling. The fix is a way back (R2) plus a way to end the room (R4).

## R2. How the teacher finds the way back

**Options**:
- (a) Scan `activity:*:meta` keys. Rejected: O(N) `SCAN` over every teacher's data, and leaky by design.
- (b) A per-teacher sorted set written at import. Chosen.
- (c) A cookie or localStorage holding the last activity id. Rejected: per browser, lost across devices, and only remembers one activity.

**Decision**: `teacher:{teacherId}:activities` is a sorted set.
- member = activityId, score = createdAt in milliseconds.
- `importGuidedNotes` writes the activity meta and the `ZADD` + `EXPIRE` (TTL = activity TTL, refreshed by every import) in one `MULTI`, so a created activity is always listed.
- Listing reads `ZREVRANGE 0 49` and `MGET`s the meta keys. Ids whose meta is gone (expired) are removed with `ZREM`.
- Each meta's `teacherId` is re-checked against the session teacher (defence in depth).

**UI placement**: The user chose only 「我的課堂活動」 in the workspace.
- `/teacher/import` is already the teacher's landing page after OAuth and the rail's 教師工作區 target, so the list is server-rendered there above the import form.
- No new page, no persistent nav button, no `beforeunload`.
- The console's 「返回匯入」 becomes 「返回教師工作區」 (same URL).

**API**: `GET /api/teacher/activities` returns the same summaries. It is for the OpenSpec subgroup and for tests. The page calls the service directly, so there is no extra HTTP hop.

## R3. What a list entry shows

Fields: status, join code, question count, open-question count, completed-question count, group count, created time, title.
- **Title**: the Picker file name the client already has (`spreadsheetTitle`, optional in the import body, ≤ 200 chars, display only), else the worksheet tab title (`grid.title`, already read during import), else none. No new Google API call.
- **Status** is `ended` only after 關閉房間. Every other phase (`mapping_review`, `ready`, `active`, `completed`) is 「進行中」, with a detail line: 待確認作答格 / 尚未開題 / N 題搶答中 / 題目皆已結束.
- **Order**: ongoing first, then `createdAt` descending (pure `sortTeacherActivities`).
- Activities imported before 006 have no index entry and no `createdAt`. They are not listed (documented assumption).

## R4. Closing the room atomically

**Options**:
- (a) A new `close-activity.lua` that copies the close logic. Rejected (constitution I: duplicated logic).
- (b) A new `end-activity` mode in `close-rounds.lua`. Chosen.

**Decision**: `close-rounds.lua` ARGV[4] mode `end-activity`.

- **Idempotent.** If `activity.phase == "ended"`, the script returns `{ phase: "ended", endedAt, rounds: [], stateVersion, alreadyEnded: true }` with no writes.
- **Close.** It runs the `open-only` loop over the round ids passed in. Zero targets is allowed.
- **Stale check.** If any entry of `openRoundIdsByQuestion` was not among the passed rounds (a question opened between the store's `GET` and the `EVAL`), it returns `STALE_OPEN_ROUNDS`. Nothing has been written yet, because writes only happen after validation. `closeActivity` re-reads and retries up to 3 times.
- **After the rounds close:**
  - set `phase = "ended"` and `endedAt = closedAt`, and remove `openRoundIdsByQuestion`
  - bump `stateVersion` and append `activity.ended` with `{ phase: "ended", endedAt }` after the rounds' `results.finalized` events
- **Return** `{ phase, endedAt, rounds, stateVersion, alreadyEnded: false }`.
- **Ownership** reuses the existing `FORBIDDEN` check. Any non-ended phase can be closed, including `mapping_review` and `completed`.

## R5. Rejecting work after the room is closed

**Opening.** `open-rounds.lua` already rejects every phase except ready/active with the generic `CONFLICT`. An explicit `ACTIVITY_ENDED` check comes first: 409 「活動已關閉，無法再開放題目。」

**Submitting.** After closing, every round is closed, so submissions already fail with `ROUND_CLOSED`. An explicit `ACTIVITY_ENDED` check (409 「活動已關閉，無法再作答。」) makes the message clear and guards stale clients.

**Joining.** `lookupActivityByJoinCode` and `joinActivity` already reject phases other than ready/active with 「此活動目前無法加入。」. For `ended` they now say 「此活動已關閉，無法加入。」 (409).

**Join code.** The code key is **not** deleted. It stays reserved until the TTL, so it is never reassigned to a new room while students may still type it. This also keeps the script's key list unchanged.

**Writeback.** `enqueue-writeback.lua` checks only that the round is closed and owned by the teacher, so it keeps working after the room is closed. An integration test guards this.

## R6. Realtime and clients

**Projection.** `projectActivityEvent` forwards `activity.ended` to students (it carries no answers).

**Console.**
- Listens for `activity.ended` and sets `phase = "ended"`.
- `phaseAfterRoundsClosed` keeps `ended` sticky, so a late `results.finalized` can't turn it back into `active`/`completed`.
- When ended: open/close-all/close-one are disabled, and writeback buttons stay.
- 「關閉房間」 shows an inline confirm panel that states how many open questions will end. It does not use `window.confirm`: that is untestable and blocks automation.

**Student page.**
- Listens for `activity.ended` and shows the banner 「活動已結束」, with the phase pill showing 活動已結束.
- There are no answer forms, because all rounds are closed.
- After a reload, the snapshot `phase: "ended"` restores the same view.

**Snapshot / teacher view.** Both add `endedAt`. `phase` already carries `ended`.

## R7. Testing against shared Redis

New integration tests use random activity and teacher ids and clean up their keys. The writeback test removes only its own job keys and stream entry. It never flushes or deletes the global `writeback:jobs` stream.
