import { z } from "zod";

export const activityImportSchema = z.object({
  spreadsheetId: z.string().trim().min(1).max(256),
  sheetId: z.number().int().nonnegative(),
  groupNames: z.array(z.string().trim().min(1).max(48)).min(2).max(32),
  /** Google Picker file name, shown in 「我的課堂活動」 only (006). */
  spreadsheetTitle: z.string().trim().max(200).optional(),
}).refine((value) => new Set(value.groupNames).size === value.groupNames.length, { message: "組別名稱不得重複。", path: ["groupNames"] })
  // An empty title is dropped rather than stored as "".
  .transform(({ spreadsheetTitle, ...rest }): typeof rest & { spreadsheetTitle?: string } => (spreadsheetTitle ? { ...rest, spreadsheetTitle } : rest));

export const mappingConfirmationSchema = z.object({
  resolutions: z
    .array(
      z.object({
        questionNumber: z.string().trim().min(1).max(32),
        answerSlotToken: z.string().trim().min(16).max(512),
      }),
    )
    .min(1),
});

export const joinActivitySchema = z.object({
  joinCode: z.string().trim().regex(/^[A-HJ-NP-Z2-9]{6}$/),
  groupId: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(48),
});
export const joinCodeSchema = z.string().trim().regex(/^[A-HJ-NP-Z2-9]{6}$/);

const submittedAnswer = z.string().trim().min(1).max(4000);

/** Accepts `answers` (one per blank) or the legacy single `answer`; always yields `answers`. */
export const roundSubmissionSchema = z
  .union([
    z.object({ answers: z.array(submittedAnswer).min(1).max(20), requestId: z.string().uuid() }),
    z.object({ answer: submittedAnswer, requestId: z.string().uuid() }),
  ])
  .transform((value) => ({ answers: "answers" in value ? value.answers : [value.answer], requestId: value.requestId }));

const questionNumber = z.string().trim().regex(/^\d+$/).max(32);

/**
 * Accepts several `questionNumbers` (opened together, all or nothing) or the legacy single
 * `questionNumber`; `legacy` tells the route to answer with the legacy single-round response.
 */
export const roundOpenSchema = z
  .union([
    z.object({
      questionNumbers: z.array(questionNumber).min(1).max(1000)
        .refine((numbers) => new Set(numbers).size === numbers.length, { message: "題號不可重複。" }),
    }),
    z.object({ questionNumber }),
  ])
  .transform((value) => "questionNumbers" in value
    ? { questionNumbers: value.questionNumbers, legacy: false }
    : { questionNumbers: [value.questionNumber], legacy: true });

/**
 * The answer to write back (005): one group's answer or one typed by the teacher per blank.
 * Without a selection the fastest group's answer is written (001–004 behaviour).
 */
export const adoptionSelectionSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("group"), groupId: z.string().trim().min(1).max(64) }),
  z.object({ source: z.literal("teacher"), answers: z.array(submittedAnswer).min(1).max(20) }),
]);

export const writebackRequestSchema = z.object({
  requestId: z.string().uuid(),
  selection: adoptionSelectionSchema.optional(),
});

export type WritebackSelectionInput = z.infer<typeof adoptionSelectionSchema>;

export type ActivityImportInput = z.infer<typeof activityImportSchema>;
export type MappingConfirmationInput = z.infer<typeof mappingConfirmationSchema>;
export type JoinActivityInput = z.infer<typeof joinActivitySchema>;
export type RoundSubmissionInput = z.infer<typeof roundSubmissionSchema>;
export type RoundOpenInput = z.infer<typeof roundOpenSchema>;
