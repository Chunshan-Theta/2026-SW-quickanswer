# Data Model: 官方 Guided Notes 範本匯入與逐題回填

對應 `diagrams/002-class.puml`。僅列出本功能新增或變更的部分；其餘沿用 `specs/001-live-classroom-quiz/data-model.md`。

## Parser domain (in-memory)

### WorksheetGrid（變更）
| Field | Type | Notes |
|---|---|---|
| sheetId | number | |
| title | string | 分頁名稱 |
| rows | WorksheetRow[] | 沿用 |
| merges | MergeRange[]? | **新增**；未提供時視為無合併 |

### MergeRange（新增）
`{ startRow, endRow, startColumn, endColumn }`，0-based，end 不含。

### SheetTab（新增）
`{ sheetId: number, title: string, index: number }`

### WorksheetLayout（新增）
| Field | Type | Notes |
|---|---|---|
| kind | `"table" \| "marker"` | 偵測到標題列 → table |
| headerRow | number? | table only |
| numberColumn / promptColumn / answerColumn | number? | promptColumn 可缺 |

### ParsedQuestion（變更）
| Field | Type | Notes |
|---|---|---|
| questionNumber | string | 正規化（去前導 0） |
| prompt | string | 單題＝題目；題組＝各子題敘述以「／」串接 |
| kind | `"single" \| "group"` | blanks.length > 1 → group |
| firstRow / lastRow | number | 0-based 列範圍（表格版面） |
| blanks | ParsedBlank[] | ≥ 1 |
| mappingStatus | MappingStatus | 所有 blank confirmed → confirmed；任一 missing → missing；否則 ambiguous |
| answerSlot / candidateSlots | | **相容欄位**＝第一個 blank 的值 |

### ParsedBlank（新增）
| Field | Type | Notes |
|---|---|---|
| label | string \| null | 作答格開頭的「（n）」標記 |
| prompt | string | 子題敘述（單題＝題目） |
| answerSlot | CellLocation \| null | confirmed 時唯一位置 |
| candidateSlots | CellLocation[] | 記號版面可能多個 |
| mappingStatus | MappingStatus | |

### WorksheetIssue（變更）
新增 `rowNumber?: number`（1-based，對應試算表列號）與代碼 `no_questions_found`、`header_missing_answer_column`。

### WorksheetParseResult（變更）
新增 `layout: WorksheetLayout` 與 `structure`（可序列化的結構描述，見 R6）。

## Persisted (Redis `activity:{id}:meta` JSON)

### ImportedActivity（變更）
| Field | Change |
|---|---|
| fingerprint | **移除**（改為 structureFingerprint） |
| structureFingerprint | **新增** string |
| layout | **新增** `"table" \| "marker"` |
| questions | ImportedQuestion[]（形狀變更） |
| roundIdsByQuestion | **新增** `Record<questionNumber, roundId>`，由 open-round.lua 寫入 |
| completedQuestionNumbers | 沿用 |

### ImportedQuestion（變更）
| Field | Type |
|---|---|
| questionNumber | string |
| prompt | string |
| kind | `"single" \| "group"` |
| mappingStatus | MappingStatus（彙總） |
| blanks | ImportedBlank[]（≥ 1） |

### ImportedBlank（新增）
| Field | Type | Notes |
|---|---|---|
| label | string \| null | |
| prompt | string | |
| mappingStatus | MappingStatus | |
| candidates | `{ token, location }[]` | ≥ 1（missing 時不會建立活動） |
| selectedToken | string \| null | |

**Validation**: 不得儲存空陣列（Lua cjson 會改寫為 `{}`）；blanks 與 candidates 皆 ≥ 1。

## Round（Redis hash `round:{id}:state`，變更）
新增欄位 `kind`、`blankCount`（字串數字）、`blanks`（JSON：`[{ label, prompt }]`）。

## Submission（Redis hash `round:{id}:submissions` 值，變更）
| Field | Type | Notes |
|---|---|---|
| groupId | string | |
| answers | string[] | **新增**；長度＝blankCount，皆非空白 |
| answer | string | 顯示文字：單題＝answers[0]；題組＝`標籤1+a1；標籤2+a2` |
| acceptedOrder / acceptedAt | | 沿用 |

## WritebackJob（Redis hash，變更）
| Field | Change |
|---|---|
| answers | **新增** JSON string[] |
| answer | 保留（顯示） |
| expectedPostFingerprint | **移除** |

## State transitions

Activity / Round 狀態機不變（001）。新增規則：`submit-answer` 在 `INCOMPLETE_ANSWERS` 時不改變任何狀態、不遞增 `nextOrder`、不寫事件。
