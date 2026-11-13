import Link from "next/link";
import { ArrowLeft, Layers3, RadioTower } from "lucide-react";
import { StudentJoinForm } from "@/components/student/join-form";

export default function StudentJoinPage() {
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
          <span className="topbar-context">學生加入</span>
          <div className="topbar-spacer" />
          <span className="connection"><i />準備加入</span>
        </header>
        <div className="content-wrap join-content">
          <Link className="back-link" href="/"><ArrowLeft size={15} />返回首頁</Link>
          <div className="page-heading">
            <div>
              <p className="eyebrow">CLASSROOM RESPONSE</p>
              <h1>加入課堂搶答</h1>
              <p className="subheading">輸入老師提供的活動代碼，選擇組別後即可加入。</p>
            </div>
            <span className="date-stamp">以組別為單位作答</span>
          </div>
          <StudentJoinForm />
        </div>
      </section>
    </main>
  );
}
