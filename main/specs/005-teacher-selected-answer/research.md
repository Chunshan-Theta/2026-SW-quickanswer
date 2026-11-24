# Research: 005 教師選擇回填答案與學生端正確答案公布

## R1 — 回填請求如何表達教師的選擇

- **Decision**: 在既有 `POST /rounds/{roundId}/writeback` 的 body 加上可選的 `selection`：`{ source: "group", groupId }` 或 `{ source: "teacher", answers: string[] }`。未帶 `selection` 時沿用最快組別。
- **Rationale**: 不新增端點，舊用戶端（含 OpenSpec 組）與既有測試行為不變（憲章 V）；以 zod discriminated union 驗證格式與長度，Lua 再驗證「組別確實有送出」「答案數等於子題數」這些需要 Redis 狀態的規則。
- **Alternatives**: 新增 `PUT /rounds/{id}/adoption` 先儲存選擇再回填——多一個狀態與一次往返，使用者流程是「選好就回填」，不需要分開。

## R2 — 改選時用新工作 id 還是同一工作 id

- **Decision**: 每題仍只有一筆回填工作，id 維持 `activityId:roundId`；改選時在同一個 job hash 寫入新的採用答案、`revision + 1`、狀態重設為 `queued`，並重新 XADD 到 `writeback:jobs`。
- **Rationale**: snapshot、狀態查詢與既有事件都以固定 id 找工作；成功或失敗的工作在 worker 端已 XACK+XDEL，不會有舊的 stream 項目重複執行。配合 R3 的「處理中拒絕不同選擇」，同一題永遠只有一筆工作在跑，不會兩筆回填互相覆寫。`revision` 保留改選次數以利追蹤。
- **Alternatives**: 每次改選產生新 job id（`activityId:roundId:rN`）——需要在 snapshot／狀態查詢先查「最新 job id」，並處理多筆同時排隊的競態，複雜度較高且沒有額外好處。

## R3 — 冪等與處理中的規則

- **Decision**: 以 `selectionKey = source + "\n" + groupId + "\n" + JSON(answers)` 判斷是否同一選擇。
  - 最新工作為 queued／running／retryable：相同選擇 → 回傳既有工作；不同選擇 → `WRITEBACK_IN_PROGRESS`（409「目前回填處理中，請等待完成後再改選答案。」）。
  - 最新工作為 succeeded：相同選擇 → 回傳既有工作（不重寫）；不同選擇 → 重新排入。
  - 最新工作為 failed：不論選擇是否相同都重新排入（沿用 004 的重試行為）。
  - 002–004 留下、沒有 `selectionKey` 的舊工作：以 `group + winnerGroupId + answers` 還原其選擇鍵。
- **Rationale**: 滿足 FR-004／FR-005／FR-006 與 SC-005；所有判斷在單一 Lua 腳本內完成，與入列原子化。

## R4 — 學生何時、如何得知老師採用的答案

- **Decision**: worker 回報 `succeeded` 時，`update-writeback-status.lua` 在同一個原子操作內把工作的採用答案寫入 round hash（`publishedSource`／`publishedGroupId`／`publishedAnswers`／`publishedAnswer`／`publishedAt`），並在 `writeback.status` 事件的 data 加上 `published`。事件投影（projection）對學生：只有 `status = succeeded` 且帶 `published` 的 `writeback.status` 會轉成 `answer.published`（只含 roundId、questionNumber 與公布答案），其他回填事件一律不送給學生。
- **Rationale**: 只有「回填成功」才公布，符合「回填完成後」與 FR-011（處理中或失敗不影響已公布答案）；沿用單一事件與既有 stateVersion 序列，不需要額外 XADD；snapshot 由 round hash 的 `published*` 重建，重新整理與即時更新一致。
- **Alternatives**: 教師一選擇就公布——使用者明確要求「回填完成後」；另發一個獨立事件——要多一個 stateVersion 與兩次 XADD，沒有必要。

## R5 — 結束後的學生隱私規則落點

- **Decision**: 在三個出口一致套用「學生只拿到自己組別的送出、`winnerGroupId` 為 null、外加 `publishedAnswer`」：`projectActivityEvent`（`results.finalized`）、`activity-snapshot.ts` 的 `loadRound`、`results-service.ts`。教師端不變。
- **Rationale**: FR-009 要求即時事件、重新整理與 API 一致；三處原本都有「closed 後公開全部」的分支，改為同一規則並以測試鎖定（SC-002）。
- **Note**: 這改變 001／004 的「題目結束後公開所有組別答案」行為，於 contracts 標示給 OpenSpec 組。

## R6 — 標記版面（marker layout）重新回填

- **Decision**: 入列時把該題目前已公布的答案寫入工作的 `previousAnswers`；`prepareGuidedNotesWriteback` 多收一個可選參數 `previousAnswers`，當作答格內容等於「上次公布的值」（含子題標記）時，也視為同一作答格可覆寫。
- **Rationale**: 標記版面在第一次回填後，`{{answer:N}}` 標記已被答案取代，現行邏輯只接受「仍是標記」或「已等於這次的值」，改選必定 fail-closed。官方表格版面靠標題列辨識作答欄，不受影響。這個做法只放寬「本系統自己寫過的值」，其他被改動的內容仍 fail-closed。

## R7 — 教師自行輸入答案的顯示文字

- **Decision**: Lua 依 `submit-answer.lua` 相同規則組出顯示文字（題組：「（1）a；（2）b」，子題標籤取 round 的 `blanks`）；寫入工作表仍逐子題寫入「標籤＋答案」。
- **Rationale**: 學生端與教師端顯示格式與組別答案一致；工作表寫入邏輯完全沿用 002。

## R8 — 前端結構

- **Decision**: 新增純函式模組 `features/activities/domain/answer-adoption.ts`（預設選擇、比較、描述、完整性檢查）與教師端 `components/teacher/answer-adoption.tsx`（已結束題目卡片中的選擇與回填區）；`round-control.tsx` 只把原本的回填區替換為新元件。學生端在 `activity-round.tsx` 的已結束題目卡片改為顯示「你們的答案」與「正確答案」。
- **Rationale**: 把變更集中在已結束題目卡片，與同時進行的 006（活動清單、關閉房間）分開，降低合併衝突；純函式可單元測試（憲章 III）。
