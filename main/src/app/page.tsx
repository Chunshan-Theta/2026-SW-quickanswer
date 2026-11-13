import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CircleHelp, Layers3, RadioTower } from "lucide-react";

export default function HomePage() {
  return (
    <main className="workspace">
      <aside className="rail" aria-label="主要導覽">
        <Link aria-label="Quickanswer 首頁" className="brand-mark" href="/">
          q<span>.</span>
        </Link>
        <div className="rail-rule" />
        <Link aria-label="教師工作區" className="rail-link rail-link-active" href="/teacher">
          <Layers3 size={19} strokeWidth={1.8} />
        </Link>
        <Link aria-label="學生加入活動" className="rail-link" href="/join">
          <RadioTower size={19} strokeWidth={1.8} />
        </Link>
        <div className="rail-spacer" />
        <Link aria-label="使用說明" className="rail-link" href="/help">
          <CircleHelp size={19} strokeWidth={1.8} />
        </Link>
        <div className="avatar" aria-label="課堂搶答">課</div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <Link className="wordmark" href="/">quickanswer</Link>
          <span className="topbar-context">課堂工作區</span>
          <div className="topbar-spacer" />
          <span className="connection"><i />系統就緒</span>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CLASSROOM RESPONSE</p>
              <h1>課堂搶答</h1>
              <p className="subheading">從 Guided Notes 開始，讓每組都準備好。</p>
            </div>
            <span className="date-stamp">教師與學生共用空間</span>
          </div>

          <section aria-labelledby="start-heading" className="start-section">
            <div className="section-heading">
              <h2 id="start-heading">開始使用</h2>
              <span>選擇你的角色</span>
            </div>
            <div className="role-grid">
              <Link className="role-panel teacher-panel" href="/teacher/import">
                <div className="panel-topline">
                  <span className="role-index">01 / TEACHER</span>
                  <ArrowUpRight size={20} />
                </div>
                <div className="role-copy">
                  <h3>建立課堂活動</h3>
                  <p>匯入 Guided Notes、控制題目節奏，並查看每組作答。</p>
                </div>
                <div className="panel-action">教師工作區 <ArrowUpRight size={16} /></div>
              </Link>
              <Link className="role-panel student-panel" href="/join">
                <div className="panel-topline">
                  <span className="role-index">02 / STUDENT</span>
                  <ArrowDownLeft size={20} />
                </div>
                <div className="role-copy">
                  <h3>加入搶答</h3>
                  <p>輸入老師提供的活動代碼，選擇組別並準備作答。</p>
                </div>
                <div className="panel-action">學生加入頁 <ArrowUpRight size={16} /></div>
              </Link>
            </div>
          </section>

          <section aria-labelledby="activity-heading" className="activity-section">
            <div className="section-heading">
              <h2 id="activity-heading">最近活動</h2>
              <Link href="/teacher">查看教師工作區 <ArrowUpRight size={14} /></Link>
            </div>
            <div className="activity-list activity-empty">
              <span className="empty-mark">—</span>
              <div>
                <strong>尚無課堂活動</strong>
                <small>匯入 Guided Notes 後，活動記錄會顯示在這裡。</small>
              </div>
              <Link href="/teacher/import">匯入學習單 <ArrowUpRight size={14} /></Link>
            </div>
          </section>

          <footer className="page-footer">
            <span>QUICKANSWER · CLASSROOM TOOLS</span>
            <span>即時同步由伺服器管理</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
