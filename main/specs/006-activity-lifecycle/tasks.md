# Tasks: 我的課堂活動清單與關閉房間

**Input**: Design documents from `specs/006-activity-lifecycle/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, diagrams `006-*.puml`

**Tests**: Required by the constitution (III/IV). Within every phase the test tasks come first and must fail before the implementation tasks are done.

**Organization**: Tasks are grouped by user story. All paths are relative to `main/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2

---

## Phase 1: Setup

- [X] T001 Point SpecKit at the feature (`.specify/feature.json` → `specs/006-activity-lifecycle`). Write spec, checklist, plan, research, data-model, contracts and quickstart. Create `diagrams/006-component|class|sequence.puml` and render them to PNG.

---

## Phase 2: Foundational (blocking both stories)

- [X] T002 [P] Unit tests for `tests/unit/activities/activity-lifecycle.test.ts`:
  - `isActivityEnded`
  - `activityListStatus` for every phase
  - `sortTeacherActivities`: ongoing first, newest first, stable, no mutation, missing `createdAt` last within a status
  - `phaseAfterRoundsClosed`: ended is sticky, completed vs active
- [X] T003 Implement `src/features/activities/domain/activity-lifecycle.ts` (makes T002 pass).
- [X] T004 Add `ended` to `activityPhases` and add `endedAt`.
  - `src/features/activities/domain/types.ts`
  - `ActivitySnapshot.endedAt` in `src/features/activities/domain/snapshot.ts`
  - `teacherActivities` key in `src/server/redis/keyspace.ts`

**Checkpoint**: shared types and pure helpers ready.

---

## Phase 3: User Story 1 — 從「我的課堂活動」回到進行中的房間 (P1) 🎯 MVP

**Goal**: Every import is recorded for its teacher. The workspace lists the teacher's own activities, and the teacher can return to any console.

**Independent Test**: `tests/integration/activity-lifecycle.test.ts` (index) + `tests/contract/activity-lifecycle.test.ts` (list route).

### Tests for User Story 1

- [X] T005 [P] [US1] Update `tests/unit/sheets/import-guided-notes.test.ts`. The import writes the meta, `createdAt`, `sheetTitle` and the optional `spreadsheetTitle`, plus the teacher index, in one `MULTI` with the activity TTL.
- [X] T006 [P] [US1] Integration tests in `tests/integration/activity-lifecycle.test.ts` (real Redis, Google adapter stubbed):
  - an import is listed for its teacher with every summary field
  - another teacher's activities are never listed
  - ongoing before ended, newest first, at most 50
  - an expired activity is removed from the index and not listed
- [X] T007 [P] [US1] Contract tests in `tests/contract/activity-lifecycle.test.ts` for `GET /api/teacher/activities`: 200 for the teacher (service called with the session teacher id), 401 anonymous, 403 student.
- [X] T008 [P] [US1] Schema test: `activityImportSchema` accepts an optional `spreadsheetTitle` (trimmed, ≤ 200) and still accepts bodies without it. Goes in `tests/unit/validation/activity-import-schema.test.ts`.

### Implementation for User Story 1

- [X] T009 [US1] `src/lib/validation/schemas.ts`: optional `spreadsheetTitle`.
- [X] T010 [US1] `src/features/activities/application/teacher-activities.ts`: `listTeacherActivities` (the index `ZADD` itself is written by the import inside its `MULTI`, see T011) (ZREVRANGE + MGET + ZREM expired + ownership re-check + summaries + sort).
- [X] T011 [US1] `src/features/sheets/application/import-guided-notes.ts`: `createdAt`, `sheetTitle`, `spreadsheetTitle`, and meta + index written in one `MULTI` (makes T005 and T006 pass).
- [X] T012 [US1] `src/app/api/teacher/activities/route.ts` (makes T007 pass).
- [X] T013 [US1] Server component `src/components/teacher/activity-list.tsx`, rendered on `src/app/(teacher)/teacher/import/page.tsx` for a signed-in teacher. The console's back link `src/app/(teacher)/teacher/activities/[activityId]/page.tsx` becomes 「返回教師工作區」. `guided-notes-import.tsx` sends the Picker file name. Styles go in `globals.css`.

**Checkpoint**: the teacher can always get back to an activity from the workspace.

---

## Phase 4: User Story 2 — 老師關閉房間 (P1)

**Goal**: A teacher-only, idempotent, atomic close.
- It closes every open question and sets `ended`, which notifies everyone.
- After it, join, open and submit are blocked.
- Writeback still works.

**Independent Test**: `tests/integration/activity-lifecycle.test.ts` (close) + `tests/contract/activity-lifecycle.test.ts` (close route) + `tests/security/activity-lifecycle.test.ts`.

### Tests for User Story 2

- [X] T014 [P] [US2] Integration tests in `tests/integration/activity-lifecycle.test.ts`:
  - **Close with questions open.** Two open questions with one submission. `closeActivity` closes both, the phase becomes `ended` with `endedAt`, and no open map remains. Events: two `results.finalized`, then `activity.ended`, with contiguous versions.
  - **Close with nothing open.** A room with no open questions closes too.
  - **Idempotent.** The second call returns `alreadyEnded: true` with no new event.
  - **Ownership.** Another teacher gets 403 and nothing changes.
  - **Stale open set.** The script reports `STALE_OPEN_ROUNDS` when an open round is missing from its keys.
  - **Rejected after ended.** Open, submit, join lookup and join are refused with the ended messages.
  - **Writeback after ended.** It can still be queued (the test cleans up its own job and stream entry).
