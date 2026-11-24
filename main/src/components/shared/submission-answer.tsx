import type { ActivitySubmissionSnapshot, RoundBlankSnapshot } from "@/features/activities/domain/snapshot";

/** One line per blank for a question group; the plain answer for a single question. */
export function SubmissionAnswer({ submission, blanks }: { submission: ActivitySubmissionSnapshot; blanks?: RoundBlankSnapshot[] }) {
  if (submission.answers && submission.answers.length > 1) {
    return (
      <ul className="blank-answers">
        {submission.answers.map((answer, index) => (
          <li key={index}><span>{blanks?.[index]?.label ?? `（${index + 1}）`}</span>{answer}</li>
        ))}
      </ul>
    );
  }
  return <p>{submission.answer}</p>;
}
