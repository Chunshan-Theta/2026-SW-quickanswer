import "server-only";
import type { SessionClaims, UserRole } from "@/features/activities/domain/types";
import { AppError } from "@/server/http/errors";
import { errorCodes } from "@/lib/errors/error-codes";

export function requireRole(session: SessionClaims | null, role: UserRole): SessionClaims {
  if (!session) {
    throw new AppError(401, errorCodes.unauthorized, "請先加入或登入活動。");
  }
  if (session.role !== role) {
    throw new AppError(403, errorCodes.forbidden, "目前帳號沒有執行此操作的權限。");
  }
  return session;
}

export function requireActivity(session: SessionClaims | null, activityId: string): SessionClaims {
  if (!session || session.activityId !== activityId) {
    throw new AppError(403, errorCodes.forbidden, "無法存取此課堂活動。");
  }
  return session;
}