- [X] T015 [P] [US2] Contract tests in `tests/contract/activity-lifecycle.test.ts` for `POST /api/activities/{id}/close`: 200 for the teacher (service called with activity id and session teacher id), 401 anonymous, 403 student, error passthrough (403/404).
- [X] T016 [P] [US2] Security tests in `tests/security/activity-lifecycle.test.ts`, using the real session module:
  - a seat (student) cookie gets 403 on list and close, even in a browser that also holds the teacher cookie
  - the list ignores any `teacherId` query and uses the session teacher
- [X] T017 [P] [US2] Projection test: `activity.ended` reaches students unchanged, and other events keep their rules. Goes in `tests/unit/events/activity-ended-projection.test.ts` (own file; the shared projection test is left to 005).

### Implementation for User Story 2

- [X] T018 [US2] `close-rounds.lua` mode `end-activity`. `open-rounds.lua` and `submit-answer.lua` reject `ended` (`ACTIVITY_ENDED`).
- [X] T019 [US2] `src/server/redis/round-store.ts`: `closeActivity` (read the open set, EVAL, retry on stale) plus the new error messages. `round-service.ts`: `closeActivityRoom`.
- [X] T020 [US2] `src/app/api/activities/[activityId]/close/route.ts`. `join-activity.ts` gets the ended message. `activity-snapshot.ts` and `teacher-activity.ts` expose `endedAt`. `activity-event-projection.ts` forwards `activity.ended`. (Makes T014–T017 pass.)
- [X] T021 [US2] UI:
  - `src/components/teacher/close-room-control.tsx` (status, 「關閉房間」, in-page confirm)
  - `round-control.tsx` (join-code panel / toolbar only): `activity.ended` listener, sticky ended phase, read-only open/close when ended, writeback kept
  - `student/activity-round.tsx`: `activity.ended` listener, 「活動已結束」 banner and pill
  - styles in `globals.css`

**Checkpoint**: a room can be closed safely, and everyone sees it immediately.

---

## Phase 5: Polish & Cross-Cutting

- [X] T022 [P] E2E spec `tests/e2e/activity-lifecycle.spec.ts` (seeded Redis, teacher cookie): list → console → close room → student banner → join rejected. Not executed locally because Playwright browsers aren't installed.
- [X] T023 Run `pnpm typecheck`, `pnpm lint` and `pnpm exec vitest run tests/unit tests/contract tests/security tests/architecture tests/integration tests/load`. Fix any failure.
- [ ] T024 SSR smoke on a private port (not 3000) with seeded data: the workspace list renders for the teacher, the console shows 「關閉房間」, and the student page shows the ended banner.
- [X] T025 Verify the implementation against `diagrams/006-*.puml` and record the result in `quickstart.md`.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4) → Phase 5.
- US1 and US2 share only the Phase 2 types. Within each story, the tests come before the implementation.

### Parallel Opportunities

- T002 / T004
- T005–T008
- T014–T017
- T022 with T024

## Implementation Strategy

MVP = Phases 1–3 (the teacher can get back to the room). US2 then adds closing the room. Each phase ends with its tests green.

## Analysis (`/speckit-analyze`, 2026-11-25)

| Requirement | Covered by tasks |
|---|---|
| FR-001 import records the activity for its teacher | T005, T006, T010, T011 |
| FR-002 own activities only; students / anonymous get none | T006, T007, T010, T012, T016 |
| FR-003 status, code, counts, created time, title, link | T006, T010, T013 |
| FR-004 ongoing first, newest first, ≤ 50 | T002, T003, T006, T010 |
| FR-005 expired activities never listed | T006, T010 |
| FR-006 back to workspace; latest state on return | T013 (004 snapshot/SSE tests unchanged), quickstart A |
| FR-007 close room with in-page confirm | T021, quickstart B-1 |
| FR-008 every open question closed at once, nothing left open | T014, T018, T019 |
| FR-009 owner only | T014, T015, T016 |
| FR-010 idempotent | T014, T018 |
| FR-011 join / open / submit rejected after ended | T014, T018, T020 |
| FR-012 students see 活動已結束 live and after reload | T017, T020, T021, T022 |
| FR-013 console read-only for open/close, writeback kept | T002 (sticky phase), T014 (writeback), T021 |
| FR-014 ended activity kept and listed until TTL | T006, T014 |

**Findings, all resolved**:
- **LOW, coverage.** No test asserted the optional import title. Added T008 (schema) and the title assertions in T005/T006.
- **LOW, conflict risk with the parallel feature 005.** The projection test (T017) and the import schema test (T008) live in new files. UI edits in `round-control.tsx` / `activity-round.tsx` are limited to the header, toolbar and banner. The shared diagrams are left to integration.
- **Consistency.** These terms match across the spec, data model, contracts and diagrams:
  - 「已關閉」 = `phase: "ended"`
  - 「進行中」 = every other phase (`activityListStatus`)
  - 「我的課堂活動」 = `teacher:{teacherId}:activities` + `listTeacherActivities`
  - 「關閉房間」 = `POST /api/activities/{id}/close` → `close-rounds.lua` mode `end-activity`
- **Constitution.** No violations (see plan.md). No CRITICAL or HIGH findings.
