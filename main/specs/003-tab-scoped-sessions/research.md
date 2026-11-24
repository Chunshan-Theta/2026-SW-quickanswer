# Research: 分頁專屬的組別身分

依據：人工驗證（2026-11-24）在同一個瀏覽器以兩個視窗加入 teamA、teamB 後，B 視窗無法送出答案；程式碼審查確認所有身分共用 `classroom_session` cookie。

## R1. 缺陷根因

- **Finding**: `setSessionCookie` 以固定名稱 `classroom_session`、`Path=/` 寫入身分。cookie 以「瀏覽器設定檔」為單位共享——同一個瀏覽器的所有分頁、以及 Chrome 的所有無痕視窗（共用一個無痕 cookie 空間）都看到同一份。第二次加入覆蓋第一次；A 視窗之後的請求帶的是 B 組身分，所以 A 的答案被記成 B 組，B 視窗再送出時 Lua 回傳 `DUPLICATE`。教師與學生共用同一個名稱，所以教師在同一瀏覽器加入學生會失去教師身分。
- **Consequence**: 修正必須讓「身分選擇」以分頁為單位，而 cookie 本身無法以分頁為單位，因此需要一個分頁持有、隨請求送出的選擇器。

## R2. 分頁身分的方式

- **Decision**: 分頁代號（seat）放在學生頁網址；身分憑證放在以 seat 命名的 HttpOnly cookie `qa_seat_<seat>`。伺服器依請求的 seat 選擇 cookie。（使用者於 clarify 選定）
- **Rationale**: 網址天生屬於分頁、重新整理後仍在；憑證仍是 HttpOnly，前端 JS（含潛在 XSS）讀不到；SSR 學生頁可以直接從 `searchParams` 取得 seat，不需改為純前端渲染。
- **Alternatives considered**:
  - sessionStorage 存 token、以 `Authorization` 標頭送出：分頁隔離天生成立，但 token 可被 JS 讀取，且 SSR 學生頁讀不到 sessionStorage，需要大幅改寫——使用者未選。
  - Cookie `Path` 依組別區分（例如 `/student/<group>`）：所有 API 路徑也得帶組別，更動所有 route 與 004 的衝突面更大，拒絕。
  - 伺服器端 session 儲存（Redis）以 seat 查詢：多一個儲存與過期清理，簽章 cookie 已足夠，拒絕（Constitution II）。

## R3. Seat 格式與 cookie 名稱

- **Decision**: `randomBytes(16).toString("base64url")` → 22 字元 `[A-Za-z0-9_-]`；驗證正則 `^[A-Za-z0-9_-]{22}$`。cookie 名稱 `qa_seat_<seat>`；字元全部屬於 RFC 6265 cookie-name 允許的 token 字元。
- **Rationale**: 128-bit 隨機值無法猜測；固定長度與字元集讓解析與驗證簡單，也避免任意輸入被拼進 cookie 名稱。
- **Alternatives considered**: UUID（含連字號 36 字元，較長且無額外好處）。

## R4. Seat 的傳遞方式

- **Decision**: `fetch` 以標頭 `x-quickanswer-seat` 傳遞；`EventSource` 無法設定標頭，改以查詢參數 `?seat=`；SSR 頁面從網址 `?seat=` 讀取。伺服器端先看標頭，沒有標頭才看查詢參數。
- **Rationale**: `getRequestSession(request)` 可從 `Request` 同時取得標頭與 URL，不需改動任何 route；自訂標頭在同源請求不觸發 CORS 預檢問題。
- **Alternatives considered**: 全部用查詢參數——POST 請求也帶 seat 於網址可行，但標頭較不易出現在存取紀錄中，且與 SSR／SSE 的需求分開表達更清楚。

## R5. 解析規則（防止退回其他身分）

- **Decision**:
  1. 請求帶 seat 且格式正確 → 只驗證 `qa_seat_<seat>`；簽章有效、未過期、`role = student`、`claims.seatId === seat` 才接受。
  2. 請求帶 seat 但格式錯誤 → 未登入（`null`）。
  3. 請求不帶 seat → 只驗證 `qa_teacher`，且 `role = teacher` 才接受。
- **Rationale**: 學生請求永遠不會意外取得教師權限（FR-005、FR-006）；把某個 seat 的 cookie 值複製到別的 seat 名稱下也無效（`seatId` 綁定）。
- **Alternatives considered**: seat 無效時退回教師 cookie——會讓壞掉的學生分頁在教師瀏覽器中變成教師，拒絕。

## R6. Cookie 數量上限

- **Decision**: 加入時讀取請求中的所有 `qa_seat_*` cookie：無效或過期者以 `Max-Age=0` 清除；有效者依 `exp` 排序，若加上新的 seat 會超過 10 個，先清除最早到期者。
- **Rationale**: 每次加入新增一個 8 小時 cookie；測試或 Demo 時反覆加入可能累積到超過瀏覽器每網域 cookie 數或 Node.js 16 KB 標頭上限。10 個足以涵蓋單機模擬多組（課程 Demo 2～4 組）。實作約 15 行，無新增設定。
- **Alternatives considered**: 不設上限只記錄限制——反覆測試數十次後所有請求會因標頭過大失敗，難以排查，拒絕。

## R7. 舊 cookie 與遷移

- **Decision**: 不再讀取 `classroom_session`；不主動清除（8 小時內自然過期）。更新後教師重新登入、學生重新加入。
- **Rationale**: 課堂活動本來就是數小時的短期狀態；相容讀取舊 cookie 會保留原本的覆蓋缺陷。

## R8. 重複的學生頁

- **Finding**: `/activity` 與 `/student/activity` 兩個頁面內容幾乎相同，加入流程只導向 `/student/activity`。
- **Decision**: `/student/activity` 為唯一學生頁；`/activity` 改為導向 `/student/activity` 並保留 `?seat=`。
- **Rationale**: 避免兩處各自實作 seat 讀取（Constitution I：合併重複邏輯）。
