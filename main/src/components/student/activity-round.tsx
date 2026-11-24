"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, DoorClosed, RadioTower } from "lucide-react";
import { StudentAnswerForm } from "@/components/student/answer-form";
import { studentEventsUrl, submitStudentAnswers } from "@/components/student/student-api";
import { SubmissionAnswer } from "@/components/shared/submission-answer";
import { applyRoundClosed, applyRoundOpened, applySubmission, type RoundClosedData, type RoundOpenedData } from "@/features/activities/domain/round-state";
import type { ActivityRoundSnapshot, ActivitySnapshot, ActivitySubmissionSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

export type Snapshot = ActivitySnapshot;
type LiveEvent<T> = { stateVersion: number; occurredAt?: string; data: T };

function readEvent<T>(message: Event): LiveEvent<T> {
  return JSON.parse((message as MessageEvent<string>).data) as LiveEvent<T>;
}

function roundBlanks(round: ActivityRoundSnapshot): RoundBlankSnapshot[] {
  return round.blanks?.length ? round.blanks : [{ label: null, prompt: round.prompt }];
}

function questionLabel(round: ActivityRoundSnapshot): string {
  return `QUESTION ${round.questionNumber.padStart(2, "0")}${round.kind === "group" ? ` · 題組 ${roundBlanks(round).length} 小題` : ""}`;
}

export function StudentActivityRound({ activityId, groupId, seat, initialSnapshot }: { activityId: string; groupId: string; seat: string; initialSnapshot: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busyRounds, setBusyRounds] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const stream = new EventSource(studentEventsUrl(activityId, seat));
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener("activity.snapshot", (message) => {
      setSnapshot(JSON.parse((message as MessageEvent<string>).data) as Snapshot);
    });
    stream.addEventListener("phase.changed", (message) => {
      const event = readEvent<RoundOpenedData & { phase: string }>(message);
      if (event.data.phase !== "open") return;
      setSnapshot((current) => ({ ...current, stateVersion: event.stateVersion, phase: "active", rounds: applyRoundOpened(current.rounds, { ...event.data, openedAt: event.occurredAt }) }));
    });
    stream.addEventListener("submission.receipt", (message) => {
      const event = readEvent<ActivitySubmissionSnapshot & { roundId: string }>(message);
      setSnapshot((current) => ({ ...current, stateVersion: event.stateVersion, rounds: applySubmission(current.rounds, event.data.roundId, event.data) }));
    });
    stream.addEventListener("results.finalized", (message) => {
      const event = readEvent<RoundClosedData>(message);
      setSnapshot((current) => ({ ...current, stateVersion: event.stateVersion, rounds: applyRoundClosed(current.rounds, { ...event.data, closedAt: event.occurredAt }) }));
    });
    // The teacher closed the room (006): no more questions; published results stay visible.
    stream.addEventListener("activity.ended", (message) => {
      const event = readEvent<{ phase: "ended"; endedAt: string }>(message);
      setSnapshot((current) => ({ ...current, stateVersion: event.stateVersion, phase: "ended", endedAt: event.data.endedAt }));
    });
    return () => stream.close();
  }, [activityId, seat]);

  function updateDraft(roundId: string, index: number, value: string) {
    setDrafts((current) => {
      const next = [...(current[roundId] ?? [])];
      next[index] = value;
      return { ...current, [roundId]: next };
    });
  }

  async function submit(round: ActivityRoundSnapshot, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (round.phase !== "open" || busyRounds[round.roundId]) return;
    setBusyRounds((current) => ({ ...current, [round.roundId]: true }));
    setErrors((current) => ({ ...current, [round.roundId]: "" }));
    try {
      const answers = roundBlanks(round).map((_, index) => drafts[round.roundId]?.[index] ?? "");
      const receipt = await submitStudentAnswers(activityId, seat, round.roundId, answers);
      // Show the receipt immediately; the live receipt event carries the same data.
      setSnapshot((current) => ({ ...current, rounds: applySubmission(current.rounds, round.roundId, receipt) }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[round.roundId];
        return next;
      });
    } catch (caught) {
      setErrors((current) => ({ ...current, [round.roundId]: caught instanceof Error ? caught.message : "連線失敗，請重試。" }));
    } finally {
      setBusyRounds((current) => ({ ...current, [round.roundId]: false }));
    }
  }

  const openRounds = snapshot.rounds.filter((round) => round.phase === "open");
  const closedRounds = snapshot.rounds.filter((round) => round.phase === "closed");
  const ended = snapshot.phase === "ended";

  return (
    <section className="student-round" aria-live="polite">
      <div className="student-round-status">
        <span className={`phase-pill ${ended ? "phase-ended" : openRounds.length ? "phase-live" : "phase-waiting"}`}><i />{ended ? "活動已結束" : openRounds.length ? `${openRounds.length} 題搶答進行中` : "等待老師開題"}</span>
        <span className="connection"><i className={connected ? "" : "connection-idle"} />{connected ? "即時連線" : "連線中斷"}</span>
      </div>
      {ended && (
        <div className="activity-ended-banner" role="status">
          <DoorClosed aria-hidden="true" size={20} />
          <div><strong>活動已結束</strong><span>老師已關閉房間，無法再作答。{closedRounds.length ? "以下為已公布的結果。" : ""}</span></div>
        </div>
      )}

      {openRounds.length > 0 ? (
        <ol className="student-round-list" aria-label="開放中的題目">
          {openRounds.map((round) => {
            const ownSubmission = round.submissions.find((submission) => submission.groupId === groupId);
            const headingId = `question-${round.questionNumber}-heading`;
            return (
              <li className="student-round-card" key={round.roundId} aria-labelledby={headingId}>
                <div className="student-question">
                  <p className="eyebrow">{questionLabel(round)}</p>
                  <h2 id={headingId}>{round.prompt}</h2>
                </div>
                {ownSubmission ? (
                  <p className="receipt-message" role="status"><Check size={17} />答案已送達，等待老師公布結果。</p>
                ) : (
                  <StudentAnswerForm
                    fieldIdPrefix={`question-${round.questionNumber}`}
                    blanks={roundBlanks(round)}
                    answers={drafts[round.roundId] ?? []}
                    busy={Boolean(busyRounds[round.roundId])}
                    error={errors[round.roundId] ?? ""}
                    onAnswerChange={(index, value) => updateDraft(round.roundId, index, value)}
                    onSubmit={(event) => submit(round, event)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        !ended && <div className="student-waiting"><RadioTower size={22} /><p>{closedRounds.length ? "目前沒有開放中的題目" : "老師尚未開啟題目"}</p><small>老師開放題目後會自動顯示，可能一次開放多題。</small></div>
      )}

      {closedRounds.length > 0 && (
        <section className="student-results" aria-labelledby="student-results-heading">
          <div className="section-heading"><h2 id="student-results-heading">已公布結果</h2><span>{closedRounds.length} 題</span></div>
          <ol className="student-round-list">
            {closedRounds.map((round) => (
              <li className="final-result" key={round.roundId}>
                <div className="section-heading">
                  <h3>第 {round.questionNumber} 題最終結果</h3>
                  <span>{round.winnerGroupId ? `最快：${round.winnerGroupId}` : "本題無人作答"}</span>
                </div>
                <p className="final-result-prompt">{round.prompt}</p>
                <ol className="result-list">
                  {round.submissions.map((submission) => (
                    <li key={submission.groupId}>
                      <span>{submission.acceptedOrder.toString().padStart(2, "0")}</span>
                      <strong>{submission.groupId}</strong>
                      <SubmissionAnswer submission={submission} blanks={round.blanks} />
                      {submission.groupId === round.winnerGroupId && <Check size={16} aria-label="搶答成功" />}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
