import Link from "next/link";
import { ArrowLeft, Layers3, RadioTower } from "lucide-react";
import { redirect } from "next/navigation";
import { StudentActivityRound } from "@/components/student/activity-round";
import { getActivitySnapshot } from "@/features/activities/application/activity-snapshot";
import { getServerSession } from "@/server/auth/session";

export const runtime = "nodejs";

export default async function StudentActivityPage() {
  const session = await getServerSession();
  if (!session || session.role !== "student" || !session.activityId || !session.groupId) redirect("/join");
  const snapshot = await getActivitySnapshot(session.activityId, session);

  return (
    <main className="workspace">
      <aside className="rail" aria-label="主要導覽">
        <Link aria-label="Quickanswer 首頁" className="brand-mark" href="/">q<span>.</span></Link>
        <div className="rail-rule" />
        <Link aria-label="教師工作區" className="rail-link" href="/teacher/import"><Layers3 size={19} /></Link>
        <Link aria-label="學生加入活動" className="rail-link rail-link-active" href="/join"><RadioTower size={19} /></Link>
        <div className="rail-spacer" />
      </aside>
      <section className="main-column">
        <header className="topbar">
          <Link className="wordmark" href="/">quickanswer</Link>
          <span className="topbar-context">學生搶答</span>
          <div className="topbar-spacer" />
          <span className="connection">組別：{session.groupId}</span>
        </header>
        <div className="content-wrap">
          <Link className="back-link" href="/join"><ArrowLeft size={15} />離開活動</Link>
          <div className="page-heading">
            <div>
              <p className="eyebrow">LIVE CLASSROOM / STUDENT</p>
              <h1>課堂搶答</h1>
              <p className="subheading">題目開放時代表所屬組別提交一份答案。</p>
            </div>
            <span className="date-stamp">活動階段由伺服器同步</span>
          </div>
          <StudentActivityRound activityId={session.activityId} groupId={session.groupId} initialSnapshot={snapshot} />
        </div>
      </section>
    </main>
  );
}
