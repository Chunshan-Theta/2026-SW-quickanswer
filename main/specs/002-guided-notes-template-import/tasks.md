# Tasks: 官方 Guided Notes 範本匯入與逐題回填

**Input**: Design documents from `specs/002-guided-notes-template-import/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/http-api.md`, `quickstart.md`, `diagrams/002-*.puml`

**Tests**: Included — Constitution III requires a regression test for every defect found in manual verification and tests for all new behavior.

**Organization**: Grouped by user story; US1 and US2 are P1, US3 and US4 are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependency on an incomplete task.
- **[Story]**: Maps to user stories in `spec.md`.

## Phase 1: Setup

- [X] T001 Fix the writeback worker start command so it loads `.env.local` and resolves `server-only` outside Next.js in `package.json` (`tsx --conditions=react-server --env-file-if-exists=.env.local`).
- [X] T002 [P] Stop tracking generated files: add `__pycache__/`, `*.pyc`, `tsconfig.tsbuildinfo` and `AGENTS.md` to the repository `.gitignore` and remove the tracked copies from the index.

---

## Phase 2: Foundational (blocking all stories)

**Purpose**: New parser/question model shared by every story (see `diagrams/002-class.puml`).

- [X] T003 Extend parser types in `src/features/sheets/domain/worksheet-parser.ts`: `MergeRange`, `WorksheetGrid.merges`, `WorksheetLayout`, `ParsedBlank`, `ParsedQuestion.kind/blanks/firstRow/lastRow`, `WorksheetIssue.rowNumber`, new issue codes, and `WorksheetParseResult.layout/structure`; keep `answerSlot`/`candidateSlots` as first-blank compatibility fields.
- [X] T004 Refactor the existing marker-format parsing in `src/features/sheets/domain/worksheet-parser.ts` into a `parseMarkerLayout` helper that returns single-blank questions, a marker `structure` (question number → prompt cell) and a guaranteed `no_questions_found` issue when nothing is recognised.
- [X] T005 Replace the whole-grid hash with `structureFingerprint(parsed)` in `src/features/sheets/application/worksheet-fingerprint.ts` (hash of `parsed.structure` only).
- [X] T006 Read `sheets[].merges` into `WorksheetGrid.merges` and change the missing-tab message in `src/features/sheets/google-sheets.adapter.ts`.
- [X] T007 Update `ImportedActivity`/`ImportedQuestion`/`ImportedBlank` (blanks, kind, layout, structureFingerprint, roundIdsByQuestion) and `publicActivity` in `src/features/sheets/application/import-guided-notes.ts`; `confirmMappings` resolves single-blank questions and compares structure fingerprints.

**Checkpoint**: Existing marker-format unit tests pass on the new model.

---

## Phase 3: User Story 1 — 直接匯入官方表格格式學習單 (P1) 🎯 MVP

**Goal**: The official single-question template imports without markers and without typing a gid.

**Independent Test**: Import an unmodified copy of the single template (and a copy with inserted rows/columns); 6 questions, all confirmed.

### Tests for User Story 1

- [X] T008 [P] [US1] Add parser tests for the official single template grid (header row, merged prompt/answer cells, blank answer cells, spacer rows), inserted rows/columns, header synonyms `答案`, number formats, and layout precedence over markers in `tests/unit/sheets/worksheet-parser.test.ts`.
- [X] T009 [P] [US1] Add adapter tests for merge mapping and `listSheetTabs` in `tests/integration/sheets-read.test.ts`, and a contract test for `GET /api/sheets/{spreadsheetId}/tabs` (teacher only, 200 tab list, Google 403 mapping) in `tests/contract/sheet-tabs.test.ts`.

### Implementation for User Story 1

- [X] T010 [US1] Implement table-layout detection, merge resolution and single-question row parsing (`parseTableLayout`) and layout selection in `src/features/sheets/domain/worksheet-parser.ts`.
- [X] T011 [US1] Add `listSheetTabs(teacherId, spreadsheetId)` to `src/features/sheets/google-sheets.adapter.ts` (properties-only request).
- [X] T012 [US1] Create the teacher-only route `src/app/api/sheets/[spreadsheetId]/tabs/route.ts`.
- [X] T013 [US1] Replace the gid input with a tab selector (auto-select a single tab, select by title) in `src/components/teacher/guided-notes-import.tsx`.

**Checkpoint**: US1 independently demonstrable with the official single template.

---

## Phase 4: User Story 2 — 活動中每一題都能回填 (P1)

**Goal**: Every closed question with a winner can be written back, in any order; structure changes fail closed.

**Independent Test**: Close three questions, write back all three in any order; all succeed; deleting a question row makes its writeback fail without writing.

### Tests for User Story 2

- [X] T014 [P] [US2] Rewrite `tests/unit/sheets/writeback-guided-notes.test.ts`: second writeback succeeds after the first changed the sheet, unrelated edits are tolerated, structure change → 409 with no write, idempotent replay skips the write, post-write verification of target cells.
- [X] T015 [P] [US2] Add a parser test proving `structureFingerprint` is unchanged after answer cells are filled (table and marker layouts) in `tests/unit/sheets/worksheet-parser.test.ts`.

### Implementation for User Story 2

- [X] T016 [US2] Rewrite `prepareGuidedNotesWriteback`/`applyGuidedNotesWriteback` in `src/features/sheets/application/writeback-guided-notes.ts` to take `answers[]`, compare structure fingerprints, build per-blank targets (`label + answer`), detect already-written targets, write once and verify target cells.
- [X] T017 [US2] Update the worker in `src/server/workers/sheets-writeback.ts` and job types in `src/server/redis/writeback-queue.ts` to use `answers` (fallback `[answer]`) and drop `expectedPostFingerprint`; update `tests/integration/writeback-worker.test.ts`.
- [X] T018 [US2] Record `roundIdsByQuestion` in `src/server/redis/scripts/open-round.lua`, and return `completedRounds` (winner, submissions, writeback job) from `src/features/activities/application/teacher-activity.ts`.
- [X] T019 [US2] Show a "已結束題目" list with per-round writeback buttons and live `writeback.status` updates in `src/components/teacher/round-control.tsx`.

