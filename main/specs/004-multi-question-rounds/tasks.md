# Tasks: 多題同時開放搶答與教師題目控制介面

**Input**: Design documents from `specs/004-multi-question-rounds/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, diagrams `004-*.puml`

**Tests**: Required by the constitution (III/IV). Within every phase the test tasks come first and must fail before the implementation tasks are done.

**Organization**: Tasks are grouped by user story. All paths are relative to `main/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3

---

## Phase 1: Setup

- [X] T001 Point SpecKit at the feature (`.specify/feature.json` → `specs/004-multi-question-rounds`), write spec/checklist/plan/research/data-model/contracts/quickstart, create `diagrams/004-component|class|sequence.puml`, update `diagrams/class.puml` and `diagrams/sequence.puml`, render all to PNG

---

## Phase 2: Foundational (blocking all stories)

- [X] T002 [P] Unit tests for the pure round-state module in `tests/unit/activities/round-state.test.ts` (open adds/sorts and is idempotent, submission upsert per round only, unknown round ignored, close sets final results, writeback status, `questionStatus` for every state, `formatElapsed`)
- [X] T003 [P] Unit tests for the open request schema in `tests/unit/validation/round-open-schema.test.ts` (array form, legacy form → `legacy: true`, empty / duplicate / non-numeric rejected)
- [X] T004 Add `openedAt` / `closedAt` to `ActivityRoundSnapshot` and replace `currentRound` with `rounds[]` in `src/features/activities/domain/snapshot.ts`
- [X] T005 Implement `src/features/activities/domain/round-state.ts` (make T002 pass)
- [X] T006 Change `roundOpenSchema` in `src/lib/validation/schemas.ts` to accept `{ questionNumbers[] }` or legacy `{ questionNumber }` (make T003 pass)

**Checkpoint**: shared types, reducer and validation ready.

---

## Phase 3: User Story 1 — 教師勾選多題同時開放搶答 (P1) 🎯 MVP

**Goal**: Several questions can be opened at once (all-or-nothing), more can be added while others are open, one or all can be closed.

**Independent Test**: `tests/integration/multi-round.test.ts` + `tests/contract/rounds.test.ts`.

### Tests for User Story 1

- [X] T007 [P] [US1] Integration tests in `tests/integration/multi-round.test.ts` (unique ids): open Q1+Q2 in one call; open Q3 while Q1/Q2 open; all-or-nothing for already-open / completed / unconfirmed / unknown / duplicated question (nothing written, error names the question); close Q1 leaves Q2/Q3 open; close-all closes every open round in one call with one `results.finalized` per round; close-all with nothing open → 409; activity `completed` only after the last question closes; leftover `currentRoundId` removed; events have contiguous `stateVersion`
- [X] T008 [P] [US1] Migrate `tests/integration/round-atomicity.test.ts` to unique activity ids and the new store API (`openRounds`)
- [X] T009 [P] [US1] Contract tests in `tests/contract/rounds.test.ts`: array body → `{ rounds }`; legacy body → legacy single-round response; invalid bodies → 422; students cannot open / close / close-all; close-all uses the teacher identity

### Implementation for User Story 1

- [X] T010 [US1] Replace `open-round.lua` with `src/server/redis/scripts/open-rounds.lua` (validate all, then open all; one `phase.changed` per round; maintain `openRoundIdsByQuestion` / `roundIdsByQuestion`; drop `currentRoundId`)
- [X] T011 [US1] Replace `close-round.lua` with `src/server/redis/scripts/close-rounds.lua` (strict / open-only modes; one `results.finalized` per round; remove from open map, delete the map when empty; completion rule)
- [X] T012 [US1] Update `src/server/redis/round-store.ts`: `openRounds`, `closeRounds`, `closeRound`, `closeAllOpenRounds`, error messages naming the question
- [X] T013 [US1] Update `src/features/activities/application/round-service.ts`, `src/app/api/activities/[activityId]/rounds/open/route.ts` (array + legacy response) and add `src/app/api/activities/[activityId]/rounds/close-all/route.ts`

**Checkpoint**: T007–T009 pass.

---

## Phase 4: User Story 2 — 學生同時作答多個開放中的題目 (P1)

**Goal**: Submissions are accepted for any open round with independent ordering; students see every open question and the results of closed ones.

**Independent Test**: `tests/integration/multi-round.test.ts` (submission cases) + `tests/integration/activity-events.test.ts`.

### Tests for User Story 2

- [X] T014 [P] [US2] Add to `tests/integration/multi-round.test.ts`: two groups answering two open rounds get independent orders/winners; after Q1 closes, a Q1 submission is rejected while a Q2 submission is accepted
- [X] T015 [P] [US2] Update `tests/integration/activity-events.test.ts`: snapshot `rounds[]` with one open and one closed round — student sees only own answer in the open round and all answers in the closed round; teacher sees all
- [X] T016 [P] [US2] Update the snapshot mock shape in `tests/contract/activity-events-replay.test.ts`

### Implementation for User Story 2

