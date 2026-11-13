import Link from "next/link";
import { ArrowLeft, Layers3, RadioTower } from "lucide-react";
import { redirect } from "next/navigation";
import { StudentActivityRound, type Snapshot } from "@/components/student/activity-round";
import { getActivitySnapshot } from "@/features/activities/application/activity-snapshot";
import { getServerSession } from "@/server/auth/session";

export const runtime = "nodejs";

export default async function StudentActivityPage() {
  const session = await getServerSession();
  if (!session || session.role !== "student" || !session.activityId || !session.groupId) redirect("/join");
  const snapshot = await getActivitySnapshot(session.activityId, session) as Snapshot;

  return (
    <main className="workspace">
      <aside className="rail" aria-label="主要導覽">
        <Link aria-label="Quickanswer 首頁" className="brand-mark" href="/">q<span>.</span></Link>
        <div className="rail-rule" />
        <Link aria-label="教師工作區" className="rail-link" href="/teacher/import"><Layers3 size={19} /></Link>
        <Link aria-label="學生活動" className="rail-link rail-link-active" href="/student/activity"><RadioTower size={19} /></Link>
        <div className="rail-spacer" />
      </aside>
      <section className="main-column">
        <header className="topbar">
          <Link className="wordmark" href="/">quickanswer</Link>
          <span className="topbar-context">學生搶答</span>
          <div className="topbar-spacer" />
          <span className="connection"><i />{session.groupId} 組</span>
        </header>
        <div className="content-wrap student-activity-content">
          <Link className="back-link" href="/join"><ArrowLeft size={15} />離開活動</Link>
          <div className="page-heading">
            <div>
              <p className="eyebrow">CLASSROOM RESPONSE / STUDENT</p>
              <h1>小組搶答</h1>
              <p className="subheading">依老師開啟的題目提交答案；結果會在本題結束後公布。</p>
            </div>
            <span className="date-stamp">{session.groupId} 組</span>
          </div>
          <StudentActivityRound activityId={session.activityId} groupId={session.groupId} initialSnapshot={snapshot} />
        </div>
      </section>
    </main>
  );
}