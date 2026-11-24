# Data Model: 多題同時開放搶答與教師題目控制介面

## Persisted — Redis `activity:{id}:meta` JSON

### ActivityRecord（變更）

| Field | Type | Notes |
|---|---|---|
| `phase` | `"ready" \| "active" \| "completed"` | `active` once any question opened; `completed` when every question is completed and none is open |
| `stateVersion` | number | +1 per event (each opened / closed round consumes one version) |
| `openRoundIdsByQuestion` | `Record<questionNumber, roundId>` | **NEW**. Present only while ≥ 1 round is open; removed when the last open round closes. JSON object, never an array |
| `roundIdsByQuestion` | `Record<questionNumber, roundId>` | Unchanged (002). Every round ever opened; a question is opened at most once |
| `completedQuestionNumbers` | `string[]` | Unchanged. Absent until the first close (never persisted empty) |
| ~~`currentRoundId`~~ | — | **REMOVED**. Lua deletes a leftover value on the next open/close |

**Invariants**

- `openRoundIdsByQuestion[q]` exists ⇒ `roundIdsByQuestion[q]` equals it, `round:{id}:state.phase == "open"`, and `q ∉ completedQuestionNumbers`.
- A round is closed ⇔ its question is in `completedQuestionNumbers` and absent from `openRoundIdsByQuestion`.

## Round — Redis hash `round:{id}:state`（欄位不變）

`activityId`, `questionNumber`, `prompt`, `kind`, `blankCount`, `blanks`, `phase (open|closed)`, `openedAt`, `closedAt`, `nextOrder`, `winnerGroupId`, `stateVersion`. Submissions (`round:{id}:submissions`), order (`round:{id}:order`) and winner (`round:{id}:winner`) stay per round, which is what keeps simultaneous questions independent.

## WritebackJob — Redis hash（行為變更）

Unchanged fields. A job whose `status` is `failed` can be re-queued with the same `jobId`: `status=queued`, `attempt=0`, `errorCode=""`.

## Script results

### OpenedRound（`open-rounds.lua`）

`{ roundId, questionNumber, prompt, kind, blanks[], phase: "open", openedAt, stateVersion }`; the script returns `{ rounds: OpenedRound[], stateVersion }`.

### ClosedRound（`close-rounds.lua`）

`{ phase: "closed", roundId, questionNumber, winnerGroupId | null, submissions[], closedAt, stateVersion }`; the script returns `{ rounds: ClosedRound[], stateVersion }`.

### Errors

| Code | HTTP | Meaning |
|---|---|---|
| `QUESTION_NOT_FOUND` | 422 | Question number not in the activity (`questionNumber` included) |
| `DUPLICATE_QUESTION` | 422 | Same question twice in one open request |
| `MAPPING_NOT_CONFIRMED` | 422 | Answer cells not confirmed |
| `QUESTION_ALREADY_OPEN` | 409 | Question already has an open round (replaces `ROUND_ALREADY_OPEN`) |
| `QUESTION_ALREADY_COMPLETED` | 409 | Question already closed |
| `ROUND_CLOSED` | 409 | Submit / single close on a round that is not open |
| `NO_OPEN_ROUNDS` | 409 | Close-all with nothing open |
| `CONFLICT` | 409 | Activity not in `ready`/`active` |

## Read models（`features/activities/domain/snapshot.ts`）

### ActivityRoundSnapshot（變更）

`roundId`, `questionNumber`, `prompt`, `kind`, `blanks[]`, `phase`, **`openedAt?`**, **`closedAt?`**, `winnerGroupId`, `submissions[]`, `writebackJob?` (teacher only).

Visibility: teacher → all submissions; student → own group's submission while the round is open, all submissions after it closes.

### ActivitySnapshot（變更）

`{ activityId, phase, stateVersion, rounds: ActivityRoundSnapshot[] }` — every round of the activity, sorted by question number. Replaces `currentRound`.

### TeacherActivityView（變更）

`{ activityId, joinCode, phase, groupNames, completedQuestionNumbers, questions[], rounds[] }` — `currentRound` and `completedRounds` merged into `rounds`.

## Client state（`features/activities/domain/round-state.ts`，新增）

| Function | Behaviour |
|---|---|
| `sortRounds(rounds)` | Numeric question-number order |
| `applyRoundOpened(rounds, data)` | Adds an open round (keeps existing submissions if the round is already known) |
| `applySubmission(rounds, roundId, submission, winnerGroupId?)` | Replaces that group's submission in that round only; sorted by accepted order; unknown round → unchanged |
| `applyRoundClosed(rounds, data)` | Marks the round closed with final winner/submissions/closedAt; unknown round → unchanged |
| `applyWritebackStatus(rounds, roundId, job)` | Updates the round's writeback job |
| `questionStatus(question, round?)` | `unconfirmed` · `idle` · `open` · `closed` · `writeback-pending` · `writeback-succeeded` · `writeback-failed` |
| `formatElapsed(fromIso, nowMs)` | `mm:ss` (or `h:mm:ss`) since the round opened |

## State transitions (per question)

```text
idle ──open (alone or with others, all-or-nothing)──▶ open ──close / close-all──▶ closed
closed ──writeback──▶ writeback-pending ──▶ writeback-succeeded
                                        └─▶ writeback-failed ──retry──▶ writeback-pending
unconfirmed: cannot be selected or opened
```

Activity: `ready ──first open──▶ active ──last question closed──▶ completed`.
