# HTTP API Contract Changes: 004

> For the OpenSpec subgroup: request/response changes needed to stay feature-consistent. Everything not listed is unchanged.

## CHANGED `POST /api/activities/{activityId}/rounds/open` (teacher)

Request — either form:

```json
{ "questionNumbers": ["1", "2"] }
```

```json
{ "questionNumber": "1" }
```

- `questionNumbers`: 1..200 digit strings, no duplicates (422 otherwise).
- All-or-nothing: if any question is missing, unconfirmed, already open, already completed or duplicated, nothing is opened.

Response `200` for `questionNumbers`:

```json
{
  "rounds": [
    { "roundId": "…", "questionNumber": "1", "prompt": "…", "kind": "single", "blanks": [{ "label": null, "prompt": "…" }], "phase": "open", "openedAt": "2026-11-25T…Z", "stateVersion": 7 },
    { "roundId": "…", "questionNumber": "2", "prompt": "…", "kind": "group", "blanks": [ … ], "phase": "open", "openedAt": "…", "stateVersion": 8 }
  ],
  "stateVersion": 8
}
```

Response `200` for the legacy `questionNumber` body: the single round object exactly as before (`roundId`, `questionNumber`, `prompt`, `kind`, `blanks`, `phase`, `stateVersion`, plus `openedAt`).

Errors: `403` not the activity's teacher · `404` activity missing · `409` `此題已在搶答中（第 N 題）。` / `此題已完成，無法再次開啟（第 N 題）。` / activity not openable · `422` invalid body / unknown question / unconfirmed mapping / duplicate question. The previous `目前已有題目正在搶答。` error no longer exists.

## NEW `POST /api/activities/{activityId}/rounds/close-all` (teacher)

No body. Closes every round that is open at the moment of the request, atomically.

Response `200`:

```json
{
  "rounds": [
    { "phase": "closed", "roundId": "…", "questionNumber": "2", "winnerGroupId": "A", "submissions": [ … ], "closedAt": "…", "stateVersion": 12 }
  ],
  "stateVersion": 13
}
```

Errors: `403`, `404`, `409 目前沒有開放中的題目。`

## UNCHANGED (behaviour widened)

- `POST /rounds/{roundId}/close` — same request/response (single closed round object, now also with `closedAt`). Closing one round never affects other open rounds.
- `POST /rounds/{roundId}/submissions` — same request/response; accepted for any currently open round of the activity; `409 此搶答回合已結束。` once that round is closed.
  - Fix (T031): the `201` body is now an explicit allow-list `{ accepted, groupId, answer, answers, acceptedOrder, acceptedAt, stateVersion }`. It no longer includes `winnerGroupId`, which used to tell a student group who was winning while the question was still open (FR-009).
- `POST /rounds/{roundId}/writeback` — same request/response; when the previous job for the round has `status: "failed"`, the job is re-queued (`existing: false`, `status: "queued"`) instead of returning the failed job.

## CHANGED SSE `activity.snapshot` and teacher page data (breaking)

```json
{ "activityId": "…", "phase": "active", "stateVersion": 9, "rounds": [ ActivityRoundSnapshot, … ] }
```

- `currentRound` is removed. Migration: `currentRound` → `rounds.filter((round) => round.phase === "open")`.
- Teacher page data: `currentRound` and `completedRounds` are replaced by the same `rounds` list.
- `ActivityRoundSnapshot` gains `openedAt` and `closedAt`.

## UNCHANGED SSE events

`phase.changed` (one per opened round), `submission.accepted` (teacher) / `submission.receipt` (student, own group), `results.finalized` (one per closed round), `writeback.status`, `heartbeat` — names and `data` payloads unchanged; every event carries `roundId`, so clients must key rounds by `roundId` instead of assuming a single current round.
