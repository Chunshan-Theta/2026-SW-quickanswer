-- KEYS: 1 activity, 2 job hash, 3 activity events, 4 round state
-- ARGV: 1 status, 2 attempt, 3 now, 4 errorCode
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

-- 005: only a successful writeback publishes its adopted answer to students; pending or failed
-- writebacks keep the previously published answer.
local published = nil
if ARGV[1] == "succeeded" and redis.call("EXISTS", KEYS[4]) == 1 then
  local job = redis.call("HMGET", KEYS[2], "adoptedSource", "adoptedGroupId", "winnerGroupId", "answers", "answer")
  local source = job[1] == "teacher" and "teacher" or "group"
  local groupId = ""
  if source == "group" then groupId = job[2] or job[3] or "" end
  local answer = job[5] or ""
  local answersJson = job[4] or cjson.encode({ answer })
  redis.call("HSET", KEYS[4],
    "publishedSource", source,
    "publishedGroupId", groupId,
    "publishedAnswers", answersJson,
    "publishedAnswer", answer,
    "publishedAt", ARGV[3])
  published = { source = source, groupId = groupId ~= "" and groupId or cjson.null, answer = answer, answers = cjson.decode(answersJson), publishedAt = ARGV[3] }
end

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
    questionNumber = redis.call("HGET", KEYS[2], "questionNumber"),
    status = ARGV[1],
    attempt = tonumber(ARGV[2]),
    errorCode = ARGV[4] ~= "" and ARGV[4] or cjson.null,
    published = published
  }
})
redis.call("XADD", KEYS[3], "MAXLEN", "~", "1000", "*",
  "stateVersion", tostring(activity.stateVersion),
  "payload", payload)
return cjson.encode({ jobId = jobId, status = ARGV[1], attempt = tonumber(ARGV[2]) })
