# Data Model: 線上課堂搶答系統

## Activity

教師建立的一次課堂活動，綁定一份來源 Guided Notes 工作表。

| 欄位 | 型別/意義 | 規則 |
|---|---|---|
| `activityId` | 隨機不可猜識別碼 | 建立後不可變 |
| `teacherId` | 教師身份識別碼 | 必須等於已驗證 session 身份 |
| `phase` | `draft`, `ready`, `active`, `completed` | 僅由教師授權的狀態操作轉換 |
| `stateVersion` | 活動範圍單調遞增整數 | 每筆狀態/事件變更原子遞增，供 SSE id、重播與快照版本比較 |
| `spreadsheetId`, `sheetId` | Google spreadsheet 與工作表識別碼 | 伺服器持有，瀏覽器不得直接讀寫 Sheets API |
| `questionIds` | 有序題目識別碼 | 必須與來源題數一致且題號唯一 |
| `currentRoundId` | 當前回合識別碼或空值 | 同一時間最多一個開放回合 |
| `createdAt`, `expiresAt` | 建立/清理時間 | Redis TTL 由部署設定 |

## Question

來源工作表中的單題簡答題。

| 欄位 | 型別/意義 | 規則 |
|---|---|---|
| `questionId` | 內部識別碼 | 在 activity 內唯一 |
| `questionNumber` | 來源題號 | 必填、唯一、保留原始題號格式 |
| `prompt` | 題目敘述 | 匯入後顯示，不接受學生修改 |
| `answerTarget` | 從當次工作表掃描取得的暫存映射 | 不可來自程式固定座標；回填前須重新驗證 |
| `mappingStatus` | `confirmed`, `ambiguous`, `missing` | 非 `confirmed` 不得開賽/回填 |

## Group and Participant

`Group` 是活動內的組別；`Participant` 是加入活動的學生 session。

- `groupId` 在活動內唯一；`displayName` 由教師設定。
- 每個學生 session 在活動中只綁定一組；不得由提交 body 指定/冒用另一組 `groupId`。
- 活動加入碼只用於加入流程；加入後由伺服器簽發 HttpOnly session cookie。

## Round

單一題目由教師開啟至結束的搶答回合。

| 欄位 | 型別/意義 | 規則 |
|---|---|---|
| `roundId` | 隨機不可猜識別碼 | 每題回合唯一 |
| `activityId`, `questionId` | 所屬活動與題目 | 建立後不可變 |
| `phase` | `ready`, `open`, `closed` | 只允許 `ready -> open -> closed` |
| `openedAt`, `closedAt` | 伺服器時間 | 不採用學生裝置時間判序 |
| `nextOrder` | 單調遞增整數 | 由原子 script 配置；唯一決定受理順序 |
| `winnerGroupId` | 組別識別碼或空值 | 第一份有效受理答案；只可設定一次 |

## Submission

每組每回合最多一份已受理答案。

| 欄位 | 型別/意義 | 規則 |
|---|---|---|
| `roundId`, `groupId` | 回合、組別複合識別 | 每組每回合唯一 |
| `answer` | 簡答文字 | 長度上限由 server schema 固定；去除首尾空白後不得為空 |
| `acceptedOrder` | 正整數 | 原子配置，排序分數；不使用 client timestamp |
| `acceptedAt` | Redis/server 時間 | 顯示與稽核用，不作為 tie-breaker |
| `isWinner` | 布林 | 等於 `groupId == winnerGroupId` |

## SheetBinding

動態匯入時建立的題號到答案目標映射。

- 識別欄位：`activityId`, `questionNumber`。
- 儲存來源 `spreadsheetId`、`sheetId`、掃描所得目標範圍、偵測到的題號/空格標記，以及確認狀態。
- 保存掃描時的目標映射指紋與 opaque 候選 slot token；token 只代表本次掃描候選，不含可由 client 指定的 A1 座標。
- 目標範圍是執行時從 Sheets grid data 導出的資料，不是程式常數；回填前重新掃描並比對指紋，若工作表在排隊期間已改動則 fail closed。
- 模糊映射進入 `mapping_review`；教師以確認 API 選擇候選 slot，只有全部題目映射為 `confirmed` 後活動才能 `ready`。
- Sheets API 沒有任意 cell compare-and-swap；寫入前檢查可偵測排隊期間的改動，但最後掃描與 batch update 間仍假設工作表未被外部使用者同時編輯。

## WritebackJob

教師在回合結束後觸發的非同步工作。

| 欄位 | 型別/意義 | 規則 |
|---|---|---|
| `jobId` | 唯一工作識別碼 | 以 `activityId:roundId` 作冪等鍵 |
| `status` | `queued`, `running`, `succeeded`, `retryable`, `failed` | 狀態轉換有稽核時間 |
| `roundId`, `winnerGroupId` | 固定回合結果 | 寫入時不得重新選出 winner |
| `attempt` | 重試次數 | 指數退避；權限/映射永久錯誤不自動無限重試 |
| `errorCode` | 可呈現的錯誤分類或空值 | 不儲存 OAuth token 或敏感回應內容 |
| `claimedAt` | worker 領取時間 | worker 在處理中斷線後，由 `XAUTOCLAIM` 回收逾時 pending 工作 |

## ActivityEvent

以 `stateVersion` 排序的 server-generated event，從 Redis Stream replay/fanout 至 SSE clients。

- `eventId`/`stateVersion` 單調遞增；`activityId`、事件種類與最小必要 payload 由伺服器產生。
- 提交或 phase transition 的狀態變更和 `XADD` 同一 Redis Lua script 原子提交。
- Redis Stream 原始記錄不做角色裁切；SSE Gateway 對每個 session 先執行教師/學生/組別投影，再序列化送出。
- 每個 app instance 使用獨立 `XREAD` cursor 讀取，不能以共享 consumer group load balance 廣播事件。

## Redis Layout and Atomicity

- `activity:{activityId}:meta`: Activity 狀態、owner、worksheet 參照及 `stateVersion`。
- `activity:{activityId}:questions`: 題號與匯入資料；答案目標是動態掃描結果。
- `round:{roundId}:state`: Round 狀態、序號計數器、winner 與版本。
- `round:{roundId}:submissions`: Hash，`groupId -> Submission`。
- `round:{roundId}:order`: Sorted Set，member 為 `groupId`、score 為原子 `acceptedOrder`。
- `round:{roundId}:winner`: 首個得獎 `groupId`，只由 Lua script 以 `SET ... NX` 設定。
- `writeback:jobs`: Redis Stream，使用 consumer group、冪等工作識別、成功後 ack、退避重試及 `XAUTOCLAIM` 回收逾時 pending entry。
- `activity:{activityId}:events`: Redis Stream；每次提交/phase 變更與狀態在同一 Lua script `XADD`，供每個 Next.js instance 各自 `XREAD` 廣播及重連 replay。Pub/Sub 僅可作為提示，不是事件真值。

提交 script 同一原子區段內檢查 `phase == open`、檢查組別尚未提交、配置唯一序號、保存答案、更新排序集合、設定第一名、遞增 `stateVersion` 並 `XADD` 事件。Close script 同理原子關閉、固定結果並新增 `results.finalized` event；先完成的 script 決定答案是否在關閉前受理。SSE 重連先建立 Stream reader 再讀取依角色投影的 Redis snapshot，緩衝期間收到的事件只送出 snapshot `stateVersion` 之後的版本。所有 Redis 存取僅由後端服務帳號執行。
