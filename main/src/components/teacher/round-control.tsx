"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, LoaderCircle, RadioTower, Square } from "lucide-react";
import { SubmissionAnswer } from "@/components/shared/submission-answer";
import { AnswerAdoptionPanel } from "@/components/teacher/answer-adoption";
import type { AdoptionSelection } from "@/features/activities/domain/answer-adoption";
import {
  applyRoundClosed,
  applyRoundOpened,
  applySubmission,
  applyWritebackStatus,
  formatElapsed,
  questionStatus,
  roundsByQuestion,
  type QuestionStatus,
  type RoundClosedData,
  type RoundOpenedData,
} from "@/features/activities/domain/round-state";
import type { ActivityRoundSnapshot, ActivitySnapshot, ActivitySubmissionSnapshot, AdoptedAnswerSnapshot, PublishedAnswerSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

type Question = { questionNumber: string; prompt: string; kind?: "single" | "group"; mappingStatus: string; blanks?: RoundBlankSnapshot[] };
type ActivityView = {
  activityId: string;
  joinCode: string;
  phase: string;
  groupNames: string[];
  completedQuestionNumbers: string[];
  questions: Question[];
  rounds: ActivityRoundSnapshot[];
};
type LiveEvent<T> = { stateVersion: number; occurredAt?: string; data: T };
type WritebackJobData = { jobId: string; roundId: string; status: string; attempt?: number; errorCode?: string | null; adopted?: AdoptedAnswerSnapshot; published?: PublishedAnswerSnapshot };
type ClosedRoundResult = RoundClosedData & { questionNumber: string };

const statusLabels: Record<QuestionStatus, string> = {
  unconfirmed: "作答格未確認",
  idle: "未開放",
  open: "搶答中",
  closed: "已結束",
  "writeback-pending": "已結束 · 回填中",
  "writeback-succeeded": "已結束 · 已回填",
  "writeback-failed": "已結束 · 回填失敗",
};

function readEvent<T>(message: Event): LiveEvent<T> {
  return JSON.parse((message as MessageEvent<string>).data) as LiveEvent<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "操作失敗，請稍後再試。");
  return result;
}

/** Mirrors the server rule: the activity completes once every question has a closed round. */
function activityPhase(questions: Question[], rounds: ActivityRoundSnapshot[]): string {
  return rounds.filter((round) => round.phase === "closed").length >= questions.length ? "completed" : "active";
}

function questionBlanks(question: Question): RoundBlankSnapshot[] {
  return question.blanks?.length ? question.blanks : [{ label: null, prompt: question.prompt }];
}