**Checkpoint**: US1 + US2 cover all core requirements of the course PDF with the official template.

---

## Phase 5: User Story 3 — 看得懂的匯入錯誤 (P2)

**Goal**: Every failed import shows at least one concrete issue with question number or row number.

**Independent Test**: Duplicate number, missing number, blank tab and missing answer column each produce specific messages.

- [X] T020 [P] [US3] Add contract tests asserting 422 `details` is non-empty and carries `rowNumber` for table issues in `tests/contract/sheets-import.test.ts`.
- [X] T021 [US3] Emit row-numbered messages for every table-layout issue (`unrecognized_question_row`, `duplicate_question_number`, `missing_question_number`, `missing_answer_slot`, `header_missing_answer_column`, `no_questions_found`) in `src/features/sheets/domain/worksheet-parser.ts` and pass all blocking issues through `src/features/sheets/application/import-guided-notes.ts`.
- [X] T022 [US3] Render the issue list under the import error in `src/components/teacher/guided-notes-import.tsx`.

---

## Phase 6: User Story 4 — 題組搶答 (P2)

**Goal**: Group questions import, run as one round with all sub-answers submitted together, and write back every blank with its label.

**Independent Test**: Official group template → 4 questions; incomplete group submission rejected without consuming order; winner's sub-answers written to each blank with `（n）` kept.

### Tests for User Story 4

- [X] T023 [P] [US4] Add parser tests for the official group template (vertical merged numbers, `（n）` labels), unmerged continuation rows, and non-adjacent duplicates in `tests/unit/sheets/worksheet-parser.test.ts`.
- [X] T024 [P] [US4] Add Redis integration tests for group rounds (blanks stored on open, incomplete answers rejected without consuming `acceptedOrder`, display text, legacy single `answer`) in `tests/integration/round-atomicity.test.ts`.
- [X] T025 [P] [US4] Add submission schema/contract tests for `answers[]` and legacy `answer` in `tests/contract/rounds.test.ts`.

### Implementation for User Story 4

- [X] T026 [US4] Implement group row grouping, blank labels and group prompts in `parseTableLayout` in `src/features/sheets/domain/worksheet-parser.ts`.
- [X] T027 [US4] Store `kind`, `blankCount`, `blanks` on the round and in `phase.changed` in `src/server/redis/scripts/open-round.lua`; validate and store `answers` + display `answer` in `src/server/redis/scripts/submit-answer.lua`; copy `answers` into the job in `src/server/redis/scripts/enqueue-writeback.lua`.
- [X] T028 [US4] Accept `answers[]` (and legacy `answer`) in `src/lib/validation/schemas.ts`, `src/app/api/activities/[activityId]/rounds/[roundId]/submissions/route.ts`, `src/features/activities/application/round-service.ts` and `src/server/redis/round-store.ts` (map `INCOMPLETE_ANSWERS` to 422).
- [X] T029 [US4] Carry `kind`/`blanks`/`answers` through `src/features/activities/domain/snapshot.ts`, `src/features/activities/application/activity-snapshot.ts`, `src/features/activities/application/results-service.ts` and `src/server/events/activity-event-projection.ts`.
- [X] T030 [US4] Render one input per blank with sub-prompts and labels, and per-blank answers in results, in `src/components/student/answer-form.tsx` and `src/components/student/activity-round.tsx`; show group sub-prompts in the import preview (`src/components/teacher/guided-notes-import.tsx`) and per-blank answers in `src/components/teacher/round-control.tsx`.

**Checkpoint**: Official group template completes import → round → writeback.

---

## Phase 7: Polish & Cross-Cutting

- [X] T031 Update `tests/e2e/sheets-writeback.spec.ts` doubles for the tab-list route and tab selector; keep existing flows passing.
- [X] T032 Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration`, `pnpm test:security`; fix failures without weakening tests.
- [X] T033 Verify code against `diagrams/002-component.puml`, `diagrams/002-class.puml`, `diagrams/002-sequence.puml` and the updated system diagrams; record the result in `specs/002-guided-notes-template-import/quickstart.md` (Constitution VI).
- [X] T034 Run quickstart scenarios A–D manually against real Google Sheets copies of both official templates and record findings in `specs/002-guided-notes-template-import/quickstart.md`.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T007)** → user stories.
- **US1 (T008–T013)** depends on Foundational.
- **US2 (T014–T019)** depends on Foundational; T016 needs `structureFingerprint` (T005) and blanks (T007); T019 needs T018.
- **US3 (T020–T022)** depends on T010 (table issues).
- **US4 (T023–T030)** depends on T010 (table parser) and T016 (multi-blank writeback); T029–T030 depend on T027–T028.
- **Polish (T031–T034)** after all stories.

### Parallel Opportunities

- T001 ∥ T002.
- Test tasks marked [P] within a story (T008 ∥ T009; T014 ∥ T015; T023 ∥ T024 ∥ T025).
- After Foundational, US1 UI work (T011–T013) can proceed in parallel with US2 writeback work (T016–T017) — different files.

## Implementation Strategy

1. **MVP**: Setup + Foundational + US1 → the official single template imports (unblocks manual verification and the demo).
2. Add US2 → every question can be written back (completes core requirements).
3. Add US3 → actionable import errors.
4. Add US4 → question groups (extra feature).
5. Polish: full test suite, diagram verification, manual quickstart.
