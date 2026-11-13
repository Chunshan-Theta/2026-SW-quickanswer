# Quickstart: 驗證課堂搶答端到端流程

## 前置條件

- Node.js 22 LTS 與 pnpm（版本由 `packageManager` 欄位鎖定）。
- Docker Compose 或可連線的私有 Redis 7 測試實例。
- Google OAuth 測試用戶、OAuth client、已啟用 Google Picker API 的 Cloud 專案，以及一份可讀寫的測試 Guided Notes 試算表。
- 環境變數：`REDIS_URL`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI`、`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`、`NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER`、`SESSION_SECRET`、`TOKEN_ENCRYPTION_KEY`。不得提交真實值或輸出於測試 log。

## 啟動

1. 安裝相依套件：`pnpm install --frozen-lockfile`。
2. 啟動 Redis：`docker compose up -d redis`。
3. 以 `.env.local` 設定本機 OAuth callback、Redis URL 與簽章/加密金鑰。
4. 啟動應用：`pnpm dev`，在瀏覽器開啟 `http://localhost:3000`。
5. 另一個終端啟動回填 worker：`pnpm worker:sheets-writeback`。

Google Cloud 專案需啟用 Google Picker API。Picker API key 應限制為本機/部署網域與 Picker API；專案編號用於 Picker 的 `appId`。教師須透過 Picker 選取試算表，讓 `drive.file` OAuth 權限授權該檔案；瀏覽器只取得短期 access token，不會收到 refresh token。

Redis 僅供 Next.js 與 worker 在私有網路使用，不得公開到瀏覽器或外部網路。Google OAuth callback 必須與 Google Cloud Console 中註冊的 URI 完全一致；`.env.example` 僅含非機密範例，不可將真實憑證提交至版本庫。

## 驗證情境

### A. Guided Notes 動態匯入

支援的題目格式為 `1. 題目`、`Question 1: 題目` 或 `1題：題目`；每題必須有一個以相同題號標示的答案格，例如 `{{answer:1}}`、`{{blank:1}}` 或 `[[answer:1]]`。系統以答案格標記中的唯一題號數作為來源題數，並與可解析題目數比對；格式不明、題數不符或答案格歧義時會拒絕匯入。

1. 以教師身分登入，選取測試試算表與工作表。
2. 確認題目依唯一題號呈現，題數與工作表相同，並逐題檢查偵測到的答案空格。
3. 在複本中移動題目與答案空格後重新匯入；系統應重新解析新位置，而非使用舊座標。
4. 製造重複題號；系統應阻止活動建立並指出題號。
5. 對模糊映射選取預覽中的候選 slot token；確認全部題目後活動才轉為 ready；過期 token 必須被拒絕。

### B. 同步搶答及隱私

1. 開啟一個教師瀏覽器與至少兩個不同組別的學生 session。
2. 教師開啟題目；三端均應在 2 秒內看到相同開放階段。
3. 兩組先後提交；教師端顯示即時組別狀態/排序，學生端只能看到自組送達狀態與答案。
4. 關閉題目；所有仍連線用戶收到關閉階段，學生端此時才取得最終結果。
5. 重送同組答案或在關閉後提交；服務應拒絕且不得改變首答、序號或 winner。

### C. 競態與擴充

1. 使用 integration test 對同一 round 發送併發提交與 close 操作；每組最多一份提交、`acceptedOrder` 唯一且只存在一個 winner。
2. 啟動 500 個 SSE clients，重複開啟/關閉事件；至少 95% 仍連線用戶在 2 秒內收到正確階段，任何學生事件都不可含他組作答資訊。
3. 中斷 SSE 後重連；先取得依角色過濾的 Redis 最新狀態快照，再接收較新版本事件，不得退回舊 phase。
4. 暫停 SSE reader 並產生 phase event；恢復讀取後應由 Redis Stream 補送，不依賴 Pub/Sub 通知成功。用學生身份重連時，snapshot 與 replay 均不得含他組資料。

### D. Google Sheets 回填

1. 教師結束回合後，在教師控制台選擇「回填得獎答案」。
2. API 應立即回覆 queued job，而不是等待外部 Sheets 呼叫完成。
3. worker 僅將 winner 的答案寫入掃描並確認的目標；確認非目標格未變。
4. 模擬 token 撤銷或 Sheets API 暫時失敗；job 顯示可理解狀態並重試，成功後重播同一 job 不會重複或覆寫錯誤資料。
5. 在 job 排隊期間移動/修改答案空格；worker 重新掃描時應偵測 fingerprint 變化並 fail closed。最後掃描與 Google batch update 間無法原子鎖定，驗證測試需避免於該短暫寫入期間外部編輯工作表。
6. worker 讀取 job 後於 ack 前終止；另一 worker 使用 `XAUTOCLAIM` 回收並完成該 job，結果不得重複寫到其他答案格。

## 檢查命令

- 單元測試：`pnpm test:unit`
- API 合約測試：`pnpm test:contract`
- Redis 整合測試：`pnpm test:integration`
- 安全邊界回歸測試：`pnpm test:security`
- 瀏覽器端到端測試：`pnpm test:e2e`
- 500 SSE 連線負載測試：`pnpm test:load`
- 靜態品質檢查：`pnpm lint && pnpm typecheck`

Redis 整合與 500 SSE 負載測試需要可連線的 Redis；Sheets OAuth 測試流程需要專用 Google OAuth 測試帳戶及工作表。Playwright 對 Picker、匯入及回填 API 使用測試替身；本機未連接真實 Google OAuth/Sheets 帳戶。預期：所有可用測試通過；競態測試僅產生唯一受理順序與 winner；500 連線測試符合規格中的同步延遲；Sheets 權限/映射錯誤不得被回報為成功。

## Diagram alignment verification

已核對 `diagrams/component.puml`、`diagrams/class.puml` 與 `diagrams/sequence.puml`：教師/學生頁面呼叫 Route Handlers；Activity、Round、Submission 與 SheetBinding 由活動服務及 Redis adapter 表示；回合轉換與版本化事件由 Lua 原子提交；SSE 讀取 Stream 後依角色投影；Google Sheets 僅由伺服器 adapter 存取；教師關閉回合後才可排入由 worker 重播/確認的回填工作。瀏覽器端無 Redis 或 refresh token 依賴。
