"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, RadioTower } from "lucide-react";
import { StudentAnswerForm } from "@/components/student/answer-form";
import { studentEventsUrl, submitStudentAnswers } from "@/components/student/student-api";
import { SubmissionAnswer } from "@/components/shared/submission-answer";
import { applyPublishedAnswer, applyRoundClosed, applyRoundOpened, applySubmission, type RoundClosedData, type RoundOpenedData } from "@/features/activities/domain/round-state";
import type { ActivityRoundSnapshot, ActivitySnapshot, ActivitySubmissionSnapshot, PublishedAnswerSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

export type Snapshot = ActivitySnapshot;
type LiveEvent<T> = { stateVersion: number; occurredAt?: string; data: T };

function readEvent<T>(message: Event): LiveEvent<T> {
  return JSON.parse((message as MessageEvent<string>).data) as LiveEvent<T>;
}

function roundBlanks(round: ActivityRoundSnapshot): RoundBlankSnapshot[] {
  return round.blanks?.length ? round.blanks : [{ label: null, prompt: round.prompt }];
}

/** Renders the published answer with the same per-blank layout as a group's answer. */
function publishedAsSubmission(published: PublishedAnswerSnapshot): ActivitySubmissionSnapshot {
  return { groupId: published.groupId ?? "", answer: published.answer, answers: published.answers, acceptedOrder: 0, acceptedAt: "" };
}

function publishedLabel(published: PublishedAnswerSnapshot): string {
  return published.source === "group" && published.groupId ? `正確答案（老師採用：${published.groupId}）` : "正確答案（老師提供）";
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
    // 005: the answer the teacher adopted, sent once its writeback succeeded.
    stream.addEventListener("answer.published", (message) => {
      const event = readEvent<{ roundId: string; published: PublishedAnswerSnapshot }>(message);
      setSnapshot((current) => ({ ...current, stateVersion: event.stateVersion, rounds: applyPublishedAnswer(current.rounds, event.data.roundId, event.data.published) }));
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

  return (
    <section className="student-round" aria-live="polite">
      <div className="student-round-status">
        <span className={`phase-pill ${openRounds.length ? "phase-live" : "phase-waiting"}`}><i />{openRounds.length ? `${openRounds.length} 題搶答進行中` : "等待老師開題"}</span>
        <span className="connection"><i className={connected ? "" : "connection-idle"} />{connected ? "即時連線" : "連線中斷"}</span>
      </div>

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
        <div className="student-waiting"><RadioTower size={22} /><p>{closedRounds.length ? "目前沒有開放中的題目" : "老師尚未開啟題目"}</p><small>老師開放題目後會自動顯示，可能一次開放多題。</small></div>
      )}

      {closedRounds.length > 0 && (
        <section className="student-results" aria-labelledby="student-results-heading">
          <div className="section-heading"><h2 id="student-results-heading">已結束的題目</h2><span>{closedRounds.length} 題</span></div>
          <ol className="student-round-list">
            {closedRounds.map((round) => {
              // 005: a student sees only their own group's answer and, once published, the teacher's.
              const own = round.submissions.find((submission) => submission.groupId === groupId);
              const published = round.publishedAnswer;
              const ownAdopted = published?.source === "group" && published.groupId === groupId;
              return (
                <li className="final-result" key={round.roundId}>
                  <div className="section-heading">
                    <h3>第 {round.questionNumber} 題</h3>
                    <span>{published ? "已公布正確答案" : "等待公布"}</span>
                  </div>
                  <p className="final-result-prompt">{round.prompt}</p>
                  <div className="answer-compare">
                    <section className={`answer-compare-item${ownAdopted ? " answer-compare-adopted" : ""}`} aria-label={`第 ${round.questionNumber} 題你們的答案`}>
                      <p className="answer-compare-label">你們的答案{own ? ` · 第 ${own.acceptedOrder} 個送出` : ""}{ownAdopted && <span className="answer-compare-tag"><Check size={13} />老師採用</span>}</p>
                      {own ? <SubmissionAnswer submission={own} blanks={round.blanks} /> : <p className="answer-compare-empty">你們沒有在本題作答</p>}
                    </section>
                    <section className="answer-compare-item answer-compare-correct" aria-label={`第 ${round.questionNumber} 題正確答案`}>
                      <p className="answer-compare-label">{published ? publishedLabel(published) : "正確答案"}</p>
                      {published ? <SubmissionAnswer submission={publishedAsSubmission(published)} blanks={round.blanks} /> : <p className="answer-compare-empty">等待老師公布正確答案</p>}
                    </section>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </section>
  );
}
