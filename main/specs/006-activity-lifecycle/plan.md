# Implementation Plan: 我的課堂活動清單與關閉房間

**Branch**: `feat/006-activity-lifecycle` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-activity-lifecycle/spec.md`

## Summary

Leaving the console never breaks a room. All state is in Redis, and the console rebuilds itself from the snapshot and SSE. The real gaps are that the teacher has no way back to the console and has no way to end a room. With `diagrams/006-*.puml` as the blueprint, this plan adds:

1. **Teacher activity index.** A per-teacher sorted set `teacher:{teacherId}:activities` (score = createdAt ms). It is written in the same `MULTI` as the activity meta at import, and it expires with the activity. `listTeacherActivities` reads the newest 50 entries plus their meta keys, drops expired entries lazily, and builds summaries. The summaries are sorted ongoing-first, then newest-first, by a pure `activity-lifecycle` module.
2. **Workspace list.** `/teacher/import` server-renders 「我的課堂活動」 for the signed-in teacher above the import form. `GET /api/teacher/activities` exposes the same data. The console's back link becomes 「返回教師工作區」.
3. **Close room.** `POST /api/activities/{id}/close` calls `closeActivity`. That reads the open round ids and runs `close-rounds.lua` in a new `end-activity` mode. In one script the mode closes every open round (same results and events as close-all), sets `phase = "ended"` plus `endedAt`, removes the open map, and appends an `activity.ended` event. The call is idempotent for an ended room. If a question was opened between the read and the script, the script reports `STALE_OPEN_ROUNDS` and the store retries.
4. **Terminal phase.** `open-rounds.lua` and `submit-answer.lua` reject `ended` with `ACTIVITY_ENDED`. Join lookup and join reject it with 「此活動已關閉，無法加入。」. Writeback of closed rounds is unchanged, so it still works after the room is closed.
5. **Clients.** The SSE projection forwards `activity.ended` to students. The console shows the room status and a 「關閉房間」 button with an in-page confirm. When ended, it disables open/close but keeps writeback. The student page shows a 「活動已結束」 banner. Snapshot and teacher view expose `endedAt`.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (Next.js 16 App Router, React 19)

**Primary Dependencies**: `redis` 6 client with Lua scripts, `zod` 4, `lucide-react` (existing). No new dependency.

**Storage**: Private Redis 7. New key `teacher:{teacherId}:activities` (sorted set). The activity JSON gains `createdAt`, `endedAt`, `spreadsheetTitle`, `sheetTitle`, and the terminal phase `ended`.

**Testing**: Vitest (unit, contract, integration against local Redis, security, architecture). A Playwright e2e spec is added, but browsers are not installed locally, so it is not executed.

**Target Platform**: Local Node.js server plus browsers (course scope).

**Project Type**: Single Next.js web application (`main/`).

**Performance Goals**:
- The list costs one `ZREVRANGE` plus one `MGET` (≤ 50 keys) per workspace render.
- Closing a room costs one `GET` plus one `EVAL` (rarely retried).

**Constraints**:
- Every state change and its events stay atomic in Lua.
- SSE needs contiguous `stateVersion` values, so each closed round and the `activity.ended` event each take one version.
- Never persist an empty Lua table (cjson `{}`/`[]` ambiguity). The open map is removed when empty.
- Teachers only ever see their own activities.
- Students never get teacher data.

**Scale/Scope**: At most 50 activities listed per teacher. Activities keep their 7-day TTL.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Clear, Consistent Code | The new phase name `ended` sits next to the existing phases. Closing a room reuses `close-rounds.lua`, so it is not a near-copy script. The list status and order live in one pure module that both server rendering and the API use. | PASS |
| II. Simplicity | No new dependency. The list reuses the existing workspace page rather than adding a new page, nav button or beforeunload prompt (the user chose only the list). The index is one sorted set. One new script mode, two new routes. | PASS |
| III. Tests Define Behavior | Failing tests come first: index written at import and listed per teacher, expired entries dropped, close room atomic and idempotent, join/open/submit rejected after ended, writeback still allowed. Pure lifecycle helpers have unit tests. | PASS |
| IV. Risk-Based Coverage | Lua atomicity (close every open round plus the phase change plus event order, stale open set) is covered by integration tests on Redis. Routes have contract tests (auth, ownership, shapes). The security test uses the real session module (seat cookie on teacher routes, list scoped to the session teacher). An e2e spec is added. | PASS |
| V. Maintainable Change | Existing routes keep their contracts. New response fields and the `ended` phase are additive. Import accepts an optional `spreadsheetTitle`. The new SSE event `activity.ended` is ignored by older clients. All of this is documented in `contracts/http-api.md` for the OpenSpec subgroup. | PASS |
| VI. Design-First with PlantUML | `diagrams/006-component.puml`, `006-class.puml` and `006-sequence.puml` were created before planning and rendered to PNG. The shared diagrams are reconciled at integration (parallel feature 005). The implementation is verified against the 006 diagrams at the end (T025). | PASS |

**Post-design re-check (after Phase 1)**: PASS.
- `data-model.md` matches `006-class.puml`: ActivityRecord fields, TeacherActivityIndex, TeacherActivitySummary, CloseActivityResult, ActivityEndedEvent and the ActivityLifecycle functions.
- `contracts/http-api.md` matches the request paths in `006-sequence.puml`.

## Project Structure

### Documentation (this feature)

```text
specs/006-activity-lifecycle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/http-api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root: `main/`)

