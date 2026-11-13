# Implementation Plan: 線上課堂搶答系統

**Branch**: `001-live-classroom-quiz` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-live-classroom-quiz/spec.md`

## Summary

以單一 Next.js App Router 應用提供教師控制台、學生組別頁面與後端 API。Redis 是即時活動狀態、原子判題、可重播事件 Stream 及回填工作佇列的私有後端資料層；SSE 推播階段與結果，Google Sheets 由伺服器端 `googleapis` 動態解析題號/答案空格並在教師觸發後非同步回填。500 個同時連線及 95% 使用者在 2 秒內收到階段更新是主要容量驗收基準。

## Technical Context

**Language/Version**: TypeScript 5.x、Node.js 22 LTS；Next.js App Router 使用實作啟動時的穩定版並鎖定精確版本。

**Primary Dependencies**: Next.js、`redis` Node client、Google `googleapis` SDK、Zod 請求驗證、Vitest、Playwright；使用 pnpm lockfile 固定相依套件。

**Storage**: 私有 Redis 儲存活動、題目、回合、答案、順序、結果及 Redis Stream 回填工作；Google Sheets 是 Guided Notes 與最終答案的來源/持久化位置。Redis 活動資料 TTL 可設定，初始預設 7 天。

**Testing**: Vitest 單元/契約測試、真實 Redis integration tests、Playwright 端到端測試、500 SSE client 負載測試，以及 Google Sheets API sandbox/fixture 測試。

**Target Platform**: 支援長時間 HTTP streaming 的 Node.js 容器服務；Redis 僅在私有網路接受 Next.js/worker 連線。不得部署到會緩衝 SSE 或無法維持長連線的執行環境。

**Project Type**: 單一全端 Web application。教師/學生 UI、API、SSE、Sheets adapter 與回填 worker 共用一個 Next.js 專案，不拆分微服務。

**Performance Goals**: 支援約 500 個同時連線的瀏覽器；教師開啟/結束回合後至少 95% 仍連線用戶於 2 秒內看到相同階段；搶答順序不得因併發或 client 時鐘而重複/倒置。

**Constraints**: 瀏覽器不得連線 Redis 或取得 Google OAuth refresh token；SSE live events、replay 與 snapshots 均需依角色/組別過濾；狀態轉換與 event Stream entry 原子提交；題目/答案格以執行時掃描結果定位，禁止固定儲存格常數；回填需冪等、可重試且只更新重新確認過的答案格；Google Sheets 無任意儲存格 compare-and-swap，驗收假設最後預檢與 batch update 的極短區間沒有外部同時編輯；使用者提供的答案不得解讀為 Sheets 公式。

**Scale/Scope**: 一個活動綁定一份工作表、逐題單一開放回合、教師/學生兩種角色與約 500 個同時連線；不含自動評分、選擇題或通用班級名冊。

## Constitution Check

**Gate before Phase 0: PASS**

- Clear, Consistent Code: 採領域/adapter 邊界映射既有 Component Diagram 模組，責任單一且命名一致。
- Simplicity and Explicit Design: 單一 Next.js 應用；SSE 搭配 Redis Streams 支援推播、跨 instance 可重播事件與可恢復工作，不新增微服務或外部 queue。
- Tests Define Behavior: 每個需求以單元、Redis/Sheets integration、API contract 與端到端驗收覆蓋。
- Risk-Based Test Coverage: 競態、角色資料隔離、重連、Google 權限撤銷及回填重試均列為專項測試。
- Maintainable Change: Redis、Sheets、SSE 與 UI 依模組隔離；API 與資料模型有獨立合約文件。

**Gate after Phase 1 design: PASS**

Redis 是後端內部唯一即時狀態介面；所有 API/SSE 均在 Next.js 驗證角色後提供資料。受理序號/winner 與 close 由 Lua 原子流程裁定。Google Sheets 只由 server adapter 存取。所選技術符合既有圖表流程，無需新增獨立部署單元。

## Project Structure

### Documentation (this feature)

```text
specs/001-live-classroom-quiz/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── http-api.md
└── tasks.md                 # 由 /speckit-tasks 建立
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (teacher)/teacher/
│   ├── (student)/join/[code]/
│   └── api/
│       ├── auth/google/
│       ├── activities/
│       └── health/
├── components/
│   ├── teacher/
│   ├── student/
│   └── shared/
├── features/
│   ├── activities/
│   │   ├── domain/
│   │   └── application/
│   ├── realtime/
│   ├── submissions/
│   └── sheets/
├── server/
│   ├── redis/
│   ├── auth/
│   ├── events/
│   └── workers/sheets-writeback.ts
└── lib/
    ├── validation/
    └── errors/

tests/
├── unit/
├── contract/
├── integration/
├── e2e/
└── load/
```

**Structure Decision**: 使用單一 Next.js Web application，API Route Handlers 處理所有具權限的操作與 SSE。`features/activities` 落實 Activity/Question/Round/Group/Submission；`features/realtime` 對應 Activity Phase Sync；`features/sheets` 對應 Guided Notes 匯入/回填；`server/redis` 是 Activity Data 的唯一 Redis adapter。Server Components/頁面分別落實 Teacher Portal 與 Student Portal。回填 worker 與 Next.js 共用程式碼與 Redis，使用獨立 worker process 啟動但不形成另一個服務邊界。

## Diagram Alignment

本計畫依 repo 實際存在的小寫檔名 `diagrams/component.puml`、`diagrams/class.puml`、`diagrams/sequence.puml`；訊息中大寫檔名在 Linux 上不視為相同路徑。

| Diagram module/entity | Implementation mapping |
|---|---|
| Teacher Portal | Next.js `(teacher)` routes and teacher components |
| Student Portal | Next.js `(student)` routes; role/group-scoped session |
| Questions and Results / Quiz Adjudication | Route Handlers + activity/submission application services |
| Activity Phase Sync | SSE endpoint, local connection registry, per-instance Redis Stream reader and role projection |
| Activity Data | Private Redis hashes, sorted sets, Lua scripts, and Streams |
| Google Sheets Read/Write / GuidedNotesSheet / AnswerSlot | Server-only `googleapis` adapter and dynamically resolved SheetBinding |
| Activity / Question / Round / Group / Submission | Domain records in [data-model.md](data-model.md) |
| Sequence open / submit / close | Redis Lua atomically changes state and appends a versioned Stream event; each instance reads independently, then applies role-filtered SSE projection |
| Sequence optional teacher writeback | Teacher action after close enqueues an idempotent Redis Stream job; worker reclaims stale pending work with `XAUTOCLAIM`, then writes asynchronously |

Submissions and close are linearized by Redis Lua scripts. The event Stream is appended in the same script, preventing state/event divergence. Every SSE event and reconnect snapshot is projected on the server: while a round is open, teacher SSE may include all groups' statuses/order; student SSE includes only their own receipt. Final group results are emitted to students only after close. Redis is not reachable from browsers.

## Complexity Tracking

No constitution violations. Redis Lua and Streams remain adapters inside the selected single-app architecture and each supports an explicit atomicity, cross-instance replay, or retry requirement.
