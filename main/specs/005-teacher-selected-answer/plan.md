# Implementation Plan: 教師選擇回填答案與學生端正確答案公布

**Branch**: `feat/005-teacher-selected-answer` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-teacher-selected-answer/spec.md`

## Summary

教師在已結束題目的卡片上，從依送出順序排列的各組答案中選擇一個（預設最快組別），或自行輸入正確答案，再回填至學習單；回填後可改選並重新回填。學生端在題目結束後只看到自己組別的答案，回填成功後再看到老師採用的答案（含組別名稱或「老師提供」）。技術上擴充既有回填 API 的 `selection`、在 `enqueue-writeback.lua` 處理選擇／冪等／改選、在 `update-writeback-status.lua` 成功時公布答案，並在事件投影、snapshot 與結果 API 套用同一隱私規則。

## Technical Context

**Language/Version**: TypeScript 5.9（Node 22）、Redis Lua 5.1

**Primary Dependencies**: Next.js 16 App Router、React 19、redis 5、googleapis（Sheets v4）、zod 4

**Storage**: Redis 7（活動 JSON、round／submission hash、writeback job hash、Streams）

**Testing**: Vitest 4（unit／contract／security／integration／architecture／load）、Playwright（e2e，本機未安裝瀏覽器）

**Target Platform**: 桌機與手機瀏覽器；Node.js runtime 的 Next.js 伺服器＋獨立回填 worker

**Project Type**: Web 應用（單一 Next.js 專案於 `main/`）

**Performance Goals**: 回填成功後已連線學生 2 秒內看到正確答案（沿用 SSE）

**Constraints**: 學生端不得取得其他組別答案；回填 API 向下相容；每題同時最多一筆回填在處理

**Scale/Scope**: 單一班級（≤32 組）、每活動數十題

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
|---|---|---|
| I. Clear, Consistent Code | 沿用既有 Lua／route／reducer 命名與結構；新增純函式模組集中採用答案邏輯 | ✅ |
| II. Simplicity | 不新增端點與工作佇列；每題一筆工作、以 revision 改選（research R2）；不新增依賴 | ✅ |
| III. Tests Define Behavior | 先寫失敗測試：Lua 整合、contract、隱私（projection／snapshot／results）、純函式單元測試 | ✅ |
| IV. Risk-Based Coverage | 回填（外部系統邊界）有整合與 worker 測試；隱私規則有 security 測試；e2e 規格更新 | ✅（e2e 本機無瀏覽器，標註未執行） |
| V. Maintainable Change | 回填 API 向下相容（無 selection = 最快組別）；學生可見內容的行為變更記錄於 contracts 給 OpenSpec 組 | ✅ |
| VI. Design-First with PlantUML | `diagrams/005-component/class/sequence.puml` 與 PNG；共用圖表（class/sequence/component）於與 006 整合時統一更新 | ✅（共用圖延後至整合，原因：避免與平行分支 006 衝突） |

## Project Structure

### Documentation (this feature)

```text
specs/005-teacher-selected-answer/
├── spec.md
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
├── lib/validation/schemas.ts                         # writebackRequestSchema.selection
├── server/redis/scripts/enqueue-writeback.lua        # selection、冪等、改選、previousAnswers
├── server/redis/scripts/update-writeback-status.lua  # succeeded → round published*、事件 published
├── server/redis/writeback-queue.ts                   # enqueueWriteback(selection)、錯誤訊息、狀態含 adopted
├── server/workers/sheets-writeback.ts                # 傳 previousAnswers
├── server/events/activity-event-projection.ts        # 學生：results.finalized 只含自己；answer.published
├── features/sheets/application/writeback-guided-notes.ts  # previousAnswers 視為可覆寫
├── features/activities/domain/snapshot.ts            # PublishedAnswerSnapshot、AdoptedAnswerSnapshot
├── features/activities/domain/answer-adoption.ts     # NEW 純函式
├── features/activities/domain/round-state.ts         # applyWritebackStatus(adopted/published)、applyPublishedAnswer
├── features/activities/application/activity-snapshot.ts  # 學生隱私＋publishedAnswer
├── features/activities/application/results-service.ts    # 同上
├── app/api/activities/[activityId]/rounds/[roundId]/writeback/route.ts
├── components/teacher/answer-adoption.tsx            # NEW 選擇與回填區
├── components/teacher/round-control.tsx              # 已結束卡片改用新元件
├── components/student/activity-round.tsx             # 你們的答案＋正確答案
└── app/globals.css
tests/
├── unit/activities/answer-adoption.test.ts           # NEW
├── unit/activities/round-state.test.ts
├── unit/events/activity-event-projection.test.ts
├── unit/sheets/writeback-guided-notes.test.ts
├── unit/validation/schemas.test.ts
├── contract/writeback.test.ts
├── contract/results-access.test.ts
├── security/answer-privacy.test.ts                   # NEW
├── integration/writeback-queue.test.ts               # 改用唯一 id、不刪共用 stream
├── integration/answer-adoption.test.ts               # NEW Redis：選擇／改選／公布
├── integration/writeback-worker.test.ts
└── e2e/sheets-writeback.spec.ts
```

**Structure Decision**: 沿用單一 Next.js 專案；變更集中在回填管線、可見性出口（projection／snapshot／results）與已結束題目卡片。

## Complexity Tracking

無違反憲章的項目。
