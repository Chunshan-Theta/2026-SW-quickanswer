# Research: 線上課堂搶答系統

## 決策摘要

### Next.js App Router 與單體式部署

**決策**：採用單一 Next.js App Router 應用，使用 Node.js runtime。教師端與學生端由同一應用提供；Route Handlers 負責活動 API、SSE 與回填請求，Server Components 負責頁面呈現。核心變更操作統一走 Route Handlers，避免 Server Actions 與公開 API 出現兩套驗證/權限路徑。

**理由**：符合使用者指定的全棧框架，且單一應用足以支援約 500 個同時連線的課堂使用者。SSE 長連線需由支援 HTTP streaming 的 Node.js 部署承載，不部署在會緩衝或限制長連線的 serverless 路由環境。

**替代方案**：前後端分離或微服務會增加部署、權限與跨服務除錯成本；不符合目前只實作核心流程的範圍。

### SSE 即時同步

**決策**：採用 Server-Sent Events 傳送伺服器至瀏覽器的活動階段和結果事件；開啟、結束、提交、匯入與回填使用具權限驗證的 HTTP POST/GET Route Handlers。Round 狀態轉換與 `activity:{activityId}:events` Redis Stream 的 `XADD` 在同一 Lua script 內提交，Activity-wide `stateVersion` 作為事件版本與 SSE id。每個 app instance 維護獨立 `XREAD` cursor 讀取事件 Stream，轉送至本機 SSE clients；不以 consumer group 分發廣播事件。重新連線時先開始讀取/緩衝事件，再取得角色過濾後的 Redis snapshot，最後只送出 snapshot 版本之後的事件。若 Last-Event-ID 超出保留範圍，傳送最新的角色過濾快照。

**理由**：即時需求以伺服器推送狀態為主，提交仍由 HTTP 請求傳送。SSE 保留瀏覽器原生重連能力，避免在 Next.js 導入另一個 WebSocket server 與自訂升級代理。

**替代方案**：Socket.IO 適用雙向低延遲訊息，但目前沒有需要伺服器主動向瀏覽器以外方向傳送的功能；會增加連線管理與部署複雜度。

### Component Diagram 與 Class Diagram 對應

**決策**：保留 `component.puml` 的模組責任：Teacher Portal / Student Portal 對應 Next.js App Router 頁面；Questions and Results 對應 Route Handlers 與應用服務；Activity Phase Sync 對應 SSE 發佈/授權；Activity Data 對應私有 Redis；Google Sheets Read/Write 對應伺服器端 `googleapis` adapter。Class Diagram 的 Activity、Question、Round、Group、Submission、GuidedNotesSheet、AnswerSlot 分別由領域型別及 Redis 文件表示，不再拆分成獨立服務。

**理由**：圖中 UI 到 Sheets/Quiz 模組的箭頭表示應用層操作，不代表瀏覽器直接連 Google Sheets 或 Redis。Next.js Node server 是唯一入口；圖表明確呈現 server boundary，避免模組依賴方向被誤讀。

### Redis 原子判定與即時事件

**決策**：使用 Redis Lua script 原子地檢查回合仍為 `open`、拒絕同組重複提交、配置唯一遞增的受理序號、保存答案、更新排序集合，並以 `SET ... NX` 記錄首位得獎組別。關閉回合也由 Lua script 寫入 `closed` 並固定結果。

**理由**：Redis 執行 Lua script 時不會交錯執行其他命令；序號而非用戶端時間戳能明確決定同時提交的先後。關閉與提交由同一 Redis 寫入序列裁定，避免結束後仍有答案被接受。

**替代方案**：只用用戶端時間戳或多個未包在同一原子流程中的 `SETNX`/`ZADD`，在競態時可能產生重複名次、漏存答案或在關閉後接受答案。

### Redis Streams、SSE 與非同步回填

**決策**：Redis Stream 是可重讀的即時事件來源；每個 Next.js instance 以獨立 cursor `XREAD` 廣播狀態事件，SSE Gateway 依角色/組別投影事件。可選 Pub/Sub 只能作為低延遲喚醒提示，Stream 才是可靠資料來源。回合結束後，教師依 Sequence Diagram 的 optional writeback 流程觸發回填；Route Handler 將工作寫入 Redis Stream consumer group，worker 使用 `googleapis` 執行並以回填 idempotency key 去重。worker 以 `XAUTOCLAIM` 重新領取逾時的 pending 工作，成功後才 `XACK`。

