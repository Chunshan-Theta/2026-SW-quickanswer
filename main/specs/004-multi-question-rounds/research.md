# Research: 多題同時開放搶答與教師題目控制介面

## R1. 開放中回合的狀態模型

- **Decision**: 活動 JSON 新增 `openRoundIdsByQuestion`（`{ "題號": "roundId" }`），只在至少一題開放時存在；移除 `currentRoundId`。
- **Rationale**: 所有回合轉換本來就在 Lua 中原子改寫活動 JSON，把開放集合放在同一份 JSON 不需新增 key 或 TTL 管理；以題號為鍵可 O(1) 判斷「此題是否已開放」「此回合是否為該題的開放回合」；物件在 `cjson` 下正確序列化（空表會變 `{}`，對物件而言仍正確），且空時直接移除欄位，避免 `[]`／`{}` 混淆。與既有 `roundIdsByQuestion` 命名一致。
- **Alternatives considered**: 
  - 獨立 Redis SET `activity:{id}:open-rounds`：多一個 key、TTL 與一致性要維護，且活動 JSON 仍要更新。
  - 由 `roundIdsByQuestion − completedQuestionNumbers` 推導：沒有顯式狀態，判斷依賴兩個欄位的不變式，閱讀與除錯都較難。
- **Migration**: 舊活動若有開放中的 `currentRoundId` 不做移轉（活動 TTL 7 天、僅課堂 Demo 使用）；Lua 開放／結束時會順手移除殘留的 `currentRoundId`。

## R2. 一次開放多題（全有或全無）

- **Decision**: `open-rounds.lua` 先驗證所有請求題目（存在、作答格已確認、未結束、未開放、請求內不重複），任一失敗即回傳 `{ error, questionNumber }` 且不寫入；全部通過才寫入每個回合 hash、更新 `openRoundIdsByQuestion` 與 `roundIdsByQuestion`，並為每個回合 XADD 一個 `phase.changed`，每個事件各自遞增 `stateVersion`。
- **Rationale**: Lua 腳本在 Redis 中原子執行，驗證與寫入之間不會有其他命令插入；SSE 讀取端要求 `stateVersion` 連續，逐回合一個版本可沿用既有事件與用戶端處理。
- **Alternatives considered**: 新事件 `rounds.opened`（一次帶多題）— 需要改投影、重播與兩個用戶端；逐題呼叫舊腳本 — 無法保證全有或全無。

## R3. 提交只接受「該題目前開放中的回合」

- **Decision**: `submit-answer.lua` 以回合 hash 的 `questionNumber` 查 `openRoundIdsByQuestion`，必須等於請求的 `roundId` 且回合 phase 為 `open`，否則 `ROUND_CLOSED`。
- **Rationale**: 同時確認「回合屬於此活動」與「回合仍開放」；順位（`nextOrder`）、得獎（`round:{id}:winner`）與提交 hash 本來就是逐回合的 key，所以各題順位天然獨立，不需更動。

## R4. 結束單題與一次結束全部

- **Decision**: 單一 `close-rounds.lua` 結束 1..n 個回合：`strict` 模式（單題結束）遇到非開放回合即回傳 `ROUND_CLOSED`；`open-only` 模式（一次結束全部）略過已被結束的回合，沒有任何可結束的回合時回傳 `NO_OPEN_ROUNDS`。新增 `POST rounds/close-all`：伺服器先讀活動 JSON 取得開放回合 id（並檢查教師身分），再以宣告好的 keys 呼叫腳本，腳本內重新驗證。
- **Rationale**: 一份結束邏輯（收集提交、決定得獎、更新完成清單、事件）避免兩份 Lua 重複；腳本存取的 key 都事先宣告。讀取與 EVAL 之間若有題目被結束會被略過；在那之後才開放的題目不屬於教師按下「結束全部」時看到的開放題目，因此不結束是正確行為。
- **Completion**: 結束後若所有題目都已完成且沒有開放中題目，活動 `phase` 設為 `completed`。

## R5. 快照形狀

- **Decision**: `ActivitySnapshot` 改為 `{ activityId, phase, stateVersion, rounds: ActivityRoundSnapshot[] }`，`rounds` 為活動所有回合（開放中＋已結束），依題號排序；每個回合新增 `openedAt`、`closedAt`。學生在回合開放中只看到自己組的提交，結束後看到全部；教師另含 `writebackJob`。教師頁面資料的 `currentRound`／`completedRounds` 合併為同一個 `rounds`。
- **Rationale**: 用戶端以 `roundId` upsert 即可處理所有事件；學生需要同時顯示開放中題目與已結束結果，教師需要每題卡片的狀態，一個清單滿足兩者。
- **Breaking change**: 移除 `currentRound`（概念已不存在）。遷移方式：`currentRound` → `rounds.filter(r => r.phase === "open")`；記錄於 `contracts/http-api.md`。

## R6. 用戶端狀態更新

- **Decision**: 新增純函式模組 `features/activities/domain/round-state.ts`：`applyRoundOpened`、`applySubmission`、`applyRoundClosed`、`applyWritebackStatus`、`questionStatus`、`formatElapsed`、`sortRounds`。教師與學生元件都只呼叫這些函式。
- **Rationale**: 事件套用邏輯可單元測試（重複事件、未知回合、順位排序），兩個元件不再各寫一份；模組沒有伺服器依賴，符合瀏覽器／伺服器邊界測試。

## R7. 教師題目卡片介面

- **Decision**: 單欄 `<ol>` 卡片清單；工具列 `position: sticky` 顯示已選題數、「開放所選題目」、「結束全部開放中」；只有狀態為「未開放」的題目有勾選框（`aria-label="選取第 N 題"`）；題目與子題敘述使用 `white-space: pre-wrap` 與 `overflow-wrap: anywhere`；開放中卡片展開即時排名（每組順位、答案或等待作答）與「結束本題」，標示已開放時間（只有在有開放題目時每秒更新）；已結束卡片顯示得獎組別、所有組別結果（可展開）與回填操作。360px 寬時工具列按鈕換行、排名列改為兩欄。
- **Rationale**: 依使用者選定的預覽版面；勾選與卡片狀態可由 `questionStatus` 推導，不需另存狀態。
- **Alternatives considered**: 左右兩欄（清單＋看板）— 使用者未選；保留下拉式選單 — 使用者明確不要。

## R8. 回填失敗後重新回填

- **Decision**: `enqueue-writeback.lua` 在既有工作狀態為 `failed` 時，以同一個 jobId 重新排入（重設 `status=queued`、`attempt=0`、清除 `errorCode`，重新 XADD 至工作 Stream 並發出 `writeback.status`）；其他狀態維持冪等回傳既有工作。
- **Rationale**: 回填失敗多半是學習單結構被改動，教師修正後需要能重試；worker 只略過 `succeeded`／`failed` 的工作，重設為 `queued` 後會正常處理。冪等性仍保護處理中與已成功的工作。

## R9. 與 OpenSpec 小組的相容性

- **Decision**: `POST rounds/open` 接受 `{ questionNumbers: string[] }`（回傳 `{ rounds, stateVersion }`）與舊的 `{ questionNumber }`（回傳舊的單一回合物件）；單題結束、提交、回填路由的請求與回應不變；SSE 事件名稱與資料不變，只有 `activity.snapshot` 的形狀改變。
- **Rationale**: 憲章 V 要求保留既有公開契約；舊請求得到舊回應最直接，不需要條件式混合格式。
