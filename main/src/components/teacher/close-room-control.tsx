"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DoorClosed, LoaderCircle } from "lucide-react";
import type { RoundClosedData } from "@/features/activities/domain/round-state";

export type ClosedActivityResult = {
  phase: "ended";
  endedAt: string | null;
  rounds: Array<RoundClosedData & { questionNumber: string }>;
  stateVersion: number;
  alreadyEnded: boolean;
};

/**
 * Room status and 關閉房間 (006). The confirmation is shown in the page (no window.confirm): it says
 * how many open questions will end and that results and writeback are kept.
 */
export function CloseRoomControl({ activityId, ended, openCount, disabled, onClosed }: {
  activityId: string;
  ended: boolean;
  openCount: number;
  disabled: boolean;
  onClosed: (result: ClosedActivityResult) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (ended) {
    return (
      <div className="room-status" role="status">
        <span className="activity-status activity-status-ended">已關閉</span>
        <span className="room-status-text">房間已關閉，學生無法再加入或作答；仍可查看結果與回填尚未回填的題目。</span>
      </div>
    );
  }

  async function closeRoom() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${activityId}/close`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as ClosedActivityResult & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "無法關閉房間，請稍後再試。");
      setConfirming(false);
      onClosed(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法關閉房間，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="room-status">
      <span className="activity-status activity-status-ongoing">進行中</span>
      {confirming ? (
        <div className="close-room-confirm" role="group" aria-describedby={messageId}>
          <p id={messageId}>
            <strong>確定要關閉房間嗎？</strong>
            {openCount > 0 ? `開放中的 ${openCount} 題會同時結束並公布結果，` : ""}學生將無法再加入或作答；已公布的結果與回填會保留。
          </p>
          <div className="close-room-actions">
            <button ref={cancelRef} className="secondary-action" disabled={busy} type="button" onClick={() => setConfirming(false)}>取消</button>
            <button className="end-round-action" disabled={busy} type="button" onClick={closeRoom}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <DoorClosed size={15} />}確認關閉房間
            </button>
          </div>
        </div>
      ) : (
        <button className="end-round-action" disabled={disabled} type="button" onClick={() => setConfirming(true)}>
          <DoorClosed size={15} />關閉房間
        </button>
      )}
      {error && <p className="form-message form-error" role="alert">{error}</p>}
    </div>
  );
}
