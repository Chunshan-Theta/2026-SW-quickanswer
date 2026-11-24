# HTTP Contract Changes: 003

只列出相對 001／002 契約的變更。所有 API 路徑、請求本文與錯誤格式（`{ error: { code, message, requestId, details? } }`）不變。

## 身分傳遞（所有學生請求）

| 請求類型 | seat 的傳遞方式 |
|---|---|
| `fetch`（送出答案、查詢結果） | 標頭 `x-quickanswer-seat: <seat>` |
| `EventSource`（`GET /api/activities/{id}/events`） | 查詢參數 `?seat=<seat>` |
| 學生頁 `GET /student/activity` | 查詢參數 `?seat=<seat>` |

- 帶 seat 的請求只使用 cookie `qa_seat_<seat>` 的學生身分；不帶 seat 的請求只使用 cookie `qa_teacher` 的教師身分。
- seat 格式錯誤、找不到對應 cookie、cookie 與 seat 不符 → **401**「請先加入或登入活動。」（學生頁則導向 `/join`）。
- 學生身分存取其他活動 → **403**；學生身分呼叫教師專用 API → **403**。

## CHANGED `POST /api/activities/{activityId}/join`

- Request 不變：`{ joinCode, groupId, displayName }`。
- **200** response 新增 `seatId`：
  ```json
  { "activityId": "…", "groupId": "teamA", "displayName": "Sam", "phase": "ready", "seatId": "Q2xhc3Nyb29tU2VhdElkAA" }
  ```
- `Set-Cookie: qa_seat_<seatId>=<signed>; Path=/; Max-Age=28800; HttpOnly; SameSite=lax`
- 同一回應可能另含 `qa_seat_<old>=; Max-Age=0`：清除請求中已過期／無效的 seat cookie，以及超過 10 個上限時最早到期者。
- 不再設定 `classroom_session`；不影響 `qa_teacher`。

## CHANGED `GET /api/auth/google/callback`

- 成功時設定 `qa_teacher=<signed>`（取代 `classroom_session`），其餘不變。

## CHANGED 學生頁

- `GET /student/activity?seat=<seat>`：沒有有效 seat 身分 → 導向 `/join`。
- `GET /activity?seat=<seat>`：導向 `/student/activity?seat=<seat>`（舊網址相容）。

## Migration impact

- 舊 `classroom_session` cookie 不再被讀取：部署後教師需重新登入、已加入的學生需重新加入。
- 使用 `getRequestSession(request)` 的 route 不需修改；伺服器頁面改用 `getTeacherServerSession()`／`getStudentServerSession(seat)`。
- 前端學生元件需透過 `lib/session/seat.ts` 的 `seatHeaders(seat)`／`withSeat(url, seat)` 帶上 seat；新的學生端請求也必須如此。
