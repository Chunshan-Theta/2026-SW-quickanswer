-- Queues the writeback of one closed question with the answer the teacher adopted (005).
-- KEYS: 1 activity, 2 round state, 3 submissions, 4 idempotency (latest job id), 5 job hash,
--       6 writeback job stream, 7 activity events
-- ARGV: 1 teacherId, 2 roundId, 3 activityId, 4 jobId, 5 now, 6 ttl seconds,
--       7 selection JSON ({ source = "group", groupId } | { source = "teacher", answers }) or ""
-- One job per question: a new selection re-queues the same job with revision + 1. A pending job
-- refuses a different selection, so two writebacks never race on the same answer cells.
local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
if activity.teacherId ~= ARGV[1] then return cjson.encode({ error = "FORBIDDEN" }) end
if redis.call("HGET", KEYS[2], "activityId") ~= ARGV[3] or redis.call("HGET", KEYS[2], "phase") ~= "closed" then
  return cjson.encode({ error = "ROUND_NOT_CLOSED" })
end

local selection = { source = "group" }
if ARGV[7] ~= "" then
  local ok, decoded = pcall(cjson.decode, ARGV[7])
  if not ok or type(decoded) ~= "table" then return cjson.encode({ error = "INVALID_SELECTION" }) end
  selection = decoded
end

local blankCount = tonumber(redis.call("HGET", KEYS[2], "blankCount") or "1") or 1
local adoptedSource, adoptedGroupId, answers, display
if selection.source == "teacher" then
  answers = selection.answers
  if type(answers) ~= "table" or #answers ~= blankCount then return cjson.encode({ error = "INCOMPLETE_ANSWERS" }) end
  for _, value in ipairs(answers) do
    if type(value) ~= "string" or not string.find(value, "%S") then return cjson.encode({ error = "INCOMPLETE_ANSWERS" }) end
  end
  adoptedSource = "teacher"
  adoptedGroupId = ""
  display = answers[1]
  if blankCount > 1 then
    -- Same display text as a group's submission: "（1）a；（2）b".
    local blanks = cjson.decode(redis.call("HGET", KEYS[2], "blanks") or "[]")
    local parts = {}
    for index, value in ipairs(answers) do
      local label = blanks[index] and blanks[index].label
      if label == nil or label == cjson.null then label = "（" .. index .. "）" end
      parts[index] = label .. value
    end
    display = table.concat(parts, "；")
  end
elseif selection.source == "group" then
  local groupId = selection.groupId
  local defaulted = groupId == nil
  if defaulted then
    -- Without a selection the fastest group's answer is written (001–004 behaviour).
    groupId = redis.call("HGET", KEYS[2], "winnerGroupId")
    if not groupId or groupId == "" then return cjson.encode({ error = "NO_WINNER" }) end
  end
  if type(groupId) ~= "string" or groupId == "" then return cjson.encode({ error = "INVALID_SELECTION" }) end
  local submissionRaw = redis.call("HGET", KEYS[3], groupId)
  if not submissionRaw then return cjson.encode({ error = defaulted and "NO_WINNER" or "GROUP_NOT_ANSWERED" }) end
  local submission = cjson.decode(submissionRaw)
  answers = submission.answers or { submission.answer }
  adoptedSource = "group"
  adoptedGroupId = groupId
  display = submission.answer
else
  return cjson.encode({ error = "INVALID_SELECTION" })
end

local answersJson = cjson.encode(answers)
local selectionKey = adoptedSource .. "\n" .. adoptedGroupId .. "\n" .. answersJson
local adopted = { source = adoptedSource, groupId = adoptedGroupId ~= "" and adoptedGroupId or cjson.null, answer = display, answers = answers }

local revision = 0
local existingJobId = redis.call("GET", KEYS[4])
if existingJobId and redis.call("EXISTS", KEYS[5]) == 1 then
  local job = redis.call("HMGET", KEYS[5], "status", "selectionKey", "winnerGroupId", "answers", "answer", "revision")
  local status = job[1] or "queued"
  local existingKey = job[2]
  if not existingKey then
    -- Jobs queued before 005 always adopted the fastest group's answer.
    existingKey = "group\n" .. (job[3] or "") .. "\n" .. (job[4] or cjson.encode({ job[5] or "" }))
  end
  revision = tonumber(job[6] or "1") or 1
  local same = existingKey == selectionKey
  if status == "queued" or status == "running" or status == "retryable" then
    if not same then return cjson.encode({ error = "WRITEBACK_IN_PROGRESS" }) end
    return cjson.encode({ jobId = existingJobId, status = status, existing = true, revision = revision, adopted = adopted })
  end
  if status == "succeeded" and same then
    return cjson.encode({ jobId = existingJobId, status = status, existing = true, revision = revision, adopted = adopted })
  end
  -- A failed job (any selection) or a succeeded job with another selection is queued again.
end

revision = revision + 1
redis.call("HSET", KEYS[5],
  "jobId", ARGV[4],
  "activityId", ARGV[3],
  "roundId", ARGV[2],
  "teacherId", ARGV[1],
  "questionNumber", redis.call("HGET", KEYS[2], "questionNumber"),
  "winnerGroupId", redis.call("HGET", KEYS[2], "winnerGroupId") or "",
  "adoptedSource", adoptedSource,
  "adoptedGroupId", adoptedGroupId,
  "selectionKey", selectionKey,
  "answer", display,
  "answers", answersJson,
  -- What the last successful writeback put in the cells; lets a re-selection replace it.
  "previousAnswers", redis.call("HGET", KEYS[2], "publishedAnswers") or "",
  "revision", tostring(revision),
  "status", "queued",
  "attempt", "0",
  "errorCode", "",
  "createdAt", ARGV[5],
  "updatedAt", ARGV[5])
redis.call("EXPIRE", KEYS[5], tonumber(ARGV[6]))
redis.call("SET", KEYS[4], ARGV[4], "EX", tonumber(ARGV[6]))
redis.call("XADD", KEYS[6], "*",
  "jobId", ARGV[4],
  "activityId", ARGV[3],
  "roundId", ARGV[2],
  "status", "queued")

activity.stateVersion = (activity.stateVersion or 0) + 1
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
local payload = cjson.encode({
  type = "writeback.status",
  activityId = ARGV[3],
  stateVersion = activity.stateVersion,
  occurredAt = ARGV[5],
  data = { jobId = ARGV[4], roundId = ARGV[2], status = "queued", attempt = 0, revision = revision, adopted = adopted }
})
redis.call("XADD", KEYS[7], "MAXLEN", "~", "1000", "*",
  "stateVersion", tostring(activity.stateVersion),
  "payload", payload)
redis.call("EXPIRE", KEYS[7], tonumber(ARGV[6]))
return cjson.encode({ jobId = ARGV[4], status = "queued", existing = false, revision = revision, adopted = adopted })
