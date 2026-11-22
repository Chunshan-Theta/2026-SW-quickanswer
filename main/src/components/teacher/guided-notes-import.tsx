"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import Script from "next/script";
import { ArrowRight, Check, LoaderCircle, RotateCw, Upload } from "lucide-react";

type ImportBlank = { label: string | null; prompt: string; mappingStatus: "confirmed" | "ambiguous" | "missing" };
type ImportQuestion = {
  questionNumber: string;
  prompt: string;
  kind?: "single" | "group";
  mappingStatus: "confirmed" | "ambiguous" | "missing";
  candidateSlotTokens: string[];
  blanks?: ImportBlank[];
};

type ImportResult = { activityId: string; joinCode: string; phase: "ready" | "mapping_review"; questions: ImportQuestion[] };
type ImportIssue = { code: string; message: string; questionNumber?: string; rowNumber?: number };
type ApiError = { error?: { message?: string; details?: unknown } };
type SheetTab = { sheetId: number; title: string; index: number };

class ImportError extends Error {
  constructor(message: string, public readonly issues: ImportIssue[]) {
    super(message);
  }
}

function issuesFrom(details: unknown): ImportIssue[] {
  return Array.isArray(details)
    ? details.filter((item): item is ImportIssue => typeof item === "object" && item !== null && typeof (item as ImportIssue).message === "string")
    : [];
}
type PickerResponse = { action: string; docs?: Array<{ id?: string; name?: string }> };

