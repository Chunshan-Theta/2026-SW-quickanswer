# Tasks: 線上課堂搶答系統

**Input**: Design documents from `specs/001-live-classroom-quiz/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/http-api.md`, `quickstart.md`

**Tests**: Included before implementation tasks because the project constitution requires automated tests for new behavior and critical workflows.

**Organization**: Tasks are grouped by user story so each story can be independently implemented and validated after shared foundations are complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Tasks use separate files and have no dependency on another incomplete task.
- **[Story]**: User-story label maps implementation tasks to `spec.md`.
- All tasks include concrete repository paths.

## Phase 1: Setup

**Purpose**: Initialize the single Next.js application and development tooling.

- [X] T001 Create the Next.js App Router project files in `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, and `src/app/layout.tsx` using TypeScript and Node.js 22.
- [X] T002 Add local Redis and non-secret environment examples in `docker-compose.yml` and `.env.example`; bind Redis only to the development/private network and document that browser code must never receive `REDIS_URL`.
- [X] T003 [P] Configure ESLint and formatting rules in `eslint.config.mjs` and `.prettierrc.json`.
- [X] T004 [P] Configure Vitest, Playwright, and shared test setup in `vitest.config.ts`, `playwright.config.ts`, and `tests/setup.ts`.

---

## Phase 2: Foundational

**Purpose**: Establish shared domain types, server-only infrastructure, authorization, and error handling before story work begins.

- [X] T005 Define Activity phase (`draft`, `mapping_review`, `ready`, `active`, `completed`), Round phase (`ready`, `open`, `closed`), mapping status, role, and shared entity schemas in `src/features/activities/domain/types.ts` and `src/lib/validation/schemas.ts`.
- [X] T006 [P] Implement server-only Redis connection, TLS/ACL configuration, keyspace helpers, and health check in `src/server/redis/client.ts`, `src/server/redis/keyspace.ts`, and `src/app/api/health/route.ts`; do not export Redis clients to browser modules.
- [X] T007 [P] Implement request IDs, typed API errors, safe JSON responses, and server-side logging in `src/server/http/request-context.ts`, `src/server/http/errors.ts`, and `src/lib/errors/error-codes.ts`.
- [X] T008 Implement signed HttpOnly session parsing and teacher/student/group authorization guards in `src/server/auth/session.ts` and `src/server/auth/guards.ts`; derive role and group from the session, never from a submitted group ID.
- [X] T009 Add an architecture test that fails if client components import Redis, Google OAuth credentials, or server-only adapters in `tests/architecture/server-boundary.test.ts`.

**Checkpoint**: Shared contracts and private server boundary are ready; User Stories 1 and 2 can proceed independently.

---

## Phase 3: User Story 1 - 匯入並確認 Guided Notes (Priority: P1)

**Goal**: A teacher can import one Google Sheets Guided Notes worksheet, validate question count/numbering, resolve ambiguous answer slots, and prepare a ready activity without fixed cell coordinates.

**Independent Test**: Import a fixture with uniquely numbered questions and answer blanks; move rows/columns and re-import; confirm the same questions are resolved dynamically. Ambiguous mappings remain blocked until the teacher confirms a valid candidate.

### Tests for User Story 1

- [ ] T010 [P] [US1] Add parser tests for unique/duplicate/missing question numbers, question-count mismatch, dynamic answer-slot discovery, and ambiguous candidates in `tests/unit/sheets/worksheet-parser.test.ts`.
- [ ] T011 [P] [US1] Add import and mapping-confirmation contract tests for `201 ready`, `201 mapping_review`, `422` invalid structure, stale slot-token `409`, and repeated-slot `409` in `tests/contract/sheets-import.test.ts`.

### Implementation for User Story 1

- [ ] T012 [P] [US1] Implement worksheet parsing from scanned grid content in `src/features/sheets/domain/worksheet-parser.ts`; preserve question numbers, require unique numbers, ensure the parsed question count matches the source worksheet, and return candidate slot tokens without embedding A1 coordinates as constants.
- [ ] T013 [P] [US1] Implement teacher Google OAuth start/callback, state validation, `drive.file` authorization, and encrypted server-side token storage in `src/app/api/auth/google/start/route.ts`, `src/app/api/auth/google/callback/route.ts`, and `src/server/auth/google-token-store.ts`; never return refresh tokens to the browser.
- [ ] T014 [US1] Implement the server-only Google Sheets adapter in `src/features/sheets/google-sheets.adapter.ts` to scan worksheet grid data, retrieve current question/blank markers, and dynamically derive candidate answer targets; prohibit fixed A1 cell coordinates.
- [ ] T015 [US1] Implement the import use case in `src/features/sheets/application/import-guided-notes.ts` to create `ready` or `mapping_review` activities, reject duplicate/missing question numbers or mismatched question counts, and bind opaque candidate tokens to the current scan.
- [ ] T016 [US1] Implement the import and teacher mapping-confirmation Route Handlers in `src/app/api/activities/import/route.ts` and `src/app/api/activities/[activityId]/mappings/confirm/route.ts`; confirmation MUST reject expired tokens and duplicate use of one answer slot.
- [ ] T017 [US1] Build the teacher worksheet-selection, import-preview, ambiguity-resolution, and ready-state screens in `src/app/(teacher)/teacher/import/page.tsx` and `src/components/teacher/guided-notes-import.tsx`.
- [ ] T018 [US1] Add Google Sheets adapter integration tests for permission denial, moved question/answer cells, changed scan fingerprints, RAW value handling, and preservation of non-target cells in `tests/integration/sheets-import.test.ts`.

**Checkpoint**: US1 is independently testable with a Google Sheets test worksheet; no activity can become ready until every question has a confirmed unique mapping.

---

## Phase 4: User Story 2 - 進行同步小組搶答 (Priority: P1)

**Goal**: The teacher opens/closes one question at a time; each group submits at most one answer; Redis chooses one winner by first accepted order; all clients receive phase updates while student data remains private.

**Independent Test**: Join a teacher and two group sessions, open a round, submit concurrently, and close it. Verify a unique accepted order/winner, teacher live status, student-only own receipt before close, and final results only after close.

### Tests for User Story 2

- [ ] T019 [P] [US2] Add Redis integration tests for simultaneous first submissions, duplicate group submission, submission-versus-close ordering, no-submission close, unique `acceptedOrder`, and exactly one winner in `tests/integration/round-atomicity.test.ts`.
- [ ] T020 [P] [US2] Add API/SSE contract tests for teacher controls, session-derived group identity, open-round student privacy, and closed-round result visibility in `tests/contract/rounds-and-events.test.ts`.

### Implementation for User Story 2

- [ ] T021 [P] [US2] Implement activity join-code validation and group-bound student session creation in `src/features/activities/application/join-activity.ts` and `src/app/api/activities/[activityId]/join/route.ts`; one student session MUST bind to exactly one activity group.
- [ ] T022 [P] [US2] Implement Redis Lua open/submit/close scripts in `src/server/redis/scripts/open-round.lua`, `src/server/redis/scripts/submit-answer.lua`, and `src/server/redis/scripts/close-round.lua`; submission MUST reject empty trimmed answers, allocate a unique positive `acceptedOrder`, accept at most one submission per group/round, set the first winner once, and atomically append an Activity-wide versioned event.
- [ ] T023 [US2] Implement the round repository and application services in `src/server/redis/round-store.ts` and `src/features/activities/application/round-service.ts`; order and close operations using the atomic scripts, not client timestamps.
- [ ] T024 [US2] Implement the teacher open/close and student submission Route Handlers in `src/app/api/activities/[activityId]/rounds/[roundId]/open/route.ts`, `src/app/api/activities/[activityId]/rounds/[roundId]/close/route.ts`, and `src/app/api/activities/[activityId]/rounds/[roundId]/submissions/route.ts`; reject writes outside the `open` phase.
- [ ] T025 [US2] Implement an independent per-Next.js-instance Redis Stream reader and event fanout in `src/server/events/activity-event-reader.ts`; use each Activity's `stateVersion`, detect trimmed/missing versions, and recover from a current snapshot instead of relying on Pub/Sub delivery.
- [ ] T026 [US2] Implement the authenticated SSE endpoint in `src/app/api/activities/[activityId]/events/route.ts`; send role/group-projected events and snapshots, replay newer `Last-Event-ID` events, and never serialize unfiltered submissions to a student.
- [ ] T027 [US2] Build teacher question selection, open/close controls, and live group status/order display in `src/app/(teacher)/teacher/activities/[activityId]/page.tsx` and `src/components/teacher/round-control.tsx`.
- [ ] T028 [US2] Build the group join and answer submission screens in `src/app/(student)/join/[code]/page.tsx` and `src/components/student/answer-form.tsx`; show only activity phase and the authenticated group's own answer/receipt before close.
- [ ] T029 [US2] Add browser integration tests for SSE reconnect snapshots, event-version gaps, role-filtered replay, and visibility of all final results only after close in `tests/integration/activity-events.test.ts`.

**Checkpoint**: US2 is independently testable with seeded activities and groups; Redis remains inaccessible to browsers and close/submit races resolve to one deterministic accepted order.

---

## Phase 5: User Story 3 - 查看結果並回填原工作表 (Priority: P2)

**Goal**: Teachers can inspect live/final results and enqueue a durable, idempotent writeback of the winning answer; students see the final group results only after close.

**Independent Test**: Close a seeded round with multiple submissions, verify teacher/student result authorization, enqueue writeback, move or change a target before worker execution, and verify either the dynamically confirmed target is updated or the job fails closed.

### Tests for User Story 3

- [ ] T030 [P] [US3] Add results authorization tests for live teacher access, own-group-only open-round student access, and all-group post-close access in `tests/contract/results-access.test.ts`.
- [ ] T031 [P] [US3] Add Redis Stream worker tests for idempotent enqueue, transient retry, crash-before-ack recovery with `XAUTOCLAIM`, and no duplicate writes in `tests/integration/writeback-worker.test.ts`.

### Implementation for User Story 3

- [ ] T032 [P] [US3] Implement role-filtered results queries and `GET /api/activities/[activityId]/rounds/[roundId]/results` in `src/features/activities/application/results-service.ts` and `src/app/api/activities/[activityId]/rounds/[roundId]/results/route.ts`; expose live order only to teachers and all group results to students only after close.
- [ ] T033 [P] [US3] Implement an idempotent Redis Stream writeback queue in `src/server/redis/writeback-queue.ts`; use `activityId:roundId` as the idempotency key and acknowledge only verified successful jobs.
- [ ] T034 [US3] Implement teacher-triggered `POST /api/activities/[activityId]/rounds/[roundId]/writeback` in `src/app/api/activities/[activityId]/rounds/[roundId]/writeback/route.ts`; require a closed round and return `202 queued` without waiting for Google Sheets.
- [ ] T035 [US3] Implement the writeback worker in `src/server/workers/sheets-writeback.ts`; reclaim idle pending jobs with `XAUTOCLAIM`, apply bounded retries/backoff, and publish teacher-only job status events.
- [ ] T036 [US3] Implement writeback-time sheet rescan and fingerprint verification in `src/features/sheets/application/writeback-guided-notes.ts` and `src/features/sheets/google-sheets.adapter.ts`; derive target coordinates only from the latest validated scan, write winner answers as RAW values, preserve non-target cells, and fail closed on stale/ambiguous mappings or revoked permission.
- [ ] T037 [US3] Build teacher live/final results, student final results, and writeback job status UI in `src/components/teacher/round-results.tsx`, `src/components/teacher/writeback-status.tsx`, and `src/components/student/final-results.tsx`.
- [ ] T038 [US3] Add Google Sheets writeback end-to-end tests for moved cells, stale scan fingerprints, revoked permissions, preserved non-target content, and documented no-external-edit assumption during the final scan/update interval in `tests/e2e/sheets-writeback.spec.ts`.

**Checkpoint**: US3 is testable with a closed round and test worksheet; the teacher receives a durable job status and stale mappings never trigger a success response.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate target scale, security boundaries, documentation, and all user-story acceptance criteria.

- [ ] T039 [P] Add a 500-client SSE load test for phase fanout latency, connection cleanup, and reconnect behavior in `tests/load/activity-sse.test.ts`; verify at least 95% of connected clients observe phase changes within 2 seconds.
- [ ] T040 [P] Add security regression tests for no browser Redis access, no OAuth-token exposure, server-derived role/group, and formula-safe RAW answers in `tests/security/server-boundary.test.ts`.
- [ ] T041 Document local Next.js/Redis setup, Google OAuth prerequisites, private Redis requirements, and API links in `.env.example` and `specs/001-live-classroom-quiz/quickstart.md`.
- [ ] T042 Run `pnpm test:unit`, `pnpm test:contract`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:load`, `pnpm lint`, and `pnpm typecheck`; fix failures and record any external Google API sandbox limitations in `specs/001-live-classroom-quiz/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; initialize the project and tooling first.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user-story implementation.
- **US1 and US2 (Phases 3 and 4)**: Both depend on Foundations and can proceed in parallel. US2 may use seeded Activity/Question fixtures while US1's Google Sheets import is developed.
- **US3 (Phase 5)**: Depends on US1's confirmed SheetBinding and US2's closed-round result model.
- **Polish (Phase 6)**: Depends on the stories selected for release; load and end-to-end gates require US1–US3.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; independently delivers worksheet import and validation.
- **US2 (P1)**: Starts after Phase 2; independently delivers the live quiz loop with seeded activities and groups; no dependency on Google Sheets import implementation.
- **US3 (P2)**: Requires US1 for a validated target sheet binding and US2 for final winner/results; cannot be delivered before both.

### Within Each User Story

- Contract/unit/integration tests are defined before the implementation tasks they validate.
- Data validation and domain logic precede application services and Route Handlers.
- Server handlers and services precede UI integration.
- Every story checkpoint must pass its independent test before dependent stories proceed.

### Parallel Opportunities

- Setup T003 and T004 can run in parallel after T001.
- Foundational T006 and T007 can run in parallel after T005.
- After Phase 2, US1 and US2 can be assigned to separate contributors; their tests, adapters, UI, and routes occupy distinct files.
- Within US1, T010/T011 tests and T012/T013 parser/OAuth work are file-disjoint; T014 depends on parser contracts, and T015–T017 follow their service/endpoint dependencies.
- Within US2, T019/T020 tests can run in parallel; T022/T025 can be implemented in separate Redis-script/event-reader files after domain types exist.
- Within US3, T030/T031 tests can run in parallel; results UI and worker/queue work can proceed separately after the service contracts are fixed.
- In Polish, T039 and T040 are independent test suites.

## Parallel Examples

### User Story 1

```text
Task: T010 parser tests in tests/unit/sheets/worksheet-parser.test.ts
Task: T011 import contract tests in tests/contract/sheets-import.test.ts

