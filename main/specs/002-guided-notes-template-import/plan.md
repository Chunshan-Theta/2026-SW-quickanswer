# Implementation Plan: 官方 Guided Notes 範本匯入與逐題回填

**Branch**: `feat/002-guided-notes-template-import` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-guided-notes-template-import/spec.md`

## Summary

人工驗證發現官方 Guided Notes 範本（表格式「題號｜題目｜作答」、作答格空白、題組以跨列合併題號表示）無法匯入，教師需手填分頁 gid，匯入失敗無說明，且第一題回填後其餘回填皆因整張工作表指紋改變而失敗。本功能以 `diagrams/002-*.puml` 為藍圖：

1. **解析器**新增「表格版面」偵測（標題列＋合併儲存格解析），保留既有記號版面；題目改為「一題含 1..n 個作答格（blank）」模型以支援題組。
2. **結構快照**取代整張工作表指紋：只記錄題號、列範圍與作答格位置，不含作答格內容，回填前後比對結構而非內容。
3. **題組搶答**：回合記錄子題資訊；學生一次送出 `answers[]`，Lua 原子驗證子題數與非空白後才分配順位；回填逐格寫入「子題標記＋答案」。
4. **教師端**：選檔後以名稱選擇分頁（單一分頁自動選取）、匯入錯誤逐項列出、控制台列出所有已結束題目並可個別回填。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (Next.js 16 App Router, React 19)

**Primary Dependencies**: `googleapis` (Sheets v4), `redis` 6 client with Lua scripts, `zod` 4, Google Picker (browser)

**Storage**: Private Redis 7 (activity JSON, round hashes, event Streams, writeback Streams) — schema changes are additive within activity/round JSON

**Testing**: Vitest (unit / contract / integration against local Redis / security / architecture), Playwright (e2e with Google test doubles)

**Target Platform**: Local Node.js server + browsers on the same machine (course scope: no public deployment)

**Project Type**: Single Next.js web application (`main/`)

**Performance Goals**: Import of a ≤200-question worksheet completes within the existing request budget (single `spreadsheets.get` call); no change to SSE fan-out targets from 001

**Constraints**: No fixed A1 coordinates (course rule & FR-003); Redis and Google credentials stay server-only; RAW value writes only; activity JSON must not contain empty arrays (Lua `cjson` re-encodes `[]` as `{}`)

**Scale/Scope**: One worksheet tab per activity; question groups up to 20 blanks; up to 32 groups (unchanged)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Clear, Consistent Code | Parser split into small pure helpers (header detection, merge resolution, row grouping) in the existing `worksheet-parser.ts` domain module; existing naming conventions kept | PASS |
| II. Simplicity | No new dependency. One new route (sheet tabs). Structure snapshot replaces, not adds to, the whole-grid fingerprint. `answers[]` reuses the existing submission record | PASS |
| III. Tests Define Behavior | Each bug found in manual verification gets a regression test (gid default, template not parsed, empty error details, second writeback rejected, worker start) | PASS |
| IV. Risk-Based Coverage | Parser + structure snapshot (unit), import/tabs/submission routes (contract), Lua group submission & writeback worker (integration against Redis), e2e updated for tab selection | PASS |
| V. Maintainable Change | Legacy `answer` field still accepted by the submission API and still present (as display text) in submissions/events; marker layout unchanged; contract changes documented in `contracts/http-api.md` | PASS |
| VI. Design-First with PlantUML | `diagrams/002-component.puml`, `002-class.puml`, `002-sequence.puml` created in the specify phase and rendered to PNG; system `class.puml`/`sequence.puml` updated; implementation verified against them before completion | PASS |

**Post-design re-check (after Phase 1)**: PASS — data model and contracts below map 1:1 to `002-class.puml` entities (`WorksheetLayout`, `ParsedQuestion`/`ParsedBlank`, `ImportedQuestion`/`ImportedBlank`, `StructureSnapshot`, `Submission.answers[]`, `WritebackJob.answers[]`) and to the three phases of `002-sequence.puml`.

## Project Structure

### Documentation (this feature)

```text
specs/002-guided-notes-template-import/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── http-api.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root: `main/`)

```text
src/
├── app/
│   ├── api/
│   │   ├── sheets/[spreadsheetId]/tabs/route.ts          # NEW: list worksheet tabs
│   │   └── activities/...                                # import / rounds / submissions / writeback (updated)
│   └── (teacher)/teacher/activities/[activityId]/page.tsx
├── components/
│   ├── teacher/guided-notes-import.tsx                   # tab selector, issue list, group preview
│   ├── teacher/round-control.tsx                         # completed rounds + per-round writeback
│   └── student/{activity-round,answer-form}.tsx          # multi-blank answers
├── features/
│   ├── sheets/domain/worksheet-parser.ts                 # table + marker layouts, blanks, structure
│   ├── sheets/application/{import-guided-notes,writeback-guided-notes,worksheet-fingerprint}.ts
│   ├── sheets/google-sheets.adapter.ts                   # merges, listSheetTabs, multi-cell write
│   └── activities/{domain,application}/...               # blanks/answers in snapshots & results
├── server/
│   ├── redis/scripts/{open-round,submit-answer,enqueue-writeback}.lua
│   ├── redis/{round-store,writeback-queue}.ts
│   ├── events/activity-event-projection.ts
│   └── workers/sheets-writeback.ts
└── lib/validation/schemas.ts

tests/
├── unit/sheets/        # parser (table/group/merge), structure snapshot, writeback
├── contract/           # import issues, tabs route, submissions answers[]
├── integration/        # Lua group submission, writeback worker answers[]
└── e2e/                # tab selection + group flow with test doubles
```

**Structure Decision**: Keep the single Next.js project from 001. All parsing stays in the pure domain module `features/sheets/domain/worksheet-parser.ts`; Google access stays in `google-sheets.adapter.ts`; atomic state changes stay in Lua scripts.

## Complexity Tracking

No constitution violations to justify.
