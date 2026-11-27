# Data Model: 我的課堂活動清單與關閉房間

All storage is private Redis. Lua scripts change state atomically. These fields are added to the 004 model.

## ActivityRecord (`activity:{activityId}:meta`, JSON, TTL = activity TTL)

| Field | Type | Change | Notes |
|---|---|---|---|
| `phase` | `mapping_review \| ready \| active \| completed \| ended` | **+ `ended`** | `ended` is terminal. It is set only by close room. |
| `createdAt` | ISO 8601 string | **new** | Set at import. |
| `endedAt` | ISO 8601 string | **new** | Set when the room is closed. Absent before that. |
| `spreadsheetTitle` | string ≤ 200 | **new, optional** | The Google Picker file name sent by the import UI. Display only. |
| `sheetTitle` | string | **new** | Worksheet tab title, taken from the grid read during import. |
| `openRoundIdsByQuestion` | object | unchanged (004) | Removed when the room is closed. |
| other fields | | unchanged | `teacherId`, `joinCode`, `questions`, `groupNames`, `roundIdsByQuestion`, `completedQuestionNumbers`, `stateVersion`, … |

**Transitions**: `mapping_review | ready | active | completed` → (close room) → `ended`. Nothing leaves `ended`.

## TeacherActivityIndex (`teacher:{teacherId}:activities`, sorted set)

| Element | Value |
|---|---|
| member | `activityId` |
| score | `createdAt` in milliseconds |
| TTL | activity TTL, refreshed on each import by this teacher |

- **Written:** in the same `MULTI` as the activity meta at import.
- **Read:** `ZREVRANGE 0 49`.
- **Cleanup:** members whose meta key no longer exists are removed (`ZREM`) on read.

## TeacherActivitySummary (list entry; API and server rendering)

```ts
{
  activityId: string;
  joinCode: string;
  phase: string;                    // raw phase
  status: "ongoing" | "ended";      // activityListStatus(phase)
  title: string | null;             // spreadsheetTitle ?? sheetTitle ?? null
  questionCount: number;
  openQuestionCount: number;        // keys of openRoundIdsByQuestion
  completedQuestionCount: number;   // completedQuestionNumbers.length
  groupCount: number;
  createdAt: string | null;         // ISO; falls back to the index score
  endedAt: string | null;
}
```

Order (`sortTeacherActivities`): `ongoing` before `ended`, then `createdAt` descending.

## CloseActivityResult (`POST /api/activities/{id}/close`)

```ts
{
  phase: "ended";
  endedAt: string;
  rounds: ClosedRound[];   // rounds closed by this call (same shape as close-all); [] when already ended
  stateVersion: number;
  alreadyEnded: boolean;
}
```

## ActivityEndedEvent (SSE `activity.ended`, sent to the teacher and every student)

```json
{ "type": "activity.ended", "activityId": "…", "stateVersion": 42, "occurredAt": "…", "data": { "phase": "ended", "endedAt": "…" } }
```

It is appended after the `results.finalized` events of the rounds closed by the same script. Each of those events has its own contiguous `stateVersion`.

## ActivitySnapshot / TeacherActivityView

- Both add `endedAt?: string` (present once ended).
- `phase` may now be `"ended"`.

## ActivityLifecycle (pure, `src/features/activities/domain/activity-lifecycle.ts`)

| Function | Purpose |
|---|---|
| `isActivityEnded(phase)` | `phase === "ended"` |
| `activityListStatus(phase)` | `ended` → `"ended"`, everything else → `"ongoing"` |
| `sortTeacherActivities(list)` | Ongoing first, then newest `createdAt` first (stable, does not mutate). |
| `phaseAfterRoundsClosed(current, questionCount, closedCount)` | Returns `ended` if the current phase is ended (sticky). Otherwise `completed` once every question is closed, else `active`. Mirrors `close-rounds.lua`. |

## Script errors (new)

| Code | HTTP | Message |
|---|---|---|
| `ACTIVITY_ENDED` | 409 | 活動已關閉，無法再開放題目。 (open) / 活動已關閉，無法再作答。 (submit) |
| `STALE_OPEN_ROUNDS` | retried internally; 409 「活動狀態變更中，請重試。」 after 3 attempts | |
