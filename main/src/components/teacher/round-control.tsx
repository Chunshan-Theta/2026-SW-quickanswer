"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clipboard, LoaderCircle, RadioTower, Square } from "lucide-react";

type Submission = { groupId: string; answer: string; acceptedOrder: number; acceptedAt: string };
type CurrentRound = { roundId: string; questionNumber: string; prompt: string; phase: "open" | "closed"; winnerGroupId: string | null; submissions: Submission[] } | null;
type ActivityView = { activityId: string; joinCode: string; phase: string; groupNames: string[]; completedQuestionNumbers: string[]; questions: Array<{ questionNumber: string; prompt: string; mappingStatus: string }>; currentRound: CurrentRound };
type ApiResult = { error?: { message?: string }; roundId?: string; questionNumber?: string; prompt?: string; phase?: "open" | "closed"; winnerGroupId?: string | null; submissions?: Submission[]; stateVersion?: number };

export function TeacherRoundControl({ activity: initialActivity }: { activity: ActivityView }) {
  const router = useRouter();
  const [activity, setActivity] = useState(initialActivity);
  const [selectedQuestion, setSelectedQuestion] = useState(initialActivity.questions.find((question) => question.mappingStatus === "confirmed" && !initialActivity.completedQuestionNumbers.includes(question.questionNumber))?.questionNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stream = new EventSource(`/api/activities/${activity.activityId}/events`);
    stream.addEventListener("activity.snapshot", (message) => {
      const snapshot = JSON.parse((message as MessageEvent<string>).data) as Partial<ActivityView>;
      setActivity((current) => ({ ...current, ...snapshot }));
    });
    stream.addEventListener("phase.changed", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { data: { roundId: string; questionNumber: string; prompt: string; phase: "open" | "closed" } };
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
        return {
          ...current,
          phase: completedQuestionNumbers.length >= current.questions.filter((question) => question.mappingStatus === "confirmed").length ? "completed" : "active",
          completedQuestionNumbers,
          currentRound: { ...current.currentRound, phase: "closed", winnerGroupId: event.data.winnerGroupId, submissions: event.data.submissions },
        };
      });
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
      setActivity((current) => ({ ...current, phase: "active", currentRound: { roundId: body.roundId!, questionNumber: body.questionNumber!, prompt: body.prompt!, phase: "open", winnerGroupId: null, submissions: [] } }));
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
      setActivity((current) => current.currentRound?.roundId !== round.roundId ? current : ({
        ...current,
        phase: completedQuestionNumbers.length >= current.questions.filter((question) => question.mappingStatus === "confirmed").length ? "completed" : "active",
        completedQuestionNumbers,
        currentRound: { ...current.currentRound, phase: "closed", winnerGroupId: body.winnerGroupId ?? null, submissions: body.submissions ?? [] },
      }));
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

  const round = activity.currentRound;
  const remainingQuestions = activity.questions.filter((question) => question.mappingStatus === "confirmed" && !activity.completedQuestionNumbers.includes(question.questionNumber));

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
                {remainingQuestions.map((question) => <option key={question.questionNumber} value={question.questionNumber}>第 {question.questionNumber} 題 · {question.prompt}</option>)}
              </select>
            </label>
            <button className="primary-action" disabled={activity.phase === "completed" || !selectedQuestion || busy} type="button" onClick={openQuestion}>{busy ? <LoaderCircle className="spin" size={17} /> : <RadioTower size={16} />}開啟搶答</button>
          </div>
        ) : (
          <div className="active-round-panel">
            <div className="active-question"><p className="eyebrow">QUESTION {round.questionNumber.padStart(2, "0")}</p><h3>{round.prompt}</h3></div>
            <div className="group-status-list">
              {activity.groupNames.map((groupName) => {
                const submission = round.submissions.find((item) => item.groupId === groupName);
                return <div className="group-status-row" key={groupName}><span className="group-status-name">{groupName}</span><span className={submission ? "group-status-submitted" : "group-status-waiting"}>{submission ? `已提交 · 第 ${submission.acceptedOrder} 位` : "等待作答"}</span>{submission && <p>{submission.answer}</p>}</div>;
              })}
            </div>
            <button className="end-round-action" disabled={busy} type="button" onClick={closeQuestion}>{busy ? <LoaderCircle className="spin" size={17} /> : <Square size={15} />}結束本題</button>
          </div>
        )}
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {round?.phase === "closed" && <p className="form-message form-notice" role="status">{round.winnerGroupId ? `搶答成功：${round.winnerGroupId}` : "本題無人作答。"}</p>}
      </section>
    </div>
  );
}