**理由**：狀態更新與事件 `XADD` 原子提交，避免寫入狀態成功但通知遺失；各 app instance 獨立讀取同一 Stream，不會因 consumer-group load balance 讓部分 instance 漏掉事件。版本化 snapshot 供過期重連恢復。回填 Stream 保留待處理工作，`XAUTOCLAIM` 回收 worker 在處理中斷線留下的 pending 訊息。回填操作仍遵循圖中的教師觸發順序，實際 Google Sheets 寫入由後端非同步執行。

**替代方案**：只用 Pub/Sub 事件會在 subscriber 暫停/斷線時遺失通知；以單一 consumer group 分發 SSE 事件會使其他 app instance 的瀏覽器漏收。新增外部 queue 對此單一功能不具比例效益。

### Google Sheets 授權與動態定位

**決策**：教師透過 Google OAuth 選取工作表，伺服器端以 `googleapis` 讀取完整使用範圍的 grid data、題號與答案空格標記；解析結果以 opaque slot token 顯示在匯入預覽。模糊配對先建立 `mapping_review` 活動，教師可透過確認 API 選取掃描候選空格；全部題目確認後才轉為 `ready`。回填時重新讀取並驗證題號/答案標記及掃描指紋，再以當次掃描結果動態導出的範圍更新；不得在程式、設定或 API 合約寫入固定 A1 座標。更新使用 RAW 值輸入，保留非目標儲存格。

**理由**：完整掃描與預覽可配合題數、欄列位置不同的 Guided Notes，同時在歧義時 fail closed，並提供明確解除歧義流程。Google Sheets API 沒有任意儲存格 compare-and-swap；worker 在寫入前重新掃描並比對指紋，若目標在排隊期間已變動即拒絕寫入。工作表若在最後驗證與 batch update 的極短間隔由外部使用者同時編輯，無法由應用端完全序列化；此為已知外部服務限制，驗收假設該短暫寫入期間來源工作表不被編輯。伺服器保存授權憑證；瀏覽器不接觸 Google refresh token 或 Redis。

**替代方案**：固定儲存格座標或只假設答案位於題目右側，無法滿足題目位置改變及不得硬編碼的要求。

### Redis 保留與部署界線

**決策**：Redis 使用私有網路、ACL/TLS 與伺服器端憑證；瀏覽器僅連 Next.js。活動/結果採可配置 TTL（初始預設 7 天）；事件 Stream 依活動保留期設定 trim。回填 Stream 訊息直到成功確認才刪除；worker 啟動及週期性透過 `XAUTOCLAIM` 回收逾時 pending 工作。Redis 啟用受管理備份/AOF 以降低重啟期間資料遺失風險。

**理由**：Redis 是搶答期間的權威即時狀態，不是公開資料服務；結果需在活動結束後仍可供師生檢視，回填工作則需可恢復。

**替代方案**：將 Redis 暴露給瀏覽器、只依賴 Pub/Sub，或使用沒有 pending recovery 的 Stream consumer group，會繞過後端角色授權或造成事件/工作遺失。

## 圖表流程核對

1. Teacher Portal 匯入 Guided Notes，伺服器讀取並驗證題數/映射；錯誤時阻止活動開始。
2. 教師開啟題目後，Redis 狀態改為 `open`，Activity Phase Sync 透過 SSE 同步階段。
3. 學生答案進入 Quiz Adjudication；Lua script 原子記錄順序、winner 與事件 Stream entry。教師收到各組即時狀態，學生只收到自組回執；重連 snapshot 也使用同一角色/組別投影。
4. 教師結束題目後 Redis 固定結果，Activity Phase Sync 對學生公開最終結果。
5. Sequence Diagram 的 optional writeback 仍由教師在結束後觸發；後端將工作放入 Redis Stream，worker 以 `XAUTOCLAIM` 恢復逾時工作並非同步回填原工作表。

## 未決事項

無。版本、服務供應商與實際容量數值在實作啟動時以鎖定檔及部署環境固定；本計畫採 Next.js Node runtime、Redis、SSE 及約 500 個同時連線作為驗收基準。