interface PickerBuilder {
  addView(view: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setCallback(callback: (response: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

declare global {
  interface Window {
    gapi?: { load(api: "picker", options: { callback: () => void; onerror: () => void }): void };
    google?: {
      picker?: {
        PickerBuilder: new () => PickerBuilder;
        ViewId: { SPREADSHEETS: string };
        Action: { PICKED: string };
      };
    };
  }
}

function spreadsheetIdFromInput(value: string): string {
  const match = value.match(/\/spreadsheets\/d\/([^/?#]+)/);
  return match?.[1] ?? value.trim();
}

export function TeacherGuidedNotesImport() {
  const [spreadsheet, setSpreadsheet] = useState("");
  const [spreadsheetName, setSpreadsheetName] = useState("");
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [sheetId, setSheetId] = useState("");
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [groups, setGroups] = useState("A, B");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pickerApiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY ?? "";
  const pickerAppId = process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER ?? "";
  const pickerConfigured = Boolean(pickerApiKey && pickerAppId);

  async function loadTabs(spreadsheetId: string) {
    setTabs([]);
    setSheetId("");
    const response = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/tabs`);
    const body = await response.json() as { tabs?: SheetTab[] } & ApiError;
    if (!response.ok || !body.tabs) throw new Error(body.error?.message ?? "無法讀取工作表分頁。");
    if (body.tabs.length === 0) throw new Error("這份試算表沒有可用的工作表分頁。");
    setTabs(body.tabs);
    if (body.tabs.length === 1) {
      setSheetId(String(body.tabs[0].sheetId));
      setNotice(`已選取試算表與分頁「${body.tabs[0].title}」，可以匯入。`);
    } else {
      setNotice(`這份試算表有 ${body.tabs.length} 個分頁，請選擇要匯入的分頁。`);
    }
  }

  async function selectSpreadsheet() {
    setError("");
    setIssues([]);
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/google/picker-token");
      const body = await response.json() as { accessToken?: string } & ApiError;
      if (!response.ok || !body.accessToken) throw new Error(body.error?.message ?? "無法取得 Google Picker 授權。");
      if (!window.gapi || !pickerApiKey || !pickerAppId) throw new Error("Google Picker 尚未載入或未完成設定。");

      await new Promise<void>((resolve, reject) => {
        window.gapi!.load("picker", { callback: resolve, onerror: () => reject(new Error("無法載入 Google Picker。")) });
      });
      const pickerApi = window.google?.picker;
      if (!pickerApi) throw new Error("Google Picker 尚未載入，請重試。");

      new pickerApi.PickerBuilder()
        .addView(pickerApi.ViewId.SPREADSHEETS)
        .setOAuthToken(body.accessToken)
        .setDeveloperKey(pickerApiKey)
        .setAppId(pickerAppId)
        .setCallback((pickerResponse) => {
          if (pickerResponse.action !== pickerApi.Action.PICKED) return;
          const file = pickerResponse.docs?.[0];
          if (!file?.id) {
            setError("Google Picker 未提供試算表識別碼，請重新選取。");
            return;
          }
          setSpreadsheet(file.id);
          setSpreadsheetName(file.name ?? "");
          setResult(null);
          setSelections({});
          setBusy(true);
          loadTabs(file.id)
            .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "無法讀取工作表分頁。"))
            .finally(() => setBusy(false));
        })
        .build()
        .setVisible(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法開啟 Google Picker。");
    } finally {
      setBusy(false);
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!spreadsheet) {
      setError("請先使用 Google Picker 選取試算表。");
      return;
    }
    if (!sheetId) {
      setError("請選擇要匯入的工作表分頁。");
      return;
    }
    setBusy(true);
    setError("");
    setIssues([]);
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
      if (!response.ok) throw new ImportError(body.error?.message ?? "無法匯入工作表。", issuesFrom(body.error?.details));
      setResult(body);
      setNotice(body.phase === "ready" ? "題目已完成辨識，可以進行下一步。" : "有答案空格需要確認，確認完成前無法開始活動。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "連線失敗，請稍後重試。");
      setIssues(caught instanceof ImportError ? caught.issues : []);
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
        <Script
          src="https://apis.google.com/js/api.js"
          strategy="afterInteractive"
          onLoad={() => setPickerLoaded(true)}
          onError={() => setError("無法載入 Google Picker，請檢查網路連線。")}
        />
        <label className="field-label" htmlFor="spreadsheet">已選取試算表</label>
        <div className="import-form-row">
          <input id="spreadsheet" readOnly placeholder="請從 Google 雲端硬碟選取試算表" value={spreadsheetName ? `${spreadsheetName} (${spreadsheet})` : spreadsheet} />
          <button className="secondary-action" disabled={busy || !pickerConfigured || !pickerLoaded} type="button" onClick={selectSpreadsheet}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={16} />}
            從 Google 雲端硬碟選取
          </button>
        </div>
        {!pickerConfigured && <p className="field-hint">尚未設定 Google Picker API 金鑰與 Cloud 專案編號，請聯絡管理員。</p>}
        <div className="import-form-row">
          <div>
            <label className="field-label" htmlFor="sheet-tab">工作表分頁</label>
            <select id="sheet-tab" disabled={busy || tabs.length === 0} required value={sheetId} onChange={(event) => setSheetId(event.target.value)}>
              <option value="">{tabs.length === 0 ? "請先選取試算表" : "選擇分頁"}</option>
              {tabs.map((tab) => <option key={tab.sheetId} value={String(tab.sheetId)}>{tab.title}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="groups">組別名稱</label>
            <input id="groups" required value={groups} onChange={(event) => setGroups(event.target.value)} />
          </div>
        </div>
        <p className="field-hint">組別以逗號分隔。系統依標題列（題號／題目／作答）與題號辨識題目與作答格，支援題組，不使用固定儲存格位置。</p>
        <button className="primary-action" disabled={busy || !spreadsheet || !sheetId} type="submit">
          {busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={16} />}
          {busy ? "正在讀取" : "匯入並預覽"}
        </button>
      </form>

      {error && (
        <div className="form-message form-error" role="alert">
          <p>{error}</p>
          {issues.length > 0 && (
            <ul className="import-issues">
              {issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
            </ul>
          )}
        </div>
      )}
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
                  {question.kind === "group" && question.blanks ? (
                    <>
                      <strong>題組 · {question.blanks.length} 小題</strong>
                      <ul className="blank-answers">
                        {question.blanks.map((blank, index) => <li key={index}><span>{blank.label ?? `（${index + 1}）`}</span>{blank.prompt || "（未提供子題敘述）"}</li>)}
                      </ul>
                    </>
                  ) : (
                    <strong>{question.prompt || "（未提供題目敘述）"}</strong>
                  )}
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
