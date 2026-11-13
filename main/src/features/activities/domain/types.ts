export const activityPhases = [
  "draft",
  "mapping_review",
  "ready",
  "active",
  "completed",
] as const;

export const roundPhases = ["ready", "open", "closed"] as const;
export const mappingStatuses = ["confirmed", "ambiguous", "missing"] as const;
export type ActivityPhase = (typeof activityPhases)[number];
export type RoundPhase = (typeof roundPhases)[number];
export type MappingStatus = (typeof mappingStatuses)[number];
export type UserRole = "teacher" | "student";

export interface ActivityQuestion {
  questionId: string;
  questionNumber: string;
  prompt: string;
  mappingStatus: MappingStatus;
  answerSlotTokens: string[];
}

export interface ActivitySummary {
  activityId: string;
  teacherId: string;
  phase: ActivityPhase;
  stateVersion: number;
  questionIds: string[];
  currentRoundId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface SessionClaims {
  sub: string;
  role: UserRole;
  activityId?: string;
  groupId?: string;
  exp: number;
}

export interface ActivityEvent<T = Record<string, unknown>> {
  activityId: string;
  stateVersion: number;
  type: string;
  occurredAt: number;
  data: T;
}
