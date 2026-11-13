"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, CircleAlert, LoaderCircle, RadioTower } from "lucide-react";

type Submission = { groupId: string; answer: string; acceptedOrder: number; acceptedAt: string };
type CurrentRound = { roundId: string; questionNumber: string; prompt: string; phase: "open" | "closed"; winnerGroupId: string | null; submissions: Submission[] } | null;
export type Snapshot = { activityId: string; phase: string; stateVersion: number; currentRound: CurrentRound };

export function StudentActivityRound({ activityId, groupId, initialSnapshot }: { activityId: string; groupId: string; initialSnapshot: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const stream = new EventSource(`/api/activities/${activityId}/events`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener("activity.snapshot", (message) => {
      const event = message as MessageEvent<string>;
      setSnapshot(JSON.parse(event.data) as Snapshot);
    });
    stream.addEventListener("phase.changed", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { stateVersion: number; data: { roundId: string; questionNumber: string; prompt: string; phase: "open" | "closed" } };
      setSnapshot((current) => ({ ...current, stateVersion: event.stateVersion, phase: "active", currentRound: { roundId: event.data.roundId, questionNumber: event.data.questionNumber, prompt: event.data.prompt, phase: event.data.phase, winnerGroupId: null, submissions: [] } }));
      setAnswer("");
    });
    stream.addEventListener("submission.receipt", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { stateVersion: number; data: Submission & { roundId: string } };
      setSnapshot((current) => current.currentRound?.roundId !== event.data.roundId ? current : ({
        ...current,
        stateVersion: event.stateVersion,
        currentRound: { ...current.currentRound!, submissions: [event.data] },
      }));
    });
    stream.addEventListener("results.finalized", (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as { stateVersion: number; data: { roundId: string; phase: "closed"; winnerGroupId: string | null; submissions: Submission[] } };
      setSnapshot((current) => current.currentRound?.roundId !== event.data.roundId ? current : ({
        ...current,
        stateVersion: event.stateVersion,
        phase: "active",
        currentRound: { ...current.currentRound!, phase: "closed", winnerGroupId: event.data.winnerGroupId, submissions: event.data.submissions },
      }));
    });
    return () => stream.close();
  }, [activityId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const round = snapshot.currentRound;
    if (!round || round.phase !== "open" || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${activityId}/rounds/${round.roundId}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer, requestId: crypto.randomUUID() }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "無法送出答案。");
      setAnswer("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "連線失敗，請重試。");
    } finally {
      setBusy(false);
    }
  }

  const round = snapshot.currentRound;
  const ownSubmission = round?.submissions.find((submission) => submission.groupId === groupId);

  return (
    <section className="student-round" aria-live="polite">
      <div className="student-round-status">
        <span className={`phase-pill ${round?.phase === "open" ? "phase-live" : "phase-waiting"}`}><i />{round?.phase === "open" ? "搶答進行中" : round?.phase === "closed" ? "本題已結束" : "等待老師開題"}</span>
        <span className="connection"><i className={connected ? "" : "connection-idle"} />{connected ? "即時連線" : "連線中斷"}</span>
      </div>
      {round ? (
        <>
          <div className="student-question">
            <p className="eyebrow">QUESTION {round.questionNumber.padStart(2, "0")}</p>
            <h2>{round.prompt}</h2>
          </div>
          {round.phase === "open" && !ownSubmission && (
            <form className="student-answer-form" onSubmit={submit}>
              <label className="field-label" htmlFor="answer">小組答案</label>
              <textarea id="answer" maxLength={4000} required rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} />
              {error && <p className="form-message form-error" role="alert"><CircleAlert size={15} />{error}</p>}
              <button className="primary-action" disabled={busy || !answer.trim()} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <RadioTower size={16} />}送出答案</button>
            </form>
          )}
          {round.phase === "open" && ownSubmission && <p className="receipt-message" role="status"><Check size={17} />答案已送達，等待老師公布結果。</p>}
          {round.phase === "closed" && (
            <section className="final-result" aria-labelledby="result-heading">
              <div className="section-heading"><h3 id="result-heading">最終結果</h3><span>{round.winnerGroupId ? `最快：${round.winnerGroupId}` : "本題無人作答"}</span></div>
              <ol className="result-list">
                {round.submissions.map((submission) => <li key={submission.groupId}><span>{submission.acceptedOrder.toString().padStart(2, "0")}</span><strong>{submission.groupId}</strong><p>{submission.answer}</p>{submission.groupId === round.winnerGroupId && <Check size={16} aria-label="搶答成功" />}</li>)}
              </ol>
            </section>
          )}
        </>
      ) : <div className="student-waiting"><RadioTower size={22} /><p>老師尚未開啟題目</p><small>開始後題目會自動顯示。</small></div>}
    </section>
  );
}
