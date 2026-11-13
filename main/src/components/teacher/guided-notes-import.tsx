"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, LoaderCircle, RotateCw, Upload } from "lucide-react";

type ImportQuestion = {
  questionNumber: string;
  prompt: string;
  mappingStatus: "confirmed" | "ambiguous" | "missing";
  candidateSlotTokens: string[];
};

type ImportResult = { activityId: string; joinCode: string; phase: "ready" | "mapping_review"; questions: ImportQuestion[] };
type ApiError = { error?: { message?: string } };

function spreadsheetIdFromInput(value: string): string {
  const match = value.match(/\/spreadsheets\/d\/([^/?#]+)/);
  return match?.[1] ?? value.trim();
}

export function TeacherGuidedNotesImport() {
  const [spreadsheet, setSpreadsheet] = useState("");
  const [sheetId, setSheetId] = useState("0");
  const [groups, setGroups] = useState("A, B");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    setSelections({});
    try {
      const response = await fetch("/api/activities/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: spreadsheetIdFromInput(spreadsheet),
          sheetId: Number(sheetId),
          groupNames: groups.split(",").map((group) => group.trim()).filter(Boolean),
        }),
      });
      const body = await response.json() as ImportResult & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "無法匯入工作表。");
      setResult(body);
      setNotice(body.phase === "ready" ? "題目已完成辨識，可以進行下一步。" : "有答案空格需要確認，確認完成前無法開始活動。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "連線失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmMappings() {
    if (!result) return;
    const resolutions = result.questions
      .filter((question) => question.mappingStatus === "ambiguous")
      .map((question) => ({ questionNumber: question.questionNumber, answerSlotToken: selections[question.questionNumber] ?? "" }));
    if (resolutions.some((resolution) => !resolution.answerSlotToken)) {
      setError("請為每一題選擇答案空格。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/activities/${result.activityId}/mappings/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutions }),
      });
      const body = await response.json() as ImportResult & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "無法確認答案空格。");
      setResult(body);
      setNotice(body.phase === "ready" ? "答案空格已確認，活動準備完成。" : "仍有題目尚未完成答案空格確認。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "連線失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="teacher-import-layout">
      <form className="import-form" onSubmit={submitImport}>
        <div className="section-heading">
          <h2>來源工作表</h2>
          <span>需要編輯權限</span>
        </div>
        <label className="field-label" htmlFor="spreadsheet">Google Sheets 網址或試算表 ID</label>
        <input id="spreadsheet" autoComplete="url" placeholder="貼上試算表連結或 ID" required value={spreadsheet} onChange={(event) => setSpreadsheet(event.target.value)} />
        <div className="import-form-row">
          <div>
            <label className="field-label" htmlFor="sheet-id">工作表 gid</label>
            <input id="sheet-id" inputMode="numeric" pattern="[0-9]+" required value={sheetId} onChange={(event) => setSheetId(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="groups">組別名稱</label>
            <input id="groups" required value={groups} onChange={(event) => setGroups(event.target.value)} />
          </div>
        </div>
        <p className="field-hint">組別以逗號分隔。系統會依題號掃描題目與答案空格，不使用固定儲存格位置。</p>
        <button className="primary-action" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={16} />}
          {busy ? "正在讀取" : "匯入並預覽"}
        </button>
      </form>

      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message form-notice" role="status">{notice}</p>}

      {result && (
        <section className="question-preview" aria-labelledby="preview-title">
          <div className="section-heading">
            <h2 id="preview-title">題目預覽</h2>
            <span>{result.questions.length} 題 · {result.phase === "ready" ? "已確認" : "待確認"}</span>
          </div>
          <ol className="preview-list">
            {result.questions.map((question) => (
              <li className="preview-row" key={`${result.activityId}-${question.questionNumber}`}>
                <span className="preview-number">{question.questionNumber.padStart(2, "0")}</span>
                <div className="preview-prompt">
                  <strong>{question.prompt}</strong>
                  {question.mappingStatus === "ambiguous" ? (
                    <label className="field-label mapping-field">
                      選擇題號 {question.questionNumber} 的答案空格
                      <select value={selections[question.questionNumber] ?? ""} onChange={(event) => setSelections((current) => ({ ...current, [question.questionNumber]: event.target.value }))}>
                        <option value="">選擇答案空格</option>
                        {question.candidateSlotTokens.map((token, index) => <option key={token} value={token}>候選答案格 {index + 1}</option>)}
                      </select>
                    </label>
                  ) : (
                    <small className={question.mappingStatus === "confirmed" ? "mapping-ok" : "mapping-missing"}>
                      {question.mappingStatus === "confirmed" ? "答案空格已確認" : "找不到答案空格"}
                    </small>
                  )}
                </div>
                {question.mappingStatus === "confirmed" && <Check aria-label="已確認" className="mapping-check" size={17} />}
              </li>
            ))}
          </ol>
          {result.phase === "mapping_review" && (
            <button className="primary-action" disabled={busy} type="button" onClick={confirmMappings}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={16} />}
              確認答案空格 <ArrowRight size={16} />
            </button>
          )}
          {result.phase === "ready" && (
            <div className="ready-actions">
              <Link className="primary-action" href={`/teacher/activities/${result.activityId}`}>進入教師控制台 <ArrowRight size={16} /></Link>
              <button className="secondary-action" type="button" onClick={() => { setResult(null); setNotice(""); setSelections({}); }}>
                <RotateCw size={15} />重新匯入
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
