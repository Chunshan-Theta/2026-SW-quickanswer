# Implementation Plan: 分頁專屬的組別身分

**Branch**: `feat/003-tab-scoped-sessions` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-tab-scoped-sessions/spec.md`

## Summary

所有身分（教師、各組學生）共用同一個 `classroom_session` cookie（Path=/），同一個瀏覽器的所有分頁（含所有無痕視窗）共享它：後加入的組別覆蓋先加入者，A 分頁的答案被記成 B 組、B 組隨後被判定重複作答；教師在同一瀏覽器加入學生也會失去教師身分。本功能以 `diagrams/003-*.puml` 為藍圖：

1. **分頁代號（seat）**：每次加入產生 128-bit 隨機代號（base64url 22 字元），學生頁網址為 `/student/activity?seat=<seat>`。
2. **每個 seat 一個 HttpOnly cookie** `qa_seat_<seat>`，值為含 `seatId` 的簽章學生身分；教師改用獨立的 `qa_teacher` cookie。
3. **身分解析**集中在 `server/auth/session.ts#getRequestSession(request)`（簽章不變）：請求帶 seat（fetch 標頭 `x-quickanswer-seat`，EventSource 查詢參數 `?seat=`）時只讀該 seat 的 cookie；不帶 seat 時只讀教師 cookie；seat 格式錯誤一律視為未登入。所有 API route 不需修改。
4. **前端**只在一個小工具 `lib/session/seat.ts`（`seatHeaders`、`withSeat`）處理 seat 的傳遞；學生元件改動限於傳入 seat。
5. **上限**：加入時清除過期／無效的 seat cookie，並最多保留 10 個（先移除最早到期者）。

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 22 (Next.js 16 App Router, React 19)

**Primary Dependencies**: 既有 `node:crypto`（HMAC 簽章、隨機代號）、`next/headers` cookies；不新增套件

**Storage**: 無新增伺服器端儲存；身分仍為無狀態的簽章 cookie

**Testing**: Vitest（unit／contract／integration with local Redis／security／architecture），Playwright e2e（本機未安裝瀏覽器，僅更新測試）

**Target Platform**: 本機 Node.js server + 同一台電腦上的瀏覽器

**Project Type**: 單一 Next.js web application（`main/`）

**Performance Goals**: 每個請求最多解析一次 Cookie 標頭；無額外 I/O

**Constraints**: 憑證不得讓前端 JS 讀取（HttpOnly）；`getRequestSession(request)` 簽章維持不變以避免修改所有 route；與平行開發中的 004（多題同時開放）衝突面最小化

**Scale/Scope**: 每個瀏覽器最多 10 個有效學生身分；每個 seat cookie 約 250 bytes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Clear, Consistent Code | Seat 解析集中於 `session.ts`，seat 傳遞集中於 `lib/session/seat.ts`；名稱直接表達角色（`qa_teacher`、`qa_seat_<seat>`、`getTeacherServerSession`、`getStudentServerSession`） | PASS |
| II. Simplicity | 不新增套件、不新增伺服器端 session 儲存；route 不動；重複的 `/activity` 學生頁改為導向單一學生頁 | PASS |
| III. Tests Define Behavior | 先寫重現使用者情境的回歸測試（同一 cookie jar 兩次加入 → 各自以自己組別送出），修正前失敗 | PASS |
| IV. Risk-Based Coverage | session 解析（unit）、join／OAuth／SSE（contract／integration）、跨活動與教師端點（security）、真實 Redis 兩分頁搶答（integration）、同一 browser context 兩分頁（e2e，本機未執行） | PASS |
| V. Maintainable Change | API 路徑與請求格式不變，join 回應僅新增 `seatId`；舊 cookie 不再讀取的遷移影響（重新登入／重新加入）記錄於 `contracts/http-api.md` 與 quickstart | PASS |
| VI. Design-First with PlantUML | `diagrams/003-component.puml`、`003-class.puml`、`003-sequence.puml` 於 specify 階段建立並轉為 PNG；實作完成後逐項核對（T019）。共用的 `diagrams/class.puml`／`sequence.puml`／`component.puml` 因 004 平行修改同一批檔案，刻意延到兩分支合併時統一更新，以免衝突 | PASS（共用圖延後，已記錄） |

**Post-design re-check (after Phase 1)**: PASS — `data-model.md` 的 Seat／SeatSessionCookie／TeacherSessionCookie／SessionClaims.seatId 與 `003-class.puml` 一一對應；`contracts/http-api.md` 的請求流程與 `003-sequence.puml` 的四個階段一致。

## Project Structure

### Documentation (this feature)

```text
specs/003-tab-scoped-sessions/
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
├── lib/session/seat.ts                               # NEW: seat format + header/query transport (isomorphic)
├── server/auth/session.ts                            # teacher/seat cookies, seat resolver, prune
├── features/activities/domain/types.ts               # SessionClaims.seatId
├── app/
│   ├── api/activities/[activityId]/join/route.ts     # issue seat + cookie, prune, return seatId
│   ├── api/auth/google/callback/route.ts             # qa_teacher
│   ├── (student)/student/activity/page.tsx           # ?seat= → getStudentServerSession
│   ├── (student)/activity/page.tsx                   # redirect to /student/activity (keeps ?seat=)
│   └── (teacher)/teacher/{import,activities/[activityId]}/page.tsx  # getTeacherServerSession
└── components/student/{join-form,activity-round}.tsx # navigate with seat; send seat on fetch/EventSource

tests/
├── unit/auth/session.test.ts                         # NEW: seat format, resolver matrix
├── contract/{activity-join,google-oauth}.test.ts     # seat cookie, qa_teacher
├── integration/tab-scoped-sessions.test.ts           # NEW: user's two-tab scenario against Redis
├── integration/activity-events.test.ts               # SSE via ?seat=
├── security/tab-scoped-sessions.test.ts              # NEW: copied URL, cross-activity, teacher endpoints
├── fixtures/cookie-jar.ts                            # NEW: browser-like cookie jar shared by "tabs"
├── load/activity-sse.test.ts                         # cookie name
└── e2e/{sheets-writeback,tab-scoped-sessions}.spec.ts
```

**Structure Decision**: Keep the single Next.js project. Seat parsing/transport is a pure isomorphic module so both the browser components and the server session module share one definition; everything cookie-related stays in `server/auth/session.ts`.

## Complexity Tracking

No constitution violations to justify.
