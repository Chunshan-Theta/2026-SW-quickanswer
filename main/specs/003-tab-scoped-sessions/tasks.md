# Tasks: 分頁專屬的組別身分

**Input**: Design documents from `specs/003-tab-scoped-sessions/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/http-api.md`, `quickstart.md`, `diagrams/003-*.puml`

**Tests**: Included — Constitution III requires a regression test that reproduces the reported defect before the fix, and tests for all new behavior.

**Organization**: Grouped by user story; US1 and US2 are P1, US3 is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependency on an incomplete task.
- **[Story]**: Maps to user stories in `spec.md`.

## Phase 1: Foundational (blocking all stories)

**Purpose**: Shared seat definition and claim shape (see `diagrams/003-class.puml`).

- [ ] T001 [P] Create the isomorphic seat module `src/lib/session/seat.ts`: `SEAT_HEADER = "x-quickanswer-seat"`, `SEAT_QUERY_PARAM = "seat"`, `seatIdPattern`, `isSeatId`, `seatHeaders(seat)`, `withSeat(path, seat)`.
- [ ] T002 [P] Add `seatId?: string` to `SessionClaims` in `src/features/activities/domain/types.ts`.

**Checkpoint**: Types compile; no behavior change yet.

---

## Phase 2: User Story 1 — 同一個瀏覽器的分頁各自代表不同組別 (P1) 🎯 MVP

**Goal**: Two tabs in one cookie jar join different groups and each submits as its own group.

**Independent Test**: Quickstart scenario A; integration test T003.

### Tests for User Story 1 (write first, must fail before T007–T011)

- [ ] T003 [P] [US1] Regression test reproducing the reported scenario against real Redis in `tests/integration/tab-scoped-sessions.test.ts`: seed an activity (unique ids/join code), open question 1, join teamA then teamB through the join route sharing one cookie jar, submit from each seat → both 201, teamA order 1 / teamB order 2, Redis submissions hold each group's own answer; each seat's SSE snapshot (`?seat=`) shows only its own group.
- [ ] T004 [P] [US1] Unit tests in `tests/unit/auth/session.test.ts`: seat format/uniqueness, `withSeat`/`seatHeaders`, and the resolver table in `data-model.md` (header, query, header precedence, missing cookie, seat mismatch, malformed seat, student claims in the teacher cookie, legacy `classroom_session` ignored), plus `getStudentServerSession`/`getTeacherServerSession` against a mocked `next/headers` cookie store (FR-007: missing/invalid seat → `null`).
- [ ] T005 [P] [US1] Update `tests/contract/activity-join.test.ts`: response `seatId`, `Set-Cookie qa_seat_<seatId>` (HttpOnly, Path=/), claims bound to activity/group/seat, two joins yield distinct seats, pruning of expired/invalid and over-limit seat cookies.
- [ ] T006 [US1] Update `tests/integration/activity-events.test.ts` to authenticate students with a seat cookie + `?seat=` and the teacher with `qa_teacher`.

### Implementation for User Story 1

- [ ] T007 [US1] Rework `src/server/auth/session.ts`: `TEACHER_COOKIE`, `SEAT_COOKIE_PREFIX`, `MAX_SEAT_COOKIES`, `createSeatId`, `seatCookieName`, `requestSeat`, seat-aware `getRequestSession` (no fallback on malformed seat), `getStudentServerSession(seat)`, `setSeatSessionCookie`, `pruneSeatCookies`; remove `SESSION_COOKIE`, `setSessionCookie`, `clearSessionCookie`.
- [ ] T008 [US1] Issue a seat in `src/app/api/activities/[activityId]/join/route.ts`: prune, sign claims with `seatId`, set `qa_seat_<seat>`, return `seatId`.
- [ ] T009 [US1] Navigate to `/student/activity?seat=<seatId>` after joining in `src/components/student/join-form.tsx`.
- [ ] T010 [US1] Read `?seat=` with `getStudentServerSession` in `src/app/(student)/student/activity/page.tsx` (redirect `/join` when invalid) and pass `seat` to the round component; turn the duplicate `src/app/(student)/activity/page.tsx` into a redirect that keeps `?seat=`.
- [ ] T011 [US1] Send the seat from `src/components/student/activity-round.tsx` (`withSeat` on the EventSource URL, `seatHeaders` on the submission fetch) — minimal, mechanical change.

**Checkpoint**: T003–T006 pass; quickstart A works.

---

## Phase 3: User Story 2 — 教師與學生可在同一個瀏覽器同時使用 (P1)

**Goal**: The teacher keeps a separate cookie that joins never touch.

**Independent Test**: Quickstart scenario B; T013.

### Tests for User Story 2

