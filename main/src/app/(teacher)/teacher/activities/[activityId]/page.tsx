import Link from "next/link";
import { ArrowLeft, Layers3, RadioTower } from "lucide-react";
import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/session";
import { getTeacherActivity } from "@/features/activities/application/teacher-activity";
import { TeacherRoundControl } from "@/components/teacher/round-control";

export const runtime = "nodejs";

export default async function TeacherActivityPage({ params }: { params: Promise<{ activityId: string }> }) {
  const session = await getServerSession();
  if (!session || session.role !== "teacher") redirect("/teacher/import");
  const { activityId } = await params;
  const activity = await getTeacherActivity(activityId, session);

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
          <span className="topbar-context">教師活動控制台</span>
          <div className="topbar-spacer" />
          <span className="connection"><i />教師已登入</span>
        </header>
        <div className="content-wrap">
          <Link className="back-link" href="/teacher/import"><ArrowLeft size={15} />返回匯入</Link>
          <div className="page-heading">
            <div>
              <p className="eyebrow">LIVE CLASSROOM / TEACHER</p>
              <h1>課堂搶答控制</h1>
              <p className="subheading">勾選題目即可同時開放搶答；各題即時排名，可逐題或一次結束。</p>
            </div>
            <span className="date-stamp">{activity.questions.length} 題 · {activity.groupNames.length} 組</span>
          </div>
          <TeacherRoundControl activity={activity} />
        </div>
      </section>
    </main>
  );
}
