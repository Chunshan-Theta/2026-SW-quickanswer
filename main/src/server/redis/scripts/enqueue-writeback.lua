local existingJobId = redis.call("GET", KEYS[4])
if existingJobId then
  local status = redis.call("HGET", KEYS[5], "status") or "queued"
  return cjson.encode({ jobId = existingJobId, status = status, existing = true })
end

local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
if activity.teacherId ~= ARGV[1] then return cjson.encode({ error = "FORBIDDEN" }) end
local roundActivityId = redis.call("HGET", KEYS[2], "activityId")
if roundActivityId ~= ARGV[3] or redis.call("HGET", KEYS[2], "phase") ~= "closed" then
  return cjson.encode({ error = "ROUND_NOT_CLOSED" })
end

local winnerGroupId = redis.call("HGET", KEYS[2], "winnerGroupId")
if not winnerGroupId or winnerGroupId == "" then return cjson.encode({ error = "NO_WINNER" }) end
local submissionRaw = redis.call("HGET", KEYS[3], winnerGroupId)
if not submissionRaw then return cjson.encode({ error = "NO_WINNER" }) end
local submission = cjson.decode(submissionRaw)

redis.call("HSET", KEYS[5],
  "jobId", ARGV[4],
  "activityId", ARGV[3],
  "roundId", ARGV[2],
  "teacherId", ARGV[1],
  "questionNumber", redis.call("HGET", KEYS[2], "questionNumber"),
  "winnerGroupId", winnerGroupId,
  "answer", submission.answer,
  "status", "queued",
  "attempt", "0",
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
  data = { jobId = ARGV[4], roundId = ARGV[2], status = "queued", attempt = 0 }
})
redis.call("XADD", KEYS[7], "MAXLEN", "~", "1000", "*",
  "stateVersion", tostring(activity.stateVersion),
  "payload", payload)
redis.call("EXPIRE", KEYS[7], tonumber(ARGV[6]))
return cjson.encode({ jobId = ARGV[4], status = "queued", existing = false })