export function TeacherRoundControl({ activity: initialActivity }: { activity: ActivityView }) {
  const [activity, setActivity] = useState<ActivityView>(initialActivity);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const roundIndex = useMemo(() => roundsByQuestion(activity.rounds), [activity.rounds]);
  const statuses = new Map(activity.questions.map((question) => [question.questionNumber, questionStatus(question, roundIndex.get(question.questionNumber))]));
  const completed = activity.phase === "completed";
  const openableNumbers = completed ? [] : activity.questions.filter((question) => statuses.get(question.questionNumber) === "idle").map((question) => question.questionNumber);
  // A question that stopped being openable (e.g. opened from another window) drops out of the selection.
  const selectedNumbers = openableNumbers.filter((questionNumber) => selected.has(questionNumber));
  const openCount = activity.rounds.filter((round) => round.phase === "open").length;
  const hasOpenRounds = openCount > 0;
  const busy = pending !== null;

  useEffect(() => {
    const stream = new EventSource(`/api/activities/${activity.activityId}/events`);
    stream.addEventListener("activity.snapshot", (message) => {
      const snapshot = JSON.parse((message as MessageEvent<string>).data) as ActivitySnapshot;
      setActivity((current) => ({ ...current, phase: snapshot.phase, rounds: snapshot.rounds }));
    });
    stream.addEventListener("phase.changed", (message) => {
      const event = readEvent<RoundOpenedData & { phase: string }>(message);
      if (event.data.phase !== "open") return;
      setActivity((current) => ({ ...current, phase: "active", rounds: applyRoundOpened(current.rounds, { ...event.data, openedAt: event.occurredAt }) }));
    });
    stream.addEventListener("submission.accepted", (message) => {
      const event = readEvent<ActivitySubmissionSnapshot & { roundId: string; winnerGroupId: string }>(message);
      setActivity((current) => ({ ...current, rounds: applySubmission(current.rounds, event.data.roundId, event.data, event.data.winnerGroupId) }));
    });
    stream.addEventListener("results.finalized", (message) => {
      const event = readEvent<ClosedRoundResult>(message);
      setActivity((current) => {
        const rounds = applyRoundClosed(current.rounds, { ...event.data, closedAt: event.occurredAt });
        return { ...current, rounds, phase: activityPhase(current.questions, rounds) };
      });
    });
    stream.addEventListener("writeback.status", (message) => {
      const event = readEvent<WritebackJobData>(message);
      setActivity((current) => ({ ...current, rounds: applyWritebackStatus(current.rounds, event.data.roundId, event.data) }));
    });
    return () => stream.close();
  }, [activity.activityId]);

  useEffect(() => {
    if (!hasOpenRounds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasOpenRounds]);

  async function run(action: string, task: () => Promise<void>) {
    setPending(action);
    setError("");
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗，請稍後再試。");
    } finally {
      setPending(null);
    }
  }

  function toggleQuestion(questionNumber: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(questionNumber)) next.delete(questionNumber);
      else next.add(questionNumber);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selectedNumbers.length === openableNumbers.length ? new Set() : new Set(openableNumbers));
  }

  const openSelected = () => run("open", async () => {
    const result = await postJson<{ rounds: RoundOpenedData[] }>(`/api/activities/${activity.activityId}/rounds/open`, { questionNumbers: selectedNumbers });
    setActivity((current) => ({ ...current, phase: "active", rounds: result.rounds.reduce(applyRoundOpened, current.rounds) }));
    setSelected(new Set());
  });

  function applyClosed(results: ClosedRoundResult[]) {
    setActivity((current) => {
      const rounds = results.reduce(applyRoundClosed, current.rounds);
      return { ...current, rounds, phase: activityPhase(current.questions, rounds) };
    });
  }

  const closeOne = (round: ActivityRoundSnapshot) => run(`close:${round.roundId}`, async () => {
    applyClosed([await postJson<ClosedRoundResult>(`/api/activities/${activity.activityId}/rounds/${round.roundId}/close`)]);
  });

  const closeAll = () => run("close-all", async () => {
    applyClosed((await postJson<{ rounds: ClosedRoundResult[] }>(`/api/activities/${activity.activityId}/rounds/close-all`)).rounds);
  });

  // 005: writes back the answer the teacher adopted (a group's answer or a typed one).
  const queueWriteback = (round: ActivityRoundSnapshot, selection: AdoptionSelection) => run(`writeback:${round.roundId}`, async () => {
    const job = await postJson<{ jobId: string; status: string; attempt?: number; adopted?: AdoptedAnswerSnapshot }>(`/api/activities/${activity.activityId}/rounds/${round.roundId}/writeback`, { requestId: crypto.randomUUID(), selection });
    setActivity((current) => ({ ...current, rounds: applyWritebackStatus(current.rounds, round.roundId, job) }));
  });

  async function copyJoinCode() {
    try {
      await navigator.clipboard.writeText(activity.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("無法複製代碼，請手動選取複製。");
    }
  }

  const spinner = <LoaderCircle className="spin" size={16} />;

  return (
    <div className="teacher-control-layout">
      <section className="join-code-panel">
        <div><p className="eyebrow">STUDENT JOIN CODE</p><p className="join-code-value">{activity.joinCode}</p><small>學生輸入此代碼後選擇組別加入</small></div>
        <button className="secondary-action" type="button" onClick={copyJoinCode}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "已複製" : "複製代碼"}</button>
      </section>

      <section className="question-board" aria-labelledby="question-board-title">
        <div className="question-board-toolbar">
          <div className="question-board-summary">
            <h2 id="question-board-title">題目控制</h2>
            <span aria-live="polite">{completed ? "活動已完成" : `已選 ${selectedNumbers.length} 題 · 搶答中 ${openCount} 題`}</span>
          </div>
          <div className="question-board-actions">
            <button className="secondary-action" disabled={busy || openableNumbers.length === 0} type="button" onClick={toggleAll}>
              {openableNumbers.length > 0 && selectedNumbers.length === openableNumbers.length ? "取消全選" : "全選未開放"}
            </button>
            <button className="primary-action" disabled={busy || selectedNumbers.length === 0} type="button" onClick={openSelected}>
              {pending === "open" ? spinner : <RadioTower size={16} />}開放所選題目
            </button>
            <button className="end-round-action" disabled={busy || !hasOpenRounds} type="button" onClick={closeAll}>
              {pending === "close-all" ? spinner : <Square size={15} />}結束全部開放中
            </button>
          </div>
        </div>
        {error && <p className="form-message form-error" role="alert">{error}</p>}

        <ol className="question-card-list">
          {activity.questions.map((question) => {
            const round = roundIndex.get(question.questionNumber);
            const status = statuses.get(question.questionNumber) ?? "idle";
            const selectable = openableNumbers.includes(question.questionNumber);
            const isSelected = selectable && selected.has(question.questionNumber);
            const blanks = questionBlanks(question);
            const isGroup = question.kind === "group";
            // A group prompt is often just its sub-prompts joined; avoid showing the text twice.
            const showPrompt = !isGroup || question.prompt !== blanks.map((blank) => blank.prompt).filter(Boolean).join("／");
            const title = (
              <>
                <span className="question-card-number">{question.questionNumber.padStart(2, "0")}</span>
                <span className="question-card-kind">{isGroup ? `題組 · ${blanks.length} 小題` : "單題"}</span>
              </>
            );
            return (
              <li className={`question-card question-card-${status}${isSelected ? " question-card-selected" : ""}`} key={question.questionNumber}>
                <div className="question-card-header">
                  {selectable ? (
                    <label className="question-card-select">
                      <input aria-label={`選取第 ${question.questionNumber} 題`} checked={isSelected} disabled={busy} type="checkbox" onChange={() => toggleQuestion(question.questionNumber)} />
                      {title}
                    </label>
                  ) : (
                    <div className="question-card-select"><span className="question-card-check-spacer" aria-hidden="true" />{title}</div>
                  )}
                  <span className={`status-badge status-badge-${status}`}>
                    {status === "open" && round ? <><i aria-hidden="true" />搶答中 <time suppressHydrationWarning>{formatElapsed(round.openedAt, now)}</time></> : statusLabels[status]}
                  </span>
                </div>

                <div className="question-card-body">
                  {showPrompt && <p className="question-card-prompt">{question.prompt}</p>}
                  {isGroup && (
                    <ol className="question-card-blanks">
                      {blanks.map((blank, index) => <li key={index}><span>{blank.label ?? `（${index + 1}）`}</span><span>{blank.prompt}</span></li>)}
                    </ol>
                  )}
                </div>

                {round?.phase === "open" && (
                  <div className="live-ranking">
                    <div className="live-ranking-heading"><span>即時排名</span><span>{round.submissions.length} / {activity.groupNames.length} 組已作答</span></div>
                    <ol className="live-ranking-list" aria-label={`第 ${question.questionNumber} 題即時排名`}>
                      {round.submissions.map((submission) => (
                        <li className="live-ranking-row live-ranking-submitted" key={submission.groupId}>
                          <span className="live-ranking-order">{submission.acceptedOrder.toString().padStart(2, "0")}</span>
                          <strong>{submission.groupId}</strong>
                          <SubmissionAnswer submission={submission} blanks={round.blanks} />
                        </li>
                      ))}
                      {activity.groupNames.filter((groupName) => !round.submissions.some((submission) => submission.groupId === groupName)).map((groupName) => (
                        <li className="live-ranking-row" key={groupName}>
                          <span className="live-ranking-order">—</span>
                          <strong>{groupName}</strong>
                          <span className="live-ranking-waiting">等待作答</span>
                        </li>
                      ))}
                    </ol>
                    <div className="question-card-actions">
                      <button className="end-round-action" disabled={busy} type="button" onClick={() => closeOne(round)}>
                        {pending === `close:${round.roundId}` ? spinner : <Square size={15} />}結束本題
                      </button>
                    </div>
                  </div>
                )}

                {round?.phase === "closed" && (
                  <div className="closed-summary">
                    <p className="closed-summary-winner">{round.winnerGroupId ? `最快作答：${round.winnerGroupId}` : "本題無人作答，可自行輸入正確答案回填。"}</p>
                    <AnswerAdoptionPanel
                      key={round.roundId}
                      round={round}
                      busy={busy}
                      submitting={pending === `writeback:${round.roundId}`}
                      onWriteback={(selection) => queueWriteback(round, selection)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
