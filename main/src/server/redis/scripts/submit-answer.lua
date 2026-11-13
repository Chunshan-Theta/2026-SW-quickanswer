local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
local roundPhase = redis.call("HGET", KEYS[2], "phase")
if roundPhase ~= "open" or activity.currentRoundId ~= ARGV[1] then return cjson.encode({ error = "ROUND_CLOSED" }) end
local groupExists = false
for _, groupName in ipairs(activity.groupNames or {}) do
  if groupName == ARGV[2] then groupExists = true break end
end
if not groupExists then return cjson.encode({ error = "GROUP_NOT_FOUND" }) end
if redis.call("HEXISTS", KEYS[3], ARGV[2]) == 1 then return cjson.encode({ error = "DUPLICATE_SUBMISSION" }) end
local acceptedOrder = redis.call("HINCRBY", KEYS[2], "nextOrder", 1)
local submission = { groupId = ARGV[2], answer = ARGV[3], acceptedOrder = acceptedOrder, acceptedAt = ARGV[4] }
redis.call("HSET", KEYS[3], ARGV[2], cjson.encode(submission))
redis.call("ZADD", KEYS[4], acceptedOrder, ARGV[2])
redis.call("SET", KEYS[5], ARGV[2], "NX")
local winnerGroupId = redis.call("GET", KEYS[5])
activity.stateVersion = (activity.stateVersion or 0) + 1
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
redis.call("HSET", KEYS[2], "stateVersion", tostring(activity.stateVersion))
for _, key in ipairs({ KEYS[2], KEYS[3], KEYS[4], KEYS[5] }) do
  redis.call("EXPIRE", key, tonumber(ARGV[5]))
end
local payload = cjson.encode({ type = "submission.accepted", activityId = activity.activityId, stateVersion = activity.stateVersion, occurredAt = ARGV[4], data = { roundId = ARGV[1], groupId = ARGV[2], answer = ARGV[3], acceptedOrder = acceptedOrder, acceptedAt = ARGV[4], winnerGroupId = winnerGroupId } })
redis.call("XADD", KEYS[6], "MAXLEN", "~", "1000", "*", "stateVersion", tostring(activity.stateVersion), "payload", payload)
return cjson.encode({ groupId = ARGV[2], acceptedOrder = acceptedOrder, acceptedAt = ARGV[4], winnerGroupId = winnerGroupId, stateVersion = activity.stateVersion })
