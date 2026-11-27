import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Layers3, RadioTower } from "lucide-react";
import { TeacherActivityList } from "@/components/teacher/activity-list";
import { TeacherGuidedNotesImport } from "@/components/teacher/guided-notes-import";
import { listTeacherActivities, type TeacherActivitySummary } from "@/features/activities/application/teacher-activities";
import { getTeacherServerSession } from "@/server/auth/session";

export const runtime = "nodejs";

export default async function TeacherImportPage() {
  const session = await getTeacherServerSession();
  const isTeacher = session?.role === "teacher";
  // 「我的課堂活動」 is the way back to a console the teacher left (006); a Redis outage only hides it.
  let activities: TeacherActivitySummary[] = [];
  let activitiesUnavailable = false;
  if (isTeacher) {
    try {
      activities = await listTeacherActivities(session.sub);
    } catch {
      activitiesUnavailable = true;
    }
  }

  return (
    <main className="workspace">
      <aside className="rail" aria-label="主要導覽">
        <Link aria-label="Quickanswer 首頁" className="brand-mark" href="/">q<span>.</span></Link>
        <div className="rail-rule" />
        <Link aria-label="教師工作區" className="rail-link rail-link-active" href="/teacher/import"><Layers3 size={19} /></Link>
        <Link aria-label="學生加入活動" className="rail-link" href="/join"><RadioTower size={19} /></Link>
        <div className="rail-spacer" />
      </aside>
      <section className="main-column">
        <header className="topbar">
          <Link className="wordmark" href="/">quickanswer</Link>
          <span className="topbar-context">教師工作區</span>
          <div className="topbar-spacer" />
          <span className="connection"><i />{isTeacher ? "教師已登入" : "尚未登入"}</span>
        </header>
        <div className="content-wrap">
          <Link className="back-link" href="/"><ArrowLeft size={15} />返回首頁</Link>
          <div className="page-heading teacher-import-heading">
            <div>
              <p className="eyebrow">TEACHER WORKSPACE / GUIDED NOTES</p>
              <h1>匯入課堂題目</h1>
              <p className="subheading">從 Google Sheets 載入題目，確認答案空格後準備活動。</p>
            </div>
            <span className="date-stamp">單題與題組 · 依標題列動態辨識</span>
          </div>
          {isTeacher ? (
            <div className="teacher-workspace-sections">
              <TeacherActivityList activities={activities} unavailable={activitiesUnavailable} />
              <TeacherGuidedNotesImport />
            </div>
          ) : (
            <section className="auth-prompt" aria-labelledby="auth-title">
              <div>
                <p className="eyebrow">GOOGLE ACCOUNT</p>
                <h2 id="auth-title">連結教師帳戶</h2>
                <p>登入後選取可編輯的 Guided Notes 工作表，授權僅由伺服器保存。</p>
              </div>
              {/* Plain <a>: next/link would request the OAuth start route twice and mismatch the state cookie. */}
              <a className="primary-action" href="/api/auth/google/start">使用 Google 登入 <ArrowUpRight size={16} /></a>
            </section>
          )}
          <footer className="page-footer">
            <span>QUICKANSWER · CLASSROOM TOOLS</span>
            <span>Google 試算表僅由伺服器存取</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
