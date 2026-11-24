# Data Model: 005 教師選擇回填答案與學生端正確答案公布

## AdoptionSelection（請求 body，前端狀態）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `source` | `"group"` \| `"teacher"` | 採用來源 |
| `groupId` | string（1–64） | `source = group` 時必填；必須在該題送出名單中 |
| `answers` | string[]（1–20 項，每項 trim 後 1–4000 字） | `source = teacher` 時必填；數量必須等於子題數 |

未提供 selection = `{ source: "group", groupId: <最快組別> }`。

## WritebackJob（Redis hash `writeback:job:{activityId}:{roundId}`）

既有欄位：`jobId`、`activityId`、`roundId`、`teacherId`、`questionNumber`、`winnerGroupId`（最快組別，語意不變）、`answer`（顯示文字）、`answers`（JSON string[]）、`status`、`attempt`、`errorCode`、`createdAt`、`updatedAt`、`claimedAt`。

新增欄位：

| 欄位 | 說明 |
|---|---|
| `adoptedSource` | `group` \| `teacher` |
| `adoptedGroupId` | 採用的組別；`teacher` 時為空字串 |
| `selectionKey` | `source\ngroupId\nJSON(answers)`，判斷是否同一選擇 |
| `previousAnswers` | JSON string[]：入列當下已公布的答案（無則空字串），供標記版面覆寫 |
| `revision` | 每次以新選擇（或失敗重試）排入時 +1 |

狀態轉換（每題一筆）：

```text
(none) --enqueue--> queued --worker--> running --> succeeded | retryable | failed
retryable --worker--> running
succeeded --enqueue(不同選擇)--> queued (revision+1)
failed --enqueue(任何選擇)--> queued (revision+1)
queued/running/retryable --enqueue(不同選擇)--> 拒絕 WRITEBACK_IN_PROGRESS
queued/running/retryable/succeeded --enqueue(相同選擇)--> 不變（existing）
```

## RoundState（Redis hash `round:{roundId}:state`）新增欄位

回填成功時由 `update-writeback-status.lua` 從工作複製：

| 欄位 | 說明 |
|---|---|
| `publishedSource` | `group` \| `teacher` |
| `publishedGroupId` | 組別或空字串 |
| `publishedAnswers` | JSON string[] |
| `publishedAnswer` | 顯示文字 |
| `publishedAt` | ISO 8601 |

## Snapshot（`features/activities/domain/snapshot.ts`）

```ts
interface PublishedAnswerSnapshot {
  source: "group" | "teacher";
  groupId: string | null;
  answer: string;
  answers: string[];
  publishedAt?: string;
}

interface AdoptedAnswerSnapshot {
  source: "group" | "teacher";
  groupId: string | null;
  answer: string;
  answers: string[];
}

interface ActivityRoundSnapshot {
  // …既有欄位
  winnerGroupId: string | null;          // 學生端：已結束題目一律為 null
  submissions: ActivitySubmissionSnapshot[]; // 學生端：只有自己組別
  publishedAnswer?: PublishedAnswerSnapshot; // 回填成功後（教師與學生）
  writebackJob?: { jobId; status; attempt; errorCode; adopted?: AdoptedAnswerSnapshot }; // 教師端
}
```

## 可見性規則

| 對象 | 開放中題目 | 已結束、未公布 | 已結束、已公布 |
|---|---|---|---|
| 教師 | 全部送出＋最快組別 | 全部送出＋最快組別＋回填狀態與採用答案 | 同左＋`publishedAnswer` |
| 學生 | 只有自己組別 | 只有自己組別（含順位），`winnerGroupId = null` | 同左＋`publishedAnswer` |

## 事件

| 事件 | 教師收到 | 學生收到 |
|---|---|---|
| `results.finalized` | 全部送出、`winnerGroupId` | 只有自己組別的送出，`winnerGroupId: null` |
| `writeback.status`（queued／running／retryable／failed） | 有，data 含 `adopted`（queued 時） | 不送 |
| `writeback.status`（succeeded） | 有，data 含 `published` | 投影成 `answer.published { roundId, questionNumber, published }` |
