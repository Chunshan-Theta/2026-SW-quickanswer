"use client";

import type { FormEvent } from "react";
import { CircleAlert, LoaderCircle, RadioTower } from "lucide-react";
import type { RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

export function StudentAnswerForm({
  fieldIdPrefix,
  blanks,
  answers,
  busy,
  error,
  onAnswerChange,
  onSubmit,
}: {
  /** Keeps field ids unique when several questions are open on one page. */
  fieldIdPrefix: string;
  blanks: RoundBlankSnapshot[];
  answers: string[];
  busy: boolean;
  error: string;
  onAnswerChange: (index: number, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isGroup = blanks.length > 1;
  const complete = blanks.every((_, index) => (answers[index] ?? "").trim().length > 0);
  return (
    <form className="student-answer-form" onSubmit={onSubmit}>
      {isGroup && <p className="field-hint">本題為題組，請填完全部 {blanks.length} 個子題後一次送出。</p>}
      {blanks.map((blank, index) => (
        <div className="blank-field" key={index}>
          <label className="field-label" htmlFor={`${fieldIdPrefix}-answer-${index}`}>
            {isGroup ? `${blank.label ?? `（${index + 1}）`} ${blank.prompt}` : "小組答案"}
          </label>
          <textarea id={`${fieldIdPrefix}-answer-${index}`} maxLength={4000} required rows={isGroup ? 2 : 4} value={answers[index] ?? ""} onChange={(event) => onAnswerChange(index, event.target.value)} />
        </div>
      ))}
      {error && <p className="form-message form-error" role="alert"><CircleAlert size={15} />{error}</p>}
      <button className="primary-action" disabled={busy || !complete} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <RadioTower size={16} />}送出答案</button>
    </form>
  );
}
