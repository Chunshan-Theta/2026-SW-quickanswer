"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clipboard, LoaderCircle, RadioTower, Square } from "lucide-react";
import { SubmissionAnswer } from "@/components/shared/submission-answer";
import type { ActivitySubmissionSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

type Submission = ActivitySubmissionSnapshot;
type WritebackJob = { jobId: string; status: string; attempt: number; errorCode?: string | null };
type Round = {
  roundId: string;
  questionNumber: string;
  prompt: string;
  kind?: "single" | "group";
  blanks?: RoundBlankSnapshot[];
  phase: string;
  winnerGroupId: string | null;
  submissions: Submission[];
  writebackJob?: WritebackJob;
};
type ActivityView = {
  activityId: string;
  joinCode: string;
  phase: string;
  groupNames: string[];
  completedQuestionNumbers: string[];
  questions: Array<{ questionNumber: string; prompt: string; kind?: "single" | "group"; mappingStatus: string; blanks?: RoundBlankSnapshot[] }>;
  currentRound: Round | null;
  completedRounds?: Round[];
};
type ApiResult = {
  error?: { message?: string };
  roundId?: string;
  questionNumber?: string;
  prompt?: string;
  kind?: "single" | "group";
  blanks?: RoundBlankSnapshot[];
  winnerGroupId?: string | null;
  submissions?: Submission[];
  jobId?: string;
  status?: string;
  attempt?: number;
};

const busyWritebackStatuses = ["queued", "running", "retryable", "succeeded", "failed"];

function writebackLabel(job?: WritebackJob): string {
  if (job?.status === "succeeded") return "已回填至工作表";
  if (job?.status === "failed") return "回填失敗";
  return job?.status ? "回填處理中" : "回填得獎答案";
}

function upsertRound(rounds: Round[], round: Round): Round[] {
  return [...rounds.filter((item) => item.roundId !== round.roundId), round]
    .sort((left, right) => Number(left.questionNumber) - Number(right.questionNumber));
}

export function TeacherRoundControl({ activity: initialActivity }: { activity: ActivityView }) {
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityView>({ ...initialActivity, completedRounds: initialActivity.completedRounds ?? [] });
  const [selectedQuestion, setSelectedQuestion] = useState(initialActivity.questions.find((question) => question.mappingStatus === "confirmed" && !initialActivity.completedQuestionNumbers.includes(question.questionNumber))?.questionNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stream = new EventSource(`/api/activities/${activity.activityId}/events`);
    stream.addEventListener("activity.snapshot", (message) => {
      const snapshot = JSON.parse((message as MessageEvent<string>).data) as Partial<ActivityView>;
      setActivity((current) => ({ ...current, ...snapshot, completedRounds: current.completedRounds }));
    });
    stream.addEventListener("phase.changed", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { data: { roundId: string; questionNumber: string; prompt: string; kind?: "single" | "group"; blanks?: RoundBlankSnapshot[]; phase: "open" | "closed" } };
      if (event.data.phase === "open") {
        setActivity((current) => ({ ...current, phase: "active", currentRound: { ...event.data, winnerGroupId: null, submissions: [] } }));
      }
    });
    stream.addEventListener("submission.accepted", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { data: Submission & { roundId: string; winnerGroupId: string } };
      setActivity((current) => {
        if (current.currentRound?.roundId !== event.data.roundId) return current;
        const submissions = [...current.currentRound.submissions.filter((submission) => submission.groupId !== event.data.groupId), event.data].sort((a, b) => a.acceptedOrder - b.acceptedOrder);
        return { ...current, currentRound: { ...current.currentRound, winnerGroupId: event.data.winnerGroupId, submissions } };
      });
    });
    stream.addEventListener("results.finalized", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { data: { roundId: string; questionNumber: string; phase: "closed"; winnerGroupId: string | null; submissions: Submission[] } };
      setActivity((current) => {
        if (current.currentRound?.roundId !== event.data.roundId) return current;
        const completedQuestionNumbers = [...new Set([...current.completedQuestionNumbers, event.data.questionNumber])];
        const closedRound: Round = { ...current.currentRound, phase: "closed", winnerGroupId: event.data.winnerGroupId, submissions: event.data.submissions };
        return {
          ...current,
          phase: completedQuestionNumbers.length >= current.questions.filter((question) => question.mappingStatus === "confirmed").length ? "completed" : "active",
          completedQuestionNumbers,
          currentRound: closedRound,
          completedRounds: upsertRound(current.completedRounds ?? [], closedRound),
        };
      });
    });
    stream.addEventListener("writeback.status", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { data: WritebackJob & { roundId: string } };
      setActivity((current) => ({
        ...current,
        currentRound: current.currentRound?.roundId === event.data.roundId ? { ...current.currentRound, writebackJob: event.data } : current.currentRound,
        completedRounds: (current.completedRounds ?? []).map((round) => round.roundId === event.data.roundId ? { ...round, writebackJob: event.data } : round),
      }));
    });
    return () => stream.close();
  }, [activity.activityId]);

  async function openQuestion() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${activity.activityId}/rounds/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionNumber: selectedQuestion }),
      });
      const body = await response.json() as ApiResult;
      if (!response.ok) throw new Error(body.error?.message ?? "無法開啟題目。");
      setActivity((current) => ({ ...current, phase: "active", currentRound: { roundId: body.roundId!, questionNumber: body.questionNumber!, prompt: body.prompt!, kind: body.kind, blanks: body.blanks, phase: "open", winnerGroupId: null, submissions: [] } }));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "目前無法開啟題目。");
    } finally {
      setBusy(false);
    }
  }

  async function closeQuestion() {
    const round = activity.currentRound;
    if (!round || round.phase !== "open") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${activity.activityId}/rounds/${round.roundId}/close`, { method: "POST" });
      const body = await response.json() as ApiResult;
      if (!response.ok) throw new Error(body.error?.message ?? "無法結束搶答。");
      const completedQuestionNumbers = [...new Set([...activity.completedQuestionNumbers, round.questionNumber])];
      setActivity((current) => {
        if (current.currentRound?.roundId !== round.roundId) return current;
        const closedRound: Round = { ...current.currentRound, phase: "closed", winnerGroupId: body.winnerGroupId ?? null, submissions: body.submissions ?? [] };
        return {
          ...current,
          phase: completedQuestionNumbers.length >= current.questions.filter((question) => question.mappingStatus === "confirmed").length ? "completed" : "active",
          completedQuestionNumbers,
          currentRound: closedRound,
          completedRounds: upsertRound(current.completedRounds ?? [], closedRound),
        };
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "目前無法結束搶答。");
    } finally {
      setBusy(false);
    }
  }

  async function copyJoinCode() {
    try {
      await navigator.clipboard.writeText(activity.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("無法複製代碼，請手動選取複製。");
    }
  }

  async function queueWriteback(round: Round) {
    if (round.phase !== "closed" || !round.winnerGroupId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${activity.activityId}/rounds/${round.roundId}/writeback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      const body = await response.json() as ApiResult;
      if (!response.ok) throw new Error(body.error?.message ?? "無法排入答案回填。");
      const writebackJob = { jobId: body.jobId!, status: body.status!, attempt: body.attempt ?? 0 };
      setActivity((current) => ({
        ...current,
        currentRound: current.currentRound?.roundId === round.roundId ? { ...current.currentRound, writebackJob } : current.currentRound,
        completedRounds: (current.completedRounds ?? []).map((item) => item.roundId === round.roundId ? { ...item, writebackJob } : item),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "目前無法排入答案回填。");
    } finally {
      setBusy(false);
    }
  }

  function writebackControl(round: Round) {
    if (!round.winnerGroupId) return null;
    return (
      <div className="writeback-status">
        <button className="secondary-action" disabled={busy || busyWritebackStatuses.includes(round.writebackJob?.status ?? "")} type="button" onClick={() => queueWriteback(round)}>
          {writebackLabel(round.writebackJob)}
        </button>
        {round.writebackJob && <p className="form-message form-notice" role="status">回填狀態：{round.writebackJob.status}{round.writebackJob.errorCode ? ` · ${round.writebackJob.errorCode}` : ""}</p>}
      </div>
    );
  }

  const round = activity.currentRound;
  const remainingQuestions = activity.questions.filter((question) => question.mappingStatus === "confirmed" && !activity.completedQuestionNumbers.includes(question.questionNumber));
  const earlierRounds = (activity.completedRounds ?? []).filter((item) => item.roundId !== round?.roundId);

  return (
    <div className="teacher-control-layout">
      <section className="join-code-panel">
        <div><p className="eyebrow">STUDENT JOIN CODE</p><p className="join-code-value">{activity.joinCode}</p><small>學生輸入此代碼後選擇組別加入</small></div>
        <button className="secondary-action" type="button" onClick={copyJoinCode}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "已複製" : "複製代碼"}</button>
      </section>
      <section className="round-control-panel" aria-labelledby="round-control-title">
        <div className="section-heading"><h2 id="round-control-title">題目控制</h2><span>{activity.phase === "completed" ? "活動已完成" : round?.phase === "open" ? "搶答進行中" : "等待開題"}</span></div>
        {!round || round.phase === "closed" ? (
          <div className="open-question-row">
            <label className="field-label" htmlFor="question-number">選擇題目
              <select id="question-number" disabled={activity.phase === "completed" || busy} value={selectedQuestion} onChange={(event) => setSelectedQuestion(event.target.value)}>
                {remainingQuestions.map((question) => <option key={question.questionNumber} value={question.questionNumber}>第 {question.questionNumber} 題{question.kind === "group" ? `（題組 · ${question.blanks?.length ?? 0} 小題）` : ""} · {question.prompt}</option>)}
              </select>
            </label>
            <button className="primary-action" disabled={activity.phase === "completed" || !selectedQuestion || busy} type="button" onClick={openQuestion}>{busy ? <LoaderCircle className="spin" size={17} /> : <RadioTower size={16} />}開啟搶答</button>
          </div>
        ) : (
          <div className="active-round-panel">
            <div className="active-question">
              <p className="eyebrow">QUESTION {round.questionNumber.padStart(2, "0")}{round.kind === "group" ? ` · 題組 ${round.blanks?.length ?? 0} 小題` : ""}</p>
              <h3>{round.prompt}</h3>
            </div>
            <div className="group-status-list">
              {activity.groupNames.map((groupName) => {
                const submission = round.submissions.find((item) => item.groupId === groupName);
                return <div className="group-status-row" key={groupName}><span className="group-status-name">{groupName}</span><span className={submission ? "group-status-submitted" : "group-status-waiting"}>{submission ? `已提交 · 第 ${submission.acceptedOrder} 位` : "等待作答"}</span>{submission && <SubmissionAnswer submission={submission} blanks={round.blanks} />}</div>;
              })}
            </div>
            <button className="end-round-action" disabled={busy} type="button" onClick={closeQuestion}>{busy ? <LoaderCircle className="spin" size={17} /> : <Square size={15} />}結束本題</button>
          </div>
        )}
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {round?.phase === "closed" && (
          <section className="final-result" aria-labelledby="teacher-result-heading">
            <div className="section-heading"><h3 id="teacher-result-heading">第 {round.questionNumber} 題最終結果</h3><span>{round.winnerGroupId ? `搶答成功：${round.winnerGroupId}` : "本題無人作答。"}</span></div>
            <ol className="result-list">
              {round.submissions.map((submission) => <li key={submission.groupId}><span>{submission.acceptedOrder.toString().padStart(2, "0")}</span><strong>{submission.groupId}</strong><SubmissionAnswer submission={submission} blanks={round.blanks} /></li>)}
            </ol>
            {writebackControl(round)}
          </section>
        )}
      </section>
      {earlierRounds.length > 0 && (
        <section className="completed-rounds" aria-labelledby="completed-rounds-heading">
          <div className="section-heading"><h2 id="completed-rounds-heading">已結束題目</h2><span>{earlierRounds.length} 題 · 可個別回填</span></div>
          <ol className="completed-round-list">
            {earlierRounds.map((item) => {
              const winner = item.submissions.find((submission) => submission.groupId === item.winnerGroupId);
              return (
                <li className="completed-round" key={item.roundId}>
                  <div className="completed-round-heading">
                    <strong>第 {item.questionNumber} 題{item.kind === "group" ? "（題組）" : ""}</strong>
                    <span>{item.winnerGroupId ? `搶答成功：${item.winnerGroupId}` : "本題無人作答"}</span>
                  </div>
                  {winner && <SubmissionAnswer submission={winner} blanks={item.blanks} />}
                  {writebackControl(item)}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
