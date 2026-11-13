local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local jobId = redis.call("HGET", KEYS[2], "jobId")
if not jobId then return cjson.encode({ error = "JOB_NOT_FOUND" }) end

redis.call("HSET", KEYS[2],
  "status", ARGV[1],
  "attempt", ARGV[2],
  "updatedAt", ARGV[3],
  "errorCode", ARGV[4])
if ARGV[1] == "running" then redis.call("HSET", KEYS[2], "claimedAt", ARGV[3]) end
local activity = cjson.decode(activityRaw)
activity.stateVersion = (activity.stateVersion or 0) + 1
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
local payload = cjson.encode({
  type = "writeback.status",
  activityId = activity.activityId,
  stateVersion = activity.stateVersion,
  occurredAt = ARGV[3],
  data = {
    jobId = jobId,
    roundId = redis.call("HGET", KEYS[2], "roundId"),
    status = ARGV[1],
    attempt = tonumber(ARGV[2]),
    errorCode = ARGV[4] ~= "" and ARGV[4] or cjson.null
  }
})
redis.call("XADD", KEYS[3], "MAXLEN", "~", "1000", "*",
  "stateVersion", tostring(activity.stateVersion),
  "payload", payload)
return cjson.encode({ jobId = jobId, status = ARGV[1], attempt = tonumber(ARGV[2]) })
