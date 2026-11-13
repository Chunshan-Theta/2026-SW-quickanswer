export const errorCodes = {
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  invalidInput: "INVALID_INPUT",
  serviceUnavailable: "SERVICE_UNAVAILABLE",
  internal: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
