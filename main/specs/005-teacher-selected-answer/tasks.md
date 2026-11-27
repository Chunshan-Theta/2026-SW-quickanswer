# Tasks: 教師選擇回填答案與學生端正確答案公布

**Input**: Design documents from `specs/005-teacher-selected-answer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md

**Tests**: 憲章 III 要求行為以測試定義；每個實作任務前先寫會失敗的測試。

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Record user decisions in `spec.md` Clarifications and create `diagrams/005-component|class|sequence.puml` + PNG
- [X] T002 [P] Make `tests/integration/writeback-queue.test.ts` use unique ids and stop deleting the shared `writeback:jobs` stream (protects the other branch and the user's worker)

## Phase 2: Foundational (blocking)

- [X] T003 [P] Unit tests for `src/features/activities/domain/answer-adoption.ts` (`defaultAdoption`, `sameAdoption`, `describeAdoption`, `adoptionIsComplete`) in `tests/unit/activities/answer-adoption.test.ts`
- [X] T004 [P] Schema tests for `writebackRequestSchema.selection` (group / teacher / legacy / invalid) in `tests/unit/validation/schemas.test.ts`
- [X] T005 Implement `answer-adoption.ts`, add `PublishedAnswerSnapshot` / `AdoptedAnswerSnapshot` to `domain/snapshot.ts`, extend `writebackRequestSchema`

## Phase 3: User Story 1 — 教師選擇要回填的答案 (P1)

### Tests

- [X] T006 [US1] Redis integration tests in `tests/integration/answer-adoption.test.ts`: group selection writes that group's answers; default = fastest; unknown group rejected; pending + different selection rejected; pending/succeeded + same selection idempotent; succeeded + different selection re-queued (revision 2, `previousAnswers` = published); failed re-queued
- [X] T007 [P] [US1] Contract tests in `tests/contract/writeback.test.ts`: selection bodies passed through, invalid selection → 422, students → 403
- [X] T008 [P] [US1] Writeback unit test in `tests/unit/sheets/writeback-guided-notes.test.ts`: marker cell holding the previously published answer is overwritten on re-selection; any other content still fails closed
- [X] T009 [P] [US1] Worker test in `tests/integration/writeback-worker.test.ts`: job `previousAnswers` passed to `prepareGuidedNotesWriteback`

### Implementation

- [X] T010 [US1] Rewrite `src/server/redis/scripts/enqueue-writeback.lua` (selection, selectionKey, idempotency rules R3, revision, previousAnswers, queued event with `adopted`)
- [X] T011 [US1] Update `src/server/redis/writeback-queue.ts` (`enqueueWriteback(…, selection?)`, error messages, `getWritebackStatus` with `revision`/`adopted`) and the writeback route
- [X] T012 [US1] `prepareGuidedNotesWriteback(…, previousAnswers?)` and worker passes `jobPreviousAnswers(job)`
- [X] T013 [US1] Teacher UI: `src/components/teacher/answer-adoption.tsx` + closed card in `round-control.tsx`; `round-state.ts` `applyWritebackStatus` keeps `adopted` / `published`; CSS

## Phase 4: User Story 2 — 學生看到自己的答案與老師採用的答案 (P1)

### Tests

- [X] T014 [US2] Integration test (same file as T006): worker success publishes `published*` on the round and the `writeback.status` event carries `published`; failure does not change the published answer
- [X] T015 [P] [US2] Projection tests in `tests/unit/events/activity-event-projection.test.ts`: student `results.finalized` keeps only own submission and `winnerGroupId: null`; succeeded `writeback.status` → `answer.published`; other statuses → null; teacher unchanged
- [X] T016 [P] [US2] Privacy tests in `tests/security/answer-privacy.test.ts` (snapshot via real Redis) and `tests/contract/results-access.test.ts`: closed round for a student contains only own submission, no winner, `publishedAnswer` only after success
- [X] T017 [P] [US2] Reducer tests in `tests/unit/activities/round-state.test.ts`: `applyPublishedAnswer`, `applyWritebackStatus` with `published`

### Implementation

- [X] T018 [US2] `update-writeback-status.lua` publishes on success (KEYS[4] round); `updateWritebackStatus` passes the round key
- [X] T019 [US2] `activity-event-projection.ts`, `activity-snapshot.ts`, `results-service.ts` apply the student rule and expose `publishedAnswer`
- [X] T020 [US2] Student UI: closed question card shows 你們的答案 / 正確答案（老師採用｜老師提供）/ 等待老師公布正確答案; `answer.published` listener; CSS

## Phase 5: User Story 3 — 教師自行輸入正確答案 (P2)

- [X] T021 [US3] Integration tests (same file as T006): teacher answers written with display text; wrong count / blank → rejected; works when nobody answered
- [X] T022 [US3] Lua + UI support for `source: "teacher"` (inputs per blank, button disabled until complete)

## Phase 6: Polish & Cross-Cutting

- [X] T023 [P] Update `tests/e2e/sheets-writeback.spec.ts` for choosing a non-fastest answer and the student view (not runnable locally: Playwright browsers not installed)
- [X] T024 Run `pnpm typecheck`, `pnpm lint`, full Vitest suites
- [X] T025 Verify code ↔ `diagrams/005-*.puml` alignment and record it in `quickstart.md`

## Dependencies & Execution Order

- T001–T002 → T003–T005 → US1 (T006–T013) → US2 (T014–T020) → US3 (T021–T022) → T023–T025.
- Within each story, test tasks precede implementation and must fail first.
- US3 shares the Lua script with US1; its tests are added after US1's implementation and extend it.

## Parallel Opportunities

- T003/T004; T007/T008/T009; T015/T016/T017.

## Implementation Strategy

MVP = US1 + US2 (choose and publish). US3 adds the typed answer on the same pipeline.

## Analysis (`/speckit-analyze`, 2026-11-25)

| Requirement | Covered by tasks |
|---|---|
| FR-001 ranked list + default selection | T003, T013 |
| FR-002 typed answer, blanks required | T003, T021, T022 |
| FR-003 write the chosen answer only | T006, T010, T012 |
| FR-004 re-select + idempotent same selection | T006, T010 |
| FR-005 pending: different rejected, same = same job | T006, T010 |
| FR-006 retry after failure | T006, T010 |
| FR-007 invalid group / answers rejected | T004, T006, T007, T021 |
| FR-008 typed answer when nobody answered | T021, T022 |
| FR-009 student privacy (SSE / snapshot / results) | T015, T016, T019 |
| FR-010 published answer after success | T014, T018, T020 |
| FR-011 latest success wins; pending/failed keep last | T014, T017, T018 |
| FR-012 teacher status + adopted source | T003, T013 |
| FR-013 legacy body = fastest group | T006, T007, T010 |
| FR-014 accessible, wrapping UI | T013, T022, quickstart A/D |
| SC-002 0 leaks | T015, T016 |
| SC-005 0 extra writes | T006 |

- Every FR and SC maps to at least one task; every task maps to a requirement or a constitution item (T002 test isolation, T025 diagrams).
- Edge case "marker layout re-writeback" was missing from the first task draft → covered by T008/T012 (research R6).
- Terminology aligned: 「採用答案」= `adopted*` on the job (pending or done); 「公布答案」= `published*` on the round (after success only).
- Behaviour change for students (no other groups' answers after close) is flagged in `contracts/http-api.md` for the OpenSpec subgroup.
- Constitution: no violations; shared diagrams deferred to integration with 006 (plan.md).
