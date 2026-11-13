local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
if activity.teacherId ~= ARGV[1] then return cjson.encode({ error = "FORBIDDEN" }) end
if redis.call("HGET", KEYS[2], "phase") ~= "open" or activity.currentRoundId ~= ARGV[2] then return cjson.encode({ error = "ROUND_CLOSED" }) end
local submissions = {}
local orderedGroups = redis.call("ZRANGE", KEYS[4], 0, -1)
for _, groupId in ipairs(orderedGroups) do
  local raw = redis.call("HGET", KEYS[3], groupId)
  if raw then table.insert(submissions, cjson.decode(raw)) end
end
local submissionsJson = #submissions == 0 and "[]" or cjson.encode(submissions)
local winnerGroupId = redis.call("GET", KEYS[5])
if winnerGroupId == false then winnerGroupId = nil end
local roundState = { phase = "closed", closedAt = ARGV[3], winnerGroupId = winnerGroupId, stateVersion = 0 }
redis.call("HSET", KEYS[2], "phase", "closed", "closedAt", ARGV[3], "winnerGroupId", winnerGroupId or "")
local completed = activity.completedQuestionNumbers or {}
local questionNumber = redis.call("HGET", KEYS[2], "questionNumber")
local alreadyCompleted = false
for _, number in ipairs(completed) do if number == questionNumber then alreadyCompleted = true break end end
if not alreadyCompleted then table.insert(completed, questionNumber) end
activity.completedQuestionNumbers = completed
activity.phase = #completed >= #(activity.questions or {}) and "completed" or "active"
activity.stateVersion = (activity.stateVersion or 0) + 1
roundState.stateVersion = activity.stateVersion
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
redis.call("HSET", KEYS[2], "stateVersion", tostring(activity.stateVersion))
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[4]))
for _, key in ipairs({ KEYS[3], KEYS[4], KEYS[5] }) do redis.call("EXPIRE", key, tonumber(ARGV[4])) end
local eventFields = cjson.encode({ type = "results.finalized", activityId = activity.activityId, stateVersion = activity.stateVersion, occurredAt = ARGV[3] })
local eventData = cjson.encode({ roundId = ARGV[2], questionNumber = questionNumber, phase = "closed", winnerGroupId = winnerGroupId or cjson.null })
local payload = string.sub(eventFields, 1, -2) .. ',"data":' .. string.sub(eventData, 1, -2) .. ',"submissions":' .. submissionsJson .. '}}'
redis.call("XADD", KEYS[6], "*", "stateVersion", tostring(activity.stateVersion), "payload", payload)
local resultFields = cjson.encode({ phase = "closed", roundId = ARGV[2], questionNumber = questionNumber, winnerGroupId = winnerGroupId or cjson.null, stateVersion = activity.stateVersion })
return string.sub(resultFields, 1, -2) .. ',"submissions":' .. submissionsJson .. '}'