- [X] T017 [US2] `src/server/redis/scripts/submit-answer.lua`: accept the round only when `openRoundIdsByQuestion[round.questionNumber] == roundId`
- [X] T018 [US2] `src/features/activities/application/activity-snapshot.ts`: load every round of the activity into `rounds[]` (per-round visibility, teacher writeback job, `openedAt`/`closedAt`)
- [X] T019 [US2] Student UI: `src/components/student/student-api.ts` (events URL + submit in one place), rewrite `src/components/student/activity-round.tsx` (stacked open-question cards, per-round drafts/busy/errors, closed results), per-round field ids in `src/components/student/answer-form.tsx`
- [X] T020 [US2] Student card styles in `src/app/globals.css`

**Checkpoint**: T014–T016 pass.

---

## Phase 5: User Story 3 — 清楚易讀的教師題目控制介面 (P2)

**Goal**: Card list with checkboxes, sticky toolbar, wrapped prompts, live ranking, status badges, writeback with retry.

**Independent Test**: `questionStatus` unit tests (T002), writeback retry integration test (T021), e2e (T027).

### Tests for User Story 3

- [X] T021 [P] [US3] Add to `tests/integration/writeback-queue.test.ts`: a `failed` job is re-queued with the same id (`status=queued`, `attempt=0`, no error code, new stream entry); `queued` / `succeeded` jobs stay idempotent

### Implementation for User Story 3

- [X] T022 [US3] `src/server/redis/scripts/enqueue-writeback.lua`: re-queue when the existing job failed
- [X] T023 [US3] `src/features/activities/application/teacher-activity.ts`: return `rounds[]` (merge `currentRound` / `completedRounds`)
- [X] T024 [US3] Rewrite `src/components/teacher/round-control.tsx` as the question board (toolbar, selectable cards, live ranking, close one / all, writeback + retry, elapsed timer, no `<select>`)
- [X] T025 [US3] Board, card and badge styles in `src/app/globals.css` (wrapping prompts, sticky toolbar, 360px layout); remove styles only used by the old dropdown panel
- [X] T026 [US3] Teacher page copy in `src/app/(teacher)/teacher/activities/[activityId]/page.tsx`

**Checkpoint**: T021 passes; teacher board renders every status.

---

## Phase 6: Polish & Cross-Cutting

- [X] T027 [P] Update `tests/e2e/sheets-writeback.spec.ts` for the card UI (checkbox + 開放所選題目) and add a multi-question flow (open Q1+Q2, groups answer different questions, close all). Not executable locally (no Playwright browsers)
- [X] T028 [P] Remove the obsolete `currentRoundId` seed field from `tests/load/activity-sse.test.ts`
- [X] T029 Run `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:contract`, `pnpm test:security`, `pnpm test:integration`, `pnpm exec vitest run tests/architecture`
- [X] T030 Verify the implementation against `diagrams/004-*.puml`, `class.puml`, `sequence.puml` and record the result in `quickstart.md`
- [X] T031 [US2] Integration review fix for FR-009: the student submission response leaked `winnerGroupId` while the round was open. Regression test `does not reveal the current winner…` in `tests/security/server-boundary.test.ts` (failed before the fix); the fix is an explicit receipt allow-list in `src/app/api/activities/[activityId]/rounds/[roundId]/submissions/route.ts`

---

## Dependencies & Execution Order

- Phase 2 blocks everything (types, reducer, schema).
- US1 (Phase 3) before US2 (Phase 4): submissions and snapshots depend on the open map written by `open-rounds.lua`.
- US3 (Phase 5) depends on US1 + US2 (board uses the new routes and `rounds[]`).
- Polish last.

### Parallel Opportunities

- T002/T003; T007/T008/T009; T014/T015/T016; T021 with T023; T027/T028.

## Implementation Strategy

MVP = Phases 1–3 (multi-open/close via API). Then US2 makes it usable by students, US3 delivers the requested UI. Each phase ends with its tests green before the next starts.

## Analysis (`/speckit-analyze`, 2026-11-25)

| Requirement | Covered by tasks |
|---|---|
| FR-001 multi-select + open at once | T006, T007, T010, T013, T024 |
| FR-002 all-or-nothing | T007, T010 |
| FR-003 open more while others are open | T007, T010 |
| FR-004 independent order / winner | T014, T017 (per-round keys unchanged) |
| FR-005 one submission per group per question | T008 (existing atomicity tests) |
| FR-006 close one / close all atomically | T007, T011, T012, T013 |
| FR-007 closed question rejects, others accept | T014, T017 |
| FR-008 student stacked open questions | T019, T020, T027 |
| FR-009 per-round privacy | T015, T018, T031 |
| FR-010 card list, wrapping, 360px | T024, T025, quickstart D-1 |
| FR-011 card status | T002, T005, T024 |
| FR-012 live ranking + 結束本題 | T024, T027 |
| FR-013 closed card + writeback retry | T021, T022, T024 |
| FR-014 sticky toolbar | T025, quickstart D-2 |
| FR-015 restore after reload | T015, T018, T019, T024 |
| FR-016 completion rule | T007, T011 |

- Every FR and SC maps to at least one task; no task lacks a requirement.
- Terminology aligned across spec / data-model / contracts / diagrams: 「開放中題目集合」= `openRoundIdsByQuestion`; 「一次結束全部」= `close-all` / `close-rounds.lua` open-only mode.
- Constitution: no violations (see plan.md). No CRITICAL or HIGH findings.
