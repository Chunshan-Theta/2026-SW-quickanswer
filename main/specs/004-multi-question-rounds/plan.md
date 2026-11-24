# Implementation Plan: 多題同時開放搶答與教師題目控制介面

**Branch**: `feat/004-multi-question-rounds` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-multi-question-rounds/spec.md`

## Summary

目前活動只記錄一個 `currentRoundId`：`open-round.lua` 在已有題目開放時回傳 `ROUND_ALREADY_OPEN`，提交與結束都比對 `currentRoundId`，快照只有一個 `currentRound`，教師端用下拉式選單選題且長題目會溢出。本功能以 `diagrams/004-*.puml` 為藍圖：

1. **狀態模型**：以活動 JSON 的 `openRoundIdsByQuestion`（題號 → 開放中回合 id 的物件，空時移除）取代 `currentRoundId`；回合、提交、順位與得獎組別仍各自存於 `round:{id}:*`，因此各題天然獨立。
2. **原子開放／結束**：`open-rounds.lua` 一次驗證所有題目後全部開放（否則全部不開），每個回合各發一個 `phase.changed`；`close-rounds.lua` 結束 1..n 個回合（單題結束為 strict，一次結束全部為 open-only），每個回合各發一個 `results.finalized`。
3. **API**：`POST rounds/open` 接受 `{ questionNumbers[] }`（新）與 `{ questionNumber }`（舊，回傳舊格式）；新增 `POST rounds/close-all`；單題結束與提交路由不變。回填在前次工作失敗時可重新排入。
4. **快照**：`ActivitySnapshot.rounds[]` 列出活動所有回合（開放中＋已結束），取代 `currentRound`；教師頁面資料的 `completedRounds` 併入 `rounds`。
5. **前端**：純函式 `round-state.ts`（套用 SSE 事件、推導卡片狀態、計時格式）供教師與學生共用；教師端改為「題目卡片清單＋勾選＋固定工具列」，學生端依題號列出所有開放中題目卡片。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (Next.js 16 App Router, React 19)

**Primary Dependencies**: `redis` 6 client with Lua scripts, `zod` 4, `lucide-react` icons (existing) — no new dependency

**Storage**: Private Redis 7 — activity JSON (`activity:{id}:meta`), round hashes, event Stream; schema change limited to activity JSON (`openRoundIdsByQuestion` added, `currentRoundId` removed)

**Testing**: Vitest (unit / contract / integration against local Redis / security / architecture); Playwright e2e updated (browsers not installed locally, so not executed)

**Target Platform**: Local Node.js server + browsers (course scope)

**Project Type**: Single Next.js web application (`main/`)

**Performance Goals**: Opening or closing N questions is one Redis round-trip (one `EVAL`, plus one `GET` for close-all); snapshot loads ≤ 2–3 hashes per round (activities have tens of questions at most)

**Constraints**: Every state change and its events are atomic in Lua; SSE needs contiguous `stateVersion` values, so each opened/closed round consumes exactly one version; Lua `cjson` re-encodes empty arrays as `{}` — the open map is an object and is removed when empty; Redis/Google stay server-only; no fixed sheet coordinates (unchanged)

**Scale/Scope**: Up to all questions of an activity open simultaneously; up to 32 groups (unchanged)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Clear, Consistent Code | One field name (`openRoundIdsByQuestion`) mirrors the existing `roundIdsByQuestion`; event names and payloads unchanged; client state updates live in one pure module instead of being duplicated in two components | PASS |
| II. Simplicity | No new dependency, no new Redis key type. Two Lua scripts replace two (open/close) instead of adding batch variants next to single ones. One new route (`close-all`). Each question still has exactly one round, so per-round keys and ordering logic are reused untouched | PASS |
| III. Tests Define Behavior | The reported limitation (second question cannot be opened while one is open) gets a failing integration test first; reducer and status derivation get unit tests; existing tests that asserted `currentRound` are migrated, not deleted | PASS |
| IV. Risk-Based Coverage | Lua atomicity (all-or-nothing open, independent ordering, close one vs. all, completion, late submission) covered by integration tests against Redis; routes by contract tests (array + legacy body, auth, close-all); SSE snapshot privacy per round by integration test; e2e updated for the card UI | PASS |
| V. Maintainable Change | Legacy `{ questionNumber }` open body and its response shape keep working; close / submissions / writeback routes keep their contracts; breaking snapshot change (`currentRound` → `rounds[]`) documented with migration in `contracts/http-api.md` for the OpenSpec subgroup | PASS |
| VI. Design-First with PlantUML | `diagrams/004-component.puml`, `004-class.puml`, `004-sequence.puml` created before planning and rendered to PNG; shared `class.puml` / `sequence.puml` updated; implementation verified against them at the end (T030) | PASS |

**Post-design re-check (after Phase 1)**: PASS — `data-model.md` matches `004-class.puml` (ActivityRecord.openRoundIdsByQuestion, Round, ActivityRoundSnapshot.openedAt/closedAt, ActivitySnapshot.rounds, RoundState functions, QuestionStatus); `contracts/http-api.md` matches the four request paths in `004-sequence.puml`.

## Project Structure

### Documentation (this feature)

```text
specs/004-multi-question-rounds/
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
│   ├── scripts/open-rounds.lua          # NEW (replaces open-round.lua): atomic multi-open
│   ├── scripts/close-rounds.lua         # NEW (replaces close-round.lua): close 1..n rounds
│   ├── scripts/submit-answer.lua        # CHANGED: accept any open round of the activity
│   ├── scripts/enqueue-writeback.lua    # CHANGED: re-queue a failed job
│   └── round-store.ts                   # CHANGED: openRounds / closeRounds / closeAllOpenRounds
├── features/activities/
│   ├── domain/snapshot.ts               # CHANGED: ActivitySnapshot.rounds[], openedAt/closedAt
│   ├── domain/round-state.ts            # NEW: pure reducers + question status + elapsed time
│   ├── application/activity-snapshot.ts # CHANGED: load every round of the activity
│   ├── application/teacher-activity.ts  # CHANGED: rounds[] (completedRounds merged)
│   └── application/round-service.ts     # CHANGED: multi-open, close-all
├── lib/validation/schemas.ts            # CHANGED: roundOpenSchema (array | legacy)
├── app/api/activities/[activityId]/rounds/
│   ├── open/route.ts                    # CHANGED
│   └── close-all/route.ts               # NEW
├── components/teacher/round-control.tsx # REWRITTEN: question board
├── components/student/activity-round.tsx# REWRITTEN: stacked open questions
├── components/student/answer-form.tsx   # CHANGED: per-round field ids
├── components/student/student-api.ts    # NEW: student events URL + submit (single place)
└── app/globals.css                      # CHANGED: board / card / badge styles

tests/
├── unit/activities/round-state.test.ts          # NEW
├── unit/validation/round-open-schema.test.ts    # NEW
├── integration/multi-round.test.ts              # NEW
├── integration/round-atomicity.test.ts          # CHANGED (unique ids, rounds API)
├── integration/activity-events.test.ts          # CHANGED (rounds[] snapshot)
├── integration/writeback-queue.test.ts          # CHANGED (failed job re-queue)
├── contract/rounds.test.ts                      # CHANGED (array/legacy/close-all)
├── contract/activity-events-replay.test.ts      # CHANGED (mock shape)
└── e2e/sheets-writeback.spec.ts                 # CHANGED (card UI, multi-open flow)
```

**Structure Decision**: Keep the existing feature-sliced layout. The pure client reducer goes in `features/activities/domain/` next to `snapshot.ts` (no server imports, so the browser/server boundary test keeps passing).

## Complexity Tracking

No constitution violations.
