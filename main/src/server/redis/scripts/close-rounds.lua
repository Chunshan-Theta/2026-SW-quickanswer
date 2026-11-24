-- Closes one or more open rounds of an activity at the same instant.
-- KEYS[1] activity meta, KEYS[2] activity event stream, then four keys per round i:
--   KEYS[3 + 4(i-1)] state hash, +1 submissions hash, +2 order zset, +3 winner key
-- ARGV[1] teacher id, ARGV[2] closedAt, ARGV[3] TTL seconds,
-- ARGV[4] mode: "strict" (every round must be open) | "open-only" (skip rounds already closed),
-- ARGV[5..] round ids in the same order as the keys
local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
if activity.teacherId ~= ARGV[1] then return cjson.encode({ error = "FORBIDDEN" }) end

local openRounds = activity.openRoundIdsByQuestion
if type(openRounds) ~= "table" then openRounds = {} end
local targets = {}
for index = 1, #ARGV - 4 do
  local roundId = ARGV[4 + index]
  local base = 2 + (index - 1) * 4
  local stateKey = KEYS[base + 1]
  local questionNumber = redis.call("HGET", stateKey, "questionNumber")
  local isOpen = redis.call("HGET", stateKey, "phase") == "open" and questionNumber and openRounds[questionNumber] == roundId
  if isOpen then
    table.insert(targets, { roundId = roundId, questionNumber = questionNumber, state = stateKey, submissions = KEYS[base + 2], order = KEYS[base + 3], winner = KEYS[base + 4] })
  elseif ARGV[4] == "strict" then
    return cjson.encode({ error = "ROUND_CLOSED" })
  end
end
if #targets == 0 then return cjson.encode({ error = "NO_OPEN_ROUNDS" }) end

local completed = {}
if type(activity.completedQuestionNumbers) == "table" then
  for _, number in ipairs(activity.completedQuestionNumbers) do table.insert(completed, number) end
end
local function markCompleted(number)
  for _, existing in ipairs(completed) do if existing == number then return end end
  table.insert(completed, number)
end
-- Splices a JSON array string into an encoded object; cjson would encode an empty array as {}.
local function withSubmissions(objectJson, submissionsJson)
  return string.sub(objectJson, 1, -2) .. ',"submissions":' .. submissionsJson .. '}'
end

local results = {}
local events = {}
for _, target in ipairs(targets) do
  local submissions = {}
  for _, groupId in ipairs(redis.call("ZRANGE", target.order, 0, -1)) do
    local raw = redis.call("HGET", target.submissions, groupId)
    if raw then table.insert(submissions, cjson.decode(raw)) end
  end
  local submissionsJson = #submissions == 0 and "[]" or cjson.encode(submissions)
  local winnerGroupId = redis.call("GET", target.winner)
  if winnerGroupId == false then winnerGroupId = nil end

  activity.stateVersion = (activity.stateVersion or 0) + 1
  redis.call("HSET", target.state, "phase", "closed", "closedAt", ARGV[2], "winnerGroupId", winnerGroupId or "", "stateVersion", tostring(activity.stateVersion))
  for _, key in ipairs({ target.state, target.submissions, target.order, target.winner }) do redis.call("EXPIRE", key, tonumber(ARGV[3])) end
  openRounds[target.questionNumber] = nil
  markCompleted(target.questionNumber)

  local data = cjson.encode({ roundId = target.roundId, questionNumber = target.questionNumber, phase = "closed", winnerGroupId = winnerGroupId or cjson.null })
  local envelope = cjson.encode({ type = "results.finalized", activityId = activity.activityId, stateVersion = activity.stateVersion, occurredAt = ARGV[2] })
  table.insert(events, { version = activity.stateVersion, payload = string.sub(envelope, 1, -2) .. ',"data":' .. withSubmissions(data, submissionsJson) .. '}' })
  table.insert(results, withSubmissions(cjson.encode({ phase = "closed", roundId = target.roundId, questionNumber = target.questionNumber, winnerGroupId = winnerGroupId or cjson.null, closedAt = ARGV[2], stateVersion = activity.stateVersion }), submissionsJson))
end

local anyOpen = next(openRounds) ~= nil
activity.openRoundIdsByQuestion = anyOpen and openRounds or nil
activity.currentRoundId = nil
activity.completedQuestionNumbers = completed
activity.phase = (not anyOpen and #completed >= #(activity.questions or {})) and "completed" or "active"
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
for _, event in ipairs(events) do
  redis.call("XADD", KEYS[2], "MAXLEN", "~", "1000", "*", "stateVersion", tostring(event.version), "payload", event.payload)
end
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
return '{"rounds":[' .. table.concat(results, ",") .. '],"stateVersion":' .. activity.stateVersion .. '}'
