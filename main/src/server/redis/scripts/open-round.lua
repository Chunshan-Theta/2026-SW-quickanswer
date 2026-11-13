local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
if activity.teacherId ~= ARGV[1] then return cjson.encode({ error = "FORBIDDEN" }) end
if activity.phase ~= "ready" and activity.phase ~= "active" then return cjson.encode({ error = "CONFLICT" }) end
if activity.currentRoundId and activity.currentRoundId ~= cjson.null then
  local currentPhase = redis.call("HGET", "round:" .. activity.currentRoundId .. ":state", "phase")
  if currentPhase == "open" then return cjson.encode({ error = "ROUND_ALREADY_OPEN" }) end
end
local question = nil
for _, candidate in ipairs(activity.questions or {}) do
  if candidate.questionNumber == ARGV[3] then question = candidate break end
end
if not question then return cjson.encode({ error = "QUESTION_NOT_FOUND" }) end
if question.mappingStatus ~= "confirmed" or not question.selectedToken then return cjson.encode({ error = "MAPPING_NOT_CONFIRMED" }) end
activity.phase = "active"
activity.currentRoundId = ARGV[2]
activity.stateVersion = (activity.stateVersion or 0) + 1
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
redis.call("HSET", KEYS[2], "activityId", activity.activityId, "questionNumber", question.questionNumber, "prompt", question.prompt, "phase", "open", "openedAt", ARGV[4], "nextOrder", "0", "stateVersion", tostring(activity.stateVersion))
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[5]))
local payload = cjson.encode({ type = "phase.changed", activityId = activity.activityId, stateVersion = activity.stateVersion, occurredAt = ARGV[4], data = { roundId = ARGV[2], phase = "open", questionNumber = question.questionNumber, prompt = question.prompt } })
redis.call("XADD", KEYS[3], "*", "stateVersion", tostring(activity.stateVersion), "payload", payload)
redis.call("EXPIRE", KEYS[3], tonumber(ARGV[5]))
return cjson.encode({ roundId = ARGV[2], questionNumber = question.questionNumber, prompt = question.prompt, phase = "open", stateVersion = activity.stateVersion })
