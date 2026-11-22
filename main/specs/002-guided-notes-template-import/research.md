# Research: 官方 Guided Notes 範本匯入與逐題回填

依據：人工驗證（2026-11-23）以官方「單題範本」與「題組+單題範本」複本實測，以及既有程式碼審查。

## R1. 表格版面偵測

- **Decision**: 由上而下掃描，第一個同時含「題號」欄名與「作答」或「答案」欄名的列為標題列（欄名比對前移除所有空白）；「題目」欄名為選用（PDF 規定不要求匯入題目敘述）。標題列決定題號欄、題目欄、作答欄的欄索引；標題列以上內容一律忽略。
- **Rationale**: 官方範本第 4 列為 `題號｜題目(C:F 合併)｜作答(G:H 合併)`；以欄名定位欄位可容忍插入欄、移動列，符合「不得使用固定座標」。
- **Alternatives considered**: 以欄位內容型態推測（數字欄＝題號）——對空白作答格無法判斷作答欄，拒絕。

## R2. 合併儲存格

- **Decision**: `spreadsheets.get(includeGridData)` 同時讀取 `sheets[].merges`，轉成 `{ startRow, endRow, startColumn, endColumn }`（end 為不含）傳給解析器；解析器以「合併範圍左上角」作為該範圍內任何儲存格的代表（值與作答格位置皆然）。
- **Rationale**: Google Sheets API 只在合併範圍左上角回傳值；題組範本以 B5:B6 垂直合併題號、單題範本以 G:H 水平合併作答格。回填寫入左上角即可顯示在整個合併範圍。
- **Alternatives considered**: 忽略合併、只看左上角文字——會把題組第二列誤判為「無題號列」。

## R3. 題組列分組規則

- **Decision**: 標題列下方逐列處理：
  1. 題號欄（合併解析後）有有效題號 → 屬於該題號；若與上一列共用同一個合併題號格，或與上一個非空白列為相鄰列且題號相同 → 同一題的下一列。
  2. 題號欄空白、緊接在題目列下方（無空白列間隔），且題目欄有文字或作答格有子題標記 → 上一題的子題列。
  3. 其他空白列 → 分隔列，結束目前題目。
  4. 每題的作答格為各列作答格（合併解析後）去重後依列序排列；1 格＝單題，≥2 格＝題組。
  5. 不相鄰的相同題號 → `duplicate_question_number`。
- **Rationale**: 涵蓋官方題組範本（合併題號）與教師手動未合併的變體；空白列是官方範本的題目分隔方式。
- **Alternatives considered**: 只接受合併題號——教師自製學習單常不合併，過於脆弱。

## R4. 題號格式

- **Decision**: 題號欄接受 `1`、`1.`、`1、`、`第1題`、`Q1`（前後空白忽略）；其他非空白內容 → `unrecognized_question_row`（附列號）。題號需自 1 連續且唯一（沿用 001）。
- **Rationale**: 官方範本題號為純數字；寬鬆接受常見寫法可降低助教自製學習單失敗率。

## R5. 子題標記

- **Decision**: 作答格文字開頭符合 `^[（(]\s*\d+\s*[)）]` 時記為該 blank 的 `label`（保留原字元）；回填值＝`label + 答案`。單題或無標記子題的 `label` 為 null，回填值＝答案。顯示用標籤＝`label ?? （序號）`。
- **Rationale**: 題組範本作答格內含「（1）」「（2）」；保留標記讓回填結果與原學習單一致（FR-014）。回填後標記仍在開頭，故重新解析時結構不變。

## R6. 結構快照取代整張工作表指紋

- **Decision**: `structureFingerprint = sha256(JSON(structure))`。表格版面：標題列位置與三個欄索引、各題 `{題號, 起訖列, blanks 位置}`；記號版面：各題 `{題號, 題目格位置}`。**不含任何作答格內容、子題標記與題目文字**。匯入與答案格確認時保存；回填前重新計算並比對，不同則 fail closed。
- **Rationale**: 001 以整張工作表 JSON 雜湊比對，第一題回填即改變雜湊，導致其後回填全部 409（實測重現）。結構快照只在「題目結構」改變時失效，符合 FR-009。記號版面在回填後記號會被答案取代，所以結構只取題目格位置，目標格另以「仍為該題記號或已等於預期值」驗證。
- **Alternatives considered**: 每次回填成功後更新活動中的整表指紋——並行回填與教師其他編輯仍會互相干擾，拒絕。

## R7. 題組答案的提交與判定

- **Decision**: 提交 API 接受 `answers: string[]`（並相容舊的 `answer: string` → `[answer]`）。`open-round.lua` 將子題 `blanks`（label、prompt）與 `blankCount` 存入回合 hash 並放入 `phase.changed` 事件；`submit-answer.lua` 在分配順位前驗證 `#answers == blankCount` 且皆非空白，否則回傳 `INCOMPLETE_ANSWERS`（不消耗順位）。提交記錄同時保存 `answers` 與顯示用 `answer`（題組為「（1）a；（2）b」）。
- **Rationale**: 驗證放在 Lua 內與順位分配同一原子操作，避免競態；保留 `answer` 欄位使既有結果顯示、事件投影與測試不中斷（Constitution V）。

## R8. 回填多格與冪等

- **Decision**: 回填工作保存 `answers`（JSON）；worker 依題目 blanks 產生多個目標 `{位置, 值}`，若全部目標格已等於預期值則視為已完成（重播冪等），否則一次 `values.batchUpdate`（RAW），寫後重讀確認每個目標格內容等於預期值且結構快照未變。移除 `expectedPostFingerprint` 機制。
- **Rationale**: 以目標格內容判斷冪等比整表雜湊更精確，也不受其他題目的回填影響。

## R9. 分頁清單

- **Decision**: 新增 `GET /api/sheets/[spreadsheetId]/tabs`，伺服器以 `spreadsheets.get({ fields: "sheets.properties(sheetId,title,index)" })` 取得分頁；前端在 Picker 選檔後呼叫，單一分頁自動選取，多分頁以名稱下拉選單選擇；移除 gid 輸入框。
- **Rationale**: `drive.file` 授權已涵蓋 Picker 選取的檔案；只取 properties 不讀格資料，成本低。

## R10. 已結束題目清單

- **Decision**: `open-round.lua` 在活動 JSON 記錄 `roundIdsByQuestion[題號] = roundId`；教師活動查詢回傳 `completedRounds`（題號、題目、得獎組、各組答案、回填狀態）。教師控制台列出目前回合以外的已結束題目並提供個別回填。
- **Rationale**: FR-008/FR-015 要求任一已結束題目都能回填；001 只在「目前回合」顯示回填按鈕。