- [ ] T012 [P] [US2] Update `tests/contract/google-oauth.test.ts`: callback sets `qa_teacher`; Picker token works with `qa_teacher`; a student seat (cookie + header) gets 403; a legacy `classroom_session` teacher token gets 401.
- [ ] T013 [US2] Extend `tests/integration/tab-scoped-sessions.test.ts`: with `qa_teacher` in the same jar, both joins leave it intact and the teacher (no seat) closes the round → winner teamA.

### Implementation for User Story 2

- [ ] T014 [US2] Add `setTeacherSessionCookie` and `getTeacherServerSession` in `src/server/auth/session.ts`; use them in `src/app/api/auth/google/callback/route.ts`, `src/app/(teacher)/teacher/import/page.tsx` and `src/app/(teacher)/teacher/activities/[activityId]/page.tsx`.

**Checkpoint**: T012–T013 pass; quickstart B works.

---

## Phase 4: User Story 3 — 組別身分不可被複製或挪用 (P2)

**Goal**: The seat in a URL is useless without the matching cookie; seats are bound to one activity; seats never reach teacher endpoints.

**Independent Test**: Quickstart scenario C; T015.

- [ ] T015 [P] [US3] Security tests in `tests/security/tab-scoped-sessions.test.ts` (real session module, round services mocked): copied URL without cookie → 401; seat cookie copied under another seat name → 401; seat of activity X on activity Y submissions/events → 403; seat on teacher endpoints (open round, Picker token) → 403; teacher cookie + malformed/unknown seat → 401 (no teacher fallback).

**Checkpoint**: Behavior already provided by T007; T015 guards it.

---

## Phase 5: Polish & Cross-Cutting

- [ ] T016 [P] Update the cookie name in `tests/load/activity-sse.test.ts` and in `tests/e2e/sheets-writeback.spec.ts` (teacher cookie `qa_teacher`, join URL now carries `?seat=`).
- [ ] T017 [P] Add `tests/e2e/tab-scoped-sessions.spec.ts`: one browser context, teacher cookie plus two pages joining Blue and Red, both submit, teacher sees both groups, Red page reload keeps Red (not runnable locally: Playwright browsers are not installed).
- [ ] T018 Run `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:contract`, `pnpm test:security`, `pnpm test:integration`, `pnpm exec vitest run tests/architecture`; fix failures without weakening tests.
- [ ] T019 Verify code against `diagrams/003-component.puml`, `003-class.puml`, `003-sequence.puml`; record the result in `specs/003-tab-scoped-sessions/quickstart.md` (Constitution VI).
- [ ] T020 Run quickstart scenarios A–C manually in one real browser and record the results in `quickstart.md` (requires the user's Google login on port 3000; done at integration time).

---

## Dependencies & Execution Order

- **Foundational (T001–T002)** → all stories.
- **US1**: tests T003–T006 first (fail), then T007 → T008 → (T009 ∥ T010) → T011.
- **US2**: T012–T013 can be written with US1 tests; T014 depends on T007.
- **US3**: T015 depends on T007 (behavior) only.
- **Polish**: T016–T017 after T009/T014 (cookie names, URLs); T018 after all code; T019 after T018; T020 at integration.

### Parallel Opportunities

- T001 ∥ T002; T003 ∥ T004 ∥ T005 ∥ T012 ∥ T015 (different files); T016 ∥ T017.

## Implementation Strategy

1. **MVP**: Foundational + US1 → the reported two-tab defect is fixed.
2. US2 → teacher and students in one browser (needed for the demo recording).
3. US3 → hardening tests for the new seat transport.
4. Polish: test suite, diagram verification, manual quickstart.

## Consistency Analysis (speckit-analyze, 2026-11-25)

| Check | Result |
|---|---|
| Every FR maps to ≥1 task | FR-001→T007/T008 · FR-002→T003/T013 · FR-003→T004/T007/T011 · FR-004→T005 · FR-005→T004/T015 · FR-006→T015 · FR-007→T004/T010/T017 · FR-008→T012–T014 · FR-009→T005/T007 · FR-010→T005/T008 |
| Every SC is verifiable | SC-001→T003/T017 · SC-002→T013 · SC-003→T015 · SC-004→T004/T017 |
| Diagrams ↔ plan ↔ data model | Names in `003-class.puml` (`TEACHER_COOKIE`, `SEAT_COOKIE_PREFIX`, `MAX_SEAT_COOKIES`, `requestSeat`, `pruneSeatCookies`, `seatHeaders`, `withSeat`) match plan/data-model/tasks |
| Constitution | No violations; shared system diagrams deferred to the 003/004 merge (documented in plan) |
| Finding fixed | FR-007 (SSR seat guard) had no automated test → added to T004 |
