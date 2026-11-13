"use client";

import type { FormEvent } from "react";
import { CircleAlert, LoaderCircle, RadioTower } from "lucide-react";

export function StudentAnswerForm({
  answer,
  busy,
  error,
  onAnswerChange,
  onSubmit,
}: {
  answer: string;
  busy: boolean;
  error: string;
  onAnswerChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="student-answer-form" onSubmit={onSubmit}>
      <label className="field-label" htmlFor="answer">小組答案</label>
      <textarea id="answer" maxLength={4000} required rows={4} value={answer} onChange={(event) => onAnswerChange(event.target.value)} />
      {error && <p className="form-message form-error" role="alert"><CircleAlert size={15} />{error}</p>}
      <button className="primary-action" disabled={busy || !answer.trim()} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <RadioTower size={16} />}送出答案</button>
    </form>
  );
}
