"use client";

import { useState } from "react";
import { Check, LoaderCircle, RotateCcw, Upload } from "lucide-react";
import { SubmissionAnswer } from "@/components/shared/submission-answer";
import {
  adoptionIsComplete,
  defaultAdoption,
  describeAdoption,
  sameAdoption,
  type AdoptionSelection,
} from "@/features/activities/domain/answer-adoption";
import type { ActivityRoundSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

const pendingStatuses = new Set(["queued", "running", "retryable"]);

function roundBlanks(round: ActivityRoundSnapshot): RoundBlankSnapshot[] {
  return round.blanks?.length ? round.blanks : [{ label: null, prompt: round.prompt }];
}

/**
 * Closed-question card section (005): the teacher picks which group's answer is correct (the
 * fastest is preselected) or types the correct answer, then writes it back; the choice can be
 * changed and written back again.
 */
export function AnswerAdoptionPanel({
  round,
  busy,
  submitting,
  onWriteback,
}: {
  round: ActivityRoundSnapshot;
  busy: boolean;
  submitting: boolean;
  onWriteback: (selection: AdoptionSelection) => void;
}) {
  const blanks = roundBlanks(round);
  const [choice, setChoice] = useState<AdoptionSelection>(() => defaultAdoption(round));
  const [typed, setTyped] = useState<string[]>(() => {
    const initial = defaultAdoption(round);
    return initial.source === "teacher" ? initial.answers : blanks.map(() => "");
  });

  const selection: AdoptionSelection = choice.source === "teacher" ? { source: "teacher", answers: typed } : choice;
  const job = round.writebackJob;
  const pending = job ? pendingStatuses.has(job.status) : false;
  const current = job?.adopted ?? round.publishedAnswer;
  const alreadyWritten = job?.status === "succeeded" && sameAdoption(selection, current);
  const complete = adoptionIsComplete(selection, blanks.length);
  const name = `adopt-${round.roundId}`;

  const buttonLabel = pending ? "回填處理中" : alreadyWritten ? "已回填至工作表" : job ? "重新回填" : "回填所選答案";
  const buttonIcon = submitting || pending
    ? <LoaderCircle className="spin" size={15} />
    : alreadyWritten ? <Check size={15} /> : job ? <RotateCcw size={15} /> : <Upload size={15} />;

  let status: { text: string; tone: "notice" | "error" } | null = null;
  if (job && pending) status = { text: `回填中：${job.adopted ? describeAdoption(job.adopted) : "所選答案"}…`, tone: "notice" };
  else if (job?.status === "succeeded" && current) status = { text: `已回填：${describeAdoption(current)}`, tone: "notice" };
  else if (job?.status === "failed") status = { text: `回填失敗${job.errorCode ? `（${job.errorCode}）` : ""}，請檢查工作表後重新回填。`, tone: "error" };

  function updateTyped(index: number, value: string) {
    setTyped((answers) => {
      const next = [...answers];
      next[index] = value;
      return next;
    });
  }

  return (
    <div className="adopt-answer">
      <fieldset className="adopt-answer-fieldset" disabled={busy || pending}>
        <legend>選擇要回填的正確答案</legend>
        <ol className="adopt-answer-list">
          {round.submissions.map((submission) => {
            const id = `${name}-${submission.groupId}`;
            const checked = choice.source === "group" && choice.groupId === submission.groupId;
            const adoptedHere = round.publishedAnswer?.source === "group" && round.publishedAnswer.groupId === submission.groupId;
            return (
              <li className={`adopt-option${checked ? " adopt-option-selected" : ""}`} key={submission.groupId}>
                <input id={id} name={name} type="radio" checked={checked} aria-describedby={`${id}-answer`} onChange={() => setChoice({ source: "group", groupId: submission.groupId })} />
                <label htmlFor={id}>
                  <span className="adopt-option-order">{submission.acceptedOrder.toString().padStart(2, "0")}</span>
                  <strong>{submission.groupId}</strong>
                  {submission.groupId === round.winnerGroupId && <span className="adopt-option-tag">最快</span>}
                  {adoptedHere && <span className="adopt-option-tag adopt-option-tag-published">已採用</span>}
                </label>
                <div className="adopt-option-answer" id={`${id}-answer`}><SubmissionAnswer submission={submission} blanks={round.blanks} /></div>
              </li>
            );
          })}
          <li className={`adopt-option${choice.source === "teacher" ? " adopt-option-selected" : ""}`}>
            <input id={`${name}-teacher`} name={name} type="radio" checked={choice.source === "teacher"} onChange={() => setChoice({ source: "teacher", answers: typed })} />
            <label htmlFor={`${name}-teacher`}>
              <strong>自行輸入正確答案</strong>
              {round.publishedAnswer?.source === "teacher" && <span className="adopt-option-tag adopt-option-tag-published">已採用</span>}
            </label>
            {choice.source === "teacher" && (
              <div className="adopt-typed">
                {blanks.map((blank, index) => (
                  <div className="blank-field" key={index}>
                    <label className="field-label" htmlFor={`${name}-typed-${index}`}>
                      {blanks.length > 1 ? `${blank.label ?? `（${index + 1}）`} ${blank.prompt}` : "正確答案"}
                    </label>
                    <textarea id={`${name}-typed-${index}`} maxLength={4000} rows={2} value={typed[index] ?? ""} onChange={(event) => updateTyped(index, event.target.value)} />
                  </div>
                ))}
              </div>
            )}
          </li>
        </ol>
      </fieldset>
      <div className="writeback-status">
        <button className="secondary-action" disabled={busy || pending || alreadyWritten || !complete} type="button" onClick={() => onWriteback(selection)}>
          {buttonIcon}{buttonLabel}
        </button>
        {status && <p className={`form-message ${status.tone === "error" ? "form-error" : "form-notice"}`} role="status">{status.text}</p>}
      </div>
    </div>
  );
}
