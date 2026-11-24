# HTTP / SSE Contract Changes: 006 我的課堂活動清單與關閉房間

All changes are additive. Existing requests and responses keep their shapes. Notes for the OpenSpec subgroup are marked **[OpenSpec]**.

## NEW `GET /api/teacher/activities` (teacher)

Returns the signed-in teacher's activities, newest 50: ongoing first, then by creation time descending. The teacher id always comes from the session. No query parameter can select another teacher.

```json
200
{
  "activities": [
    {
      "activityId": "…", "joinCode": "K7Q2MZ", "phase": "active", "status": "ongoing",
      "title": "題組+單題範本 的副本", "questionCount": 4, "openQuestionCount": 2,
      "completedQuestionCount": 1, "groupCount": 3,
      "createdAt": "2026-11-25T01:00:00.000Z", "endedAt": null
    }
  ]
}
```

Errors:
- `401` when not signed in.
- `403` when the session is a student (any request that carries a seat).

## NEW `POST /api/activities/{activityId}/close` (teacher, owner only)

Closes the room. Every open question is closed at the same instant (same results as close-all), and the activity becomes `ended`. No request body.

```json
200
{
  "phase": "ended", "endedAt": "2026-11-25T02:00:00.000Z",
  "rounds": [ { "phase": "closed", "roundId": "…", "questionNumber": "2", "winnerGroupId": "A", "submissions": [ … ], "closedAt": "…", "stateVersion": 12 } ],
  "stateVersion": 13, "alreadyEnded": false
}
```

- Idempotent. Closing an ended room returns `200 { "phase": "ended", "endedAt": "…", "rounds": [], "stateVersion": n, "alreadyEnded": true }` and changes nothing.
- `401` when not signed in. `403` for a student, or for a teacher who is not the owner. `404` when the activity does not exist or has expired.

## CHANGED `POST /api/activities/import` (teacher)

Optional `spreadsheetTitle` (string, trimmed, ≤ 200). This is the Picker file name, used only for display in the list. Requests without it behave exactly as before.

## CHANGED (behaviour) after a room is closed **[OpenSpec]**

| Request | Before | After `ended` |
|---|---|---|
| `GET /api/activities/join?code=` | 200 | `409 此活動已關閉，無法加入。` |
| `POST /api/activities/{id}/join` | 200 | `409 此活動已關閉，無法加入。` |
| `POST /api/activities/{id}/rounds/open` | 200 | `409 活動已關閉，無法再開放題目。` |
| `POST …/rounds/{roundId}/submissions` | 201 | `409 活動已關閉，無法再作答。` |
| `POST …/rounds/{roundId}/close`, `rounds/close-all` | — | unchanged (`409` because nothing is open) |
| `POST …/rounds/{roundId}/writeback` | 202 | **unchanged: still allowed** |

## CHANGED snapshot and teacher page data **[OpenSpec]**

- `activity.snapshot` (SSE) and the teacher view add `endedAt?: string`.
- `phase` can be `"ended"`.

## NEW SSE event `activity.ended` **[OpenSpec]**

It is delivered to the teacher and to every student (it carries no answers). It comes after the `results.finalized` events of the rounds closed by the same request.

```json
{ "type": "activity.ended", "activityId": "…", "stateVersion": 13, "occurredAt": "…", "data": { "phase": "ended", "endedAt": "…" } }
```

Clients that don't know the event simply ignore it. They still see `phase: "ended"` in the next snapshot.
