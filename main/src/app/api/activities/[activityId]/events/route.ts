import { getRequestSession } from "@/server/auth/session";
import { requireActivity, requireRole } from "@/server/http/guards";
import { errorResponse, requestId } from "@/server/http/errors";
import { getActivitySnapshot } from "@/features/activities/application/activity-snapshot";
import { projectActivityEvent } from "@/server/events/activity-event-projection";
import { subscribeToActivityEvents } from "@/server/events/activity-event-reader";
import type { ActivityEvent, SessionClaims } from "@/features/activities/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeEvent(event: { id?: string; type: string; data: unknown }): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`${event.id ? `id: ${event.id}\n` : ""}event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

async function openStream(request: Request, activityId: string, session: SessionClaims, id: string): Promise<Response> {
  requireActivity(session, activityId);
  const pending: ActivityEvent[] = [];
  let ready = false;
  let snapshotVersion = 0;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      const send = (payload: { id?: string; type: string; data: unknown }) => {
        if (closed) return;
        try { controller?.enqueue(encodeEvent(payload)); } catch { cleanup(); }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener("abort", cleanup);
        try { controller?.close(); } catch { /* Stream already closed by the client. */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });

      void (async () => {
        try {
          unsubscribe = await subscribeToActivityEvents(activityId, (event) => {
            if (!ready) { pending.push(event); return; }
            if (event.stateVersion <= snapshotVersion) return;
            const projected = projectActivityEvent(event, session);
            if (projected) send({ id: String(projected.stateVersion), type: projected.type, data: projected });
          });
          const snapshot = await getActivitySnapshot(activityId, session);
          snapshotVersion = Number(snapshot.stateVersion ?? 0);
          send({ id: String(snapshotVersion), type: "activity.snapshot", data: snapshot });
          ready = true;
          for (const event of pending.sort((left, right) => left.stateVersion - right.stateVersion)) {
            if (event.stateVersion <= snapshotVersion) continue;
            const projected = projectActivityEvent(event, session);
            if (projected) send({ id: String(projected.stateVersion), type: projected.type, data: projected });
          }
          heartbeat = setInterval(() => send({ type: "heartbeat", data: { at: Date.now() } }), 15_000);
        } catch (error) {
          cleanup();
          console.error("SSE initialization failed", { requestId: id, name: error instanceof Error ? error.name : "Error" });
        }
      })();
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": id,
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }): Promise<Response> {
  const id = requestId(request);
  try {
    const session = getRequestSession(request);
    if (!session) {
      requireRole(session, "student");
    }
    const { activityId } = await context.params;
    return await openStream(request, activityId, session!, id);
  } catch (error) {
    return errorResponse(error, id);
  }
}