```text
src/
├── server/redis/
│   ├── keyspace.ts                          # CHANGED: teacherActivities key
│   ├── round-store.ts                       # CHANGED: closeActivity (+ ACTIVITY_ENDED / STALE errors)
│   └── scripts/
│       ├── close-rounds.lua                 # CHANGED: mode end-activity
│       ├── open-rounds.lua                  # CHANGED: reject ended
│       └── submit-answer.lua                # CHANGED: reject ended
├── server/events/activity-event-projection.ts  # CHANGED: forward activity.ended to students
├── features/activities/
│   ├── domain/activity-lifecycle.ts         # NEW: pure status / order / phase helpers
│   ├── domain/types.ts                      # CHANGED: ended phase, endedAt
│   ├── domain/snapshot.ts                   # CHANGED: ActivitySnapshot.endedAt
│   ├── application/teacher-activities.ts    # NEW: recordTeacherActivity / listTeacherActivities
│   ├── application/round-service.ts         # CHANGED: closeActivityRoom
│   ├── application/activity-snapshot.ts     # CHANGED: endedAt
│   ├── application/teacher-activity.ts      # CHANGED: endedAt
│   └── application/join-activity.ts         # CHANGED: ended message
├── features/sheets/application/import-guided-notes.ts  # CHANGED: createdAt, titles, index in MULTI
├── lib/validation/schemas.ts                # CHANGED: optional spreadsheetTitle
├── app/api/teacher/activities/route.ts      # NEW
├── app/api/activities/[activityId]/close/route.ts  # NEW
├── app/(teacher)/teacher/import/page.tsx    # CHANGED: render the list
├── app/(teacher)/teacher/activities/[activityId]/page.tsx  # CHANGED: 返回教師工作區
├── components/teacher/activity-list.tsx     # NEW (server component)
├── components/teacher/close-room-control.tsx  # NEW (client, in-page confirm)
├── components/teacher/round-control.tsx     # CHANGED: header/toolbar only (status, close room, read-only when ended)
├── components/teacher/guided-notes-import.tsx  # CHANGED: send Picker file name
├── components/student/activity-round.tsx    # CHANGED: activity.ended listener + banner
└── app/globals.css                          # CHANGED: list / close-room / banner styles

tests/
├── unit/activities/activity-lifecycle.test.ts      # NEW
├── unit/events/activity-ended-projection.test.ts   # NEW
├── unit/validation/activity-import-schema.test.ts  # NEW
├── unit/sheets/import-guided-notes.test.ts         # CHANGED: MULTI mock, createdAt / titles / index
├── integration/activity-lifecycle.test.ts          # NEW
├── contract/activity-lifecycle.test.ts             # NEW
├── security/activity-lifecycle.test.ts             # NEW
└── e2e/activity-lifecycle.spec.ts                  # NEW (not run locally)
```

**Structure Decision**: Keep the existing layered layout. Domain (pure) → application services → Redis store/Lua → route handlers / server components → client components.

## Complexity Tracking

No constitution violations to justify.
