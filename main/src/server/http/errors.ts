import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { errorCodes, type ErrorCode } from "@/lib/errors/error-codes";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[a-zA-Z0-9._-]{8,80}$/.test(supplied) ? supplied : randomUUID();
}

export function jsonResponse<T>(data: T, id: string, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: { "x-request-id": id, "cache-control": "no-store" },
  });
}

export function errorResponse(error: unknown, id: string): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId: id,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      { status: error.status, headers: { "x-request-id": id, "cache-control": "no-store" } },
    );
  }

  console.error("Unhandled API error", { requestId: id });
  return NextResponse.json(
    { error: { code: errorCodes.internal, message: "服務暫時無法完成要求。", requestId: id } },
    { status: 500, headers: { "x-request-id": id, "cache-control": "no-store" } },
  );
}

export async function withApi<T extends Request>(
  request: T,
  operation: (id: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const id = requestId(request);
  try {
    return await operation(id);
  } catch (error) {
    return errorResponse(error, id);
  }
}
