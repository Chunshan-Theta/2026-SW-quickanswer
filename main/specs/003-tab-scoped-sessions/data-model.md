# Data Model: 分頁專屬的組別身分

對應 `diagrams/003-class.puml`。本功能不改 Redis 資料；只改變身分憑證的形狀與存放位置。

## Seat（分頁代號）

| 欄位 | 型別 | 規則 |
|---|---|---|
| value | string | `randomBytes(16)` 的 base64url，22 字元，`^[A-Za-z0-9_-]{22}$` |

- 每次 `POST /api/activities/{id}/join` 產生一個新的 seat。
- 出現在學生頁網址（`/student/activity?seat=`）、fetch 標頭 `x-quickanswer-seat`、EventSource 查詢參數 `?seat=`。
- 不是憑證：沒有對應 cookie 時沒有任何權限。

## SessionClaims（變更）

| 欄位 | 型別 | 說明 |
|---|---|---|
| sub | string | 教師：Google subject；學生：每次加入的隨機 UUID |
| role | `"teacher" \| "student"` | |
| activityId | string? | 學生必填 |
| groupId | string? | 學生必填 |
| **seatId** | string? | **新增**；學生身分必填，且必須等於 cookie 名稱中的 seat |
| exp | number | Unix 秒；有效期限 8 小時（不變） |

## TeacherSessionCookie

| 屬性 | 值 |
|---|---|
| 名稱 | `qa_teacher` |
| 值 | `signSession({ sub, role: "teacher" })` |
| 屬性 | HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; production 時 Secure |
| 驗證 | 簽章有效、未過期、`role === "teacher"` |

## SeatSessionCookie

| 屬性 | 值 |
|---|---|
| 名稱 | `qa_seat_<seat>` |
| 值 | `signSession({ sub, role: "student", activityId, groupId, seatId: seat })` |
| 屬性 | HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; production 時 Secure |
| 驗證 | 簽章有效、未過期、`role === "student"`、有 activityId／groupId、`seatId === seat` |
| 數量 | 每個瀏覽器最多 10 個有效者（加入時清除無效／過期者與最早到期者） |

## 身分解析狀態表（`getRequestSession`）

| 請求的 seat（標頭優先，其次 `?seat=`） | 讀取的 cookie | 結果 |
|---|---|---|
| 無 | `qa_teacher` | 教師身分或 `null` |
| 格式正確 | `qa_seat_<seat>` | 該 seat 的學生身分或 `null` |
| 格式錯誤 | 無 | `null` |

舊的 `classroom_session` cookie 不再被讀取。
