import { errorResponse, jsonResponse } from "@/server/http/errors";
import { getRedisClient } from "@/server/redis/client";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const redis = await getRedisClient();
    await redis.ping();
    return jsonResponse({ status: "ok", redis: "ok" }, requestId);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