# After both tests are written and failing, independent implementations may proceed together
Task: T012 parser in src/features/sheets/domain/worksheet-parser.ts
Task: T013 OAuth handlers in src/app/api/auth/google/
```

### User Story 2

```text
Task: T019 Redis race tests in tests/integration/round-atomicity.test.ts
Task: T020 API/SSE privacy tests in tests/contract/rounds-and-events.test.ts

# After both tests are written and failing, independent implementations may proceed together
Task: T021 group join flow in src/features/activities/application/join-activity.ts
Task: T022 atomic round scripts in src/server/redis/scripts/
```

### User Story 3

```text
Task: T030 results authorization tests in tests/contract/results-access.test.ts
Task: T031 writeback recovery tests in tests/integration/writeback-worker.test.ts

# After both tests are written and failing, independent implementations may proceed together
Task: T032 results service in src/features/activities/application/results-service.ts
Task: T033 writeback queue in src/server/redis/writeback-queue.ts
```

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Implement US1 and validate dynamic import/mapping confirmation as the first independently demonstrable increment.
3. Implement US2 to complete the minimum interactive classroom-quiz MVP; validate open/submit/close, deterministic winner, and student privacy.
4. Add US3 for final result access and asynchronous Google Sheets writeback.
5. Do not claim the classroom MVP is complete until both P1 stories pass their independent tests.

### Incremental Delivery

1. Setup + Foundations produce a runnable Next.js/Redis skeleton with private Redis boundary.
2. US1 delivers reliable worksheet ingestion and confirmed dynamic answer-slot mapping.
3. US2 delivers the live classroom round and winner decision independently with seeded activity data.
4. US3 adds final result presentation and resumable answer writeback.
5. Polish validates 500 concurrent SSE clients, privacy, and the complete quickstart.

## Notes

- `[P]` means different files with no dependency on incomplete tasks.
- `[US1]`, `[US2]`, and `[US3]` map to the corresponding user stories in `spec.md`.
- Every task includes implementation or test file paths; generated code must preserve the data-model constraints and API contract.
- Redis is server-only; Google Sheets coordinates may only be derived at runtime from validated worksheet scans.

## Phase 7: Convergence

- [ ] T043 CRITICAL: Complete and run behavioral, Redis/Sheets integration, contract, and end-to-end tests for the implemented workflows in `tests/`, including the existing import contract tests that currently reference missing routes, after implementing their dependencies per Constitution III–IV (missing).
- [ ] T044 CRITICAL: After implementation, verify the code's components, domain relationships, and interaction sequence against `diagrams/component.puml`, `diagrams/class.puml`, and `diagrams/sequence.puml`, and record verification results or resolve mismatches per Constitution VI (missing).
- [ ] T045 Complete teacher Google OAuth, Google Sheets import, dynamically resolved question/answer mappings, confirmation routes, and import UI in `src/features/sheets/`, `src/app/api/activities/`, and `src/app/(teacher)/` per FR-002–005 and US1/AC1–AC3 (missing).
- [ ] T046 Complete group joining, teacher open/close controls, atomic first-submission ordering and winner selection, and role-filtered SSE phase synchronization in `src/features/activities/`, `src/server/redis/`, `src/server/events/`, and `src/app/` per FR-006–010 and US2/AC1–AC4 (missing).
- [ ] T047 Extend worksheet parsing and import validation in `src/features/sheets/domain/worksheet-parser.ts` and `tests/unit/sheets/worksheet-parser.test.ts` to cover unambiguous supported question/blank associations and independently verify imported question count against the source, failing closed when mapping or count is uncertain per FR-003–005 and SC-001 (partial).
- [ ] T048 Strengthen `tests/architecture/server-boundary.test.ts` to verify transitive browser dependencies and side-effect/dynamic imports cannot expose Redis clients, server-only adapters, or credentials per plan: server-only Redis and Google access (partial).
- [ ] T049 Implement teacher live status/order, role-filtered post-close group results, and the no-submission outcome in `src/features/activities/`, `src/app/api/activities/`, and `src/components/` per FR-011–013 and FR-016 (missing).
- [ ] T050 Implement teacher-triggered asynchronous Sheets writeback, dynamic target revalidation, idempotent retry/recovery, and accurate failure reporting in `src/features/sheets/`, `src/server/workers/`, and `src/app/api/activities/` per FR-014–015 and US3/AC3–AC4 (missing).
- [ ] T051 Add and run a 500-client SSE load test in `tests/load/` that verifies at least 95% of connected clients observe phase changes within two seconds, and report any environment limitations per SC-002 and plan: performance goals (missing).
- [ ] T052 Replace the unconditional ready indicator in `src/app/page.tsx` with an accurate server-derived connection status or an honest neutral state per FR-007 and plan: activity synchronization (contradicts).
- [ ] T053 Review and justify or remove the unsupported 200-question cap in `src/features/sheets/domain/worksheet-parser.ts` and `src/lib/validation/schemas.ts`, ensuring supported worksheets retain the source question count per FR-003 and SC-001 (unrequested).
- [ ] T054 Review the unsupported `/help` navigation link in `src/app/page.tsx`; justify and implement it within approved scope or remove the dead link per spec: core scope (unrequested).

## Phase 8: Convergence

- [ ] T055 CRITICAL: After completing the remaining user-story implementation, verify and record that the application components, domain entities, and interaction sequence match `diagrams/component.puml`, `diagrams/class.puml`, and `diagrams/sequence.puml` per Constitution VI (missing).
- [ ] T056 CRITICAL: Complete the teacher activity handoff and control flow in `src/components/teacher/guided-notes-import.tsx` and `src/app/(teacher)/teacher/activities/[activityId]/page.tsx`; display the generated join code and provide authorized per-question open/close controls with live group status per FR-006–007, FR-011, and US2/AC1 (missing).
- [ ] T057 CRITICAL: Create the session-protected `/student/activity` page in `src/app/(student)/activity/page.tsx`; load a role-filtered snapshot and mount `src/components/student/activity-round.tsx` so joined students can submit and view results per FR-008, FR-012–013 and US2/AC2–AC4 (missing).
- [ ] T058 HIGH: Add a Google Picker or an equivalent supported file-selection authorization flow in `src/components/teacher/guided-notes-import.tsx` and `src/app/api/auth/google/` so a sheet selected by the teacher is actually accessible under the configured `drive.file` scope per FR-002 and plan: Google Sheets authorization (partial).
- [ ] T059 HIGH: Implement teacher live/final result access and the no-submission result view in `src/features/activities/application/results-service.ts`, `src/app/api/activities/[activityId]/rounds/[roundId]/results/route.ts`, and `src/components/teacher/round-results.tsx` per FR-011, FR-013, FR-016 and US3/AC1–AC2 (missing).
- [ ] T060 HIGH: Implement the teacher-triggered idempotent writeback endpoint, Redis Stream worker recovery/retry, fresh answer-slot validation, and status reporting in `src/app/api/activities/[activityId]/rounds/[roundId]/writeback/route.ts`, `src/server/workers/sheets-writeback.ts`, and `src/features/sheets/application/writeback-guided-notes.ts` per FR-014–015 and US3/AC3–AC4 (missing).
- [ ] T061 HIGH: Correct the Playwright `webServer.command` in `playwright.config.ts` and add runnable teacher-import, join, open/submit/close, privacy, and final-results browser flows in `tests/e2e/` per Constitution III–IV, plan: end-to-end testing, and T042 (partial).
- [ ] T062 HIGH: Add and run a 500-client SSE phase-fanout load test in `tests/load/activity-sse.test.ts`, measuring that at least 95% of connected clients observe open/close changes within two seconds per SC-002 and plan: performance goals (missing).
- [ ] T063 HIGH: Extend `tests/architecture/server-boundary.test.ts` to detect transitive client imports, re-exports, dynamic imports, and side-effect paths that could expose Redis, Google credentials, or server-only adapters per plan: server-only boundary (partial).
- [ ] T064 HIGH: Define the supported Guided Notes question/answer marker format and validate an independent source question count against parsed questions in `src/features/sheets/domain/worksheet-parser.ts`, `src/features/sheets/application/import-guided-notes.ts`, and `tests/integration/sheets-import.test.ts`; fail closed for unrecognized question rows per FR-003–005 and SC-001 (partial).
- [ ] T065 MEDIUM: Replace the static “系統就緒” indicator in `src/app/page.tsx` with an accurate server-derived status or neutral status text per FR-007 (contradicts).
- [ ] T066 LOW: Resolve dead `/teacher` and `/help` navigation targets in `src/app/page.tsx` by linking to existing approved routes or removing unsupported links per spec: core scope (unrequested).
