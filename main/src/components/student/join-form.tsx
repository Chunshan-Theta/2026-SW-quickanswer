"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LoaderCircle, RadioTower } from "lucide-react";

type Lookup = { activityId: string; phase: string; groupNames: string[] };
type ApiError = { error?: { message?: string } };

export function StudentJoinForm() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [groupId, setGroupId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function findActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/join?code=${encodeURIComponent(joinCode.trim().toUpperCase())}`, { cache: "no-store" });
      const body = await response.json() as Lookup & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "找不到此活動。");
      setLookup(body);
      setGroupId(body.groupNames[0] ?? "");
    } catch (caught) {
      setLookup(null);
      setError(caught instanceof Error ? caught.message : "目前無法查詢活動，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookup) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${lookup.activityId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode: joinCode.trim().toUpperCase(), groupId, displayName }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "無法加入活動。");
      router.replace("/student/activity");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "目前無法加入活動，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="join-card" aria-labelledby="join-title">
      <div className="join-card-mark"><RadioTower size={20} /></div>
      <div className="join-card-heading">
        <p className="eyebrow">JOIN ACTIVITY</p>
        <h2 id="join-title">輸入活動代碼</h2>
        <p>活動代碼由老師提供。</p>
      </div>
      <form className="join-form" onSubmit={lookup ? join : findActivity}>
        <label className="field-label" htmlFor="join-code">6 碼活動代碼</label>
        <div className="join-code-row">
          <input id="join-code" autoComplete="one-time-code" inputMode="text" maxLength={6} pattern="[A-HJ-NP-Z2-9]{6}" required value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
          {!lookup && <button className="primary-action" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={16} />}查詢</button>}
        </div>
        {lookup && (
          <>
            <div className="join-activity-ready"><Check size={16} /><span>活動可加入</span><small>{lookup.phase === "active" ? "搶答進行中" : "等待老師開始"}</small></div>
            <label className="field-label" htmlFor="group-id">選擇組別</label>
            <select id="group-id" required value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              {lookup.groupNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <label className="field-label" htmlFor="display-name">顯示名稱</label>
            <input id="display-name" autoComplete="nickname" maxLength={48} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <div className="join-actions">
              <button className="secondary-action" type="button" onClick={() => setLookup(null)}>更換代碼</button>
              <button className="primary-action" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={16} />}加入組別</button>
            </div>
          </>
        )}
        {error && <p className="form-message form-error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
