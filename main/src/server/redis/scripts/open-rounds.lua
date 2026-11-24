-- Opens one or more questions at once: every requested question is validated first and
-- nothing is written unless all of them can be opened.
-- KEYS[1] activity meta, KEYS[2] activity event stream, KEYS[2 + i] state hash of round i
-- ARGV[1] teacher id, ARGV[2] openedAt, ARGV[3] TTL seconds,
-- ARGV[4] JSON array of { questionNumber, roundId } in the same order as the round keys
local activityRaw = redis.call("GET", KEYS[1])
if not activityRaw then return cjson.encode({ error = "NOT_FOUND" }) end
local activity = cjson.decode(activityRaw)
if activity.teacherId ~= ARGV[1] then return cjson.encode({ error = "FORBIDDEN" }) end
if activity.phase ~= "ready" and activity.phase ~= "active" then return cjson.encode({ error = "CONFLICT" }) end

local ok, requested = pcall(cjson.decode, ARGV[4])
if not ok or type(requested) ~= "table" or #requested == 0 or #requested ~= #KEYS - 2 then
  return cjson.encode({ error = "INVALID_REQUEST" })
end

-- Question number -> open round id. Stored as a JSON object and removed when empty, so the
-- cjson empty-table ambiguity ({} vs []) never reaches the stored activity.
local openRounds = activity.openRoundIdsByQuestion
if type(openRounds) ~= "table" then openRounds = {} end
local completed = {}
if type(activity.completedQuestionNumbers) == "table" then
  for _, number in ipairs(activity.completedQuestionNumbers) do completed[number] = true end
end
local questionsByNumber = {}
for _, question in ipairs(activity.questions or {}) do questionsByNumber[question.questionNumber] = question end

local plans = {}
local seen = {}
for index, item in ipairs(requested) do
  local number = item.questionNumber
  local question = questionsByNumber[number]
  if not question then return cjson.encode({ error = "QUESTION_NOT_FOUND", questionNumber = number }) end
  if seen[number] then return cjson.encode({ error = "DUPLICATE_QUESTION", questionNumber = number }) end
  seen[number] = true
  if completed[number] then return cjson.encode({ error = "QUESTION_ALREADY_COMPLETED", questionNumber = number }) end
  if openRounds[number] then return cjson.encode({ error = "QUESTION_ALREADY_OPEN", questionNumber = number }) end
  if question.mappingStatus ~= "confirmed" then return cjson.encode({ error = "MAPPING_NOT_CONFIRMED", questionNumber = number }) end
  -- Public sub-question data: one entry per answer blank (a single question has exactly one).
  local blanks = {}
  for _, blank in ipairs(question.blanks or {}) do
    local label = blank.label
    if label == nil then label = cjson.null end
    table.insert(blanks, { label = label, prompt = blank.prompt or "" })
  end
  if #blanks == 0 then table.insert(blanks, { label = cjson.null, prompt = question.prompt }) end
  table.insert(plans, { question = question, roundId = item.roundId, key = KEYS[2 + index], blanks = blanks, kind = question.kind or "single" })
end

if type(activity.roundIdsByQuestion) ~= "table" then activity.roundIdsByQuestion = {} end
activity.phase = "active"
activity.currentRoundId = nil
local opened = {}
local events = {}
for _, plan in ipairs(plans) do
  local number = plan.question.questionNumber
  -- One event per round, each with its own version, keeps the SSE stream contiguous.
  activity.stateVersion = (activity.stateVersion or 0) + 1
  openRounds[number] = plan.roundId
  activity.roundIdsByQuestion[number] = plan.roundId
  redis.call("HSET", plan.key, "activityId", activity.activityId, "questionNumber", number, "prompt", plan.question.prompt, "kind", plan.kind, "blankCount", tostring(#plan.blanks), "blanks", cjson.encode(plan.blanks), "phase", "open", "openedAt", ARGV[2], "nextOrder", "0", "stateVersion", tostring(activity.stateVersion))
  redis.call("EXPIRE", plan.key, tonumber(ARGV[3]))
  local data = { roundId = plan.roundId, phase = "open", questionNumber = number, prompt = plan.question.prompt, kind = plan.kind, blanks = plan.blanks }
  table.insert(events, { version = activity.stateVersion, payload = cjson.encode({ type = "phase.changed", activityId = activity.activityId, stateVersion = activity.stateVersion, occurredAt = ARGV[2], data = data }) })
  table.insert(opened, { roundId = plan.roundId, questionNumber = number, prompt = plan.question.prompt, kind = plan.kind, blanks = plan.blanks, phase = "open", openedAt = ARGV[2], stateVersion = activity.stateVersion })
end
activity.openRoundIdsByQuestion = openRounds
redis.call("SET", KEYS[1], cjson.encode(activity), "KEEPTTL")
for _, event in ipairs(events) do
  redis.call("XADD", KEYS[2], "MAXLEN", "~", "1000", "*", "stateVersion", tostring(event.version), "payload", event.payload)
end
redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
return cjson.encode({ rounds = opened, stateVersion = activity.stateVersion })
