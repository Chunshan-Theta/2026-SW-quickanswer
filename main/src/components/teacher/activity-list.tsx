import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { TeacherActivitySummary } from "@/features/activities/application/teacher-activities";

// The classroom app is used in Taiwan; pin the zone so server rendering does not depend on the host.
const createdFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function progress(activity: TeacherActivitySummary): string {
  if (activity.status === "ended") return activity.completedQuestionCount ? `已結束 ${activity.completedQuestionCount} 題` : "未開題即關閉";
  if (activity.phase === "mapping_review") return "待確認作答格";
  if (activity.openQuestionCount > 0) return `搶答中 ${activity.openQuestionCount} 題`;
  if (activity.questionCount > 0 && activity.completedQuestionCount >= activity.questionCount) return "題目皆已結束";
  if (activity.completedQuestionCount > 0) return `已結束 ${activity.completedQuestionCount} 題`;
  return "尚未開題";
}

/** 「我的課堂活動」: the teacher's way back to any console after leaving it (006). */
export function TeacherActivityList({ activities, unavailable = false }: { activities: TeacherActivitySummary[]; unavailable?: boolean }) {
  const ongoing = activities.filter((activity) => activity.status === "ongoing").length;
  return (
    <section className="my-activities" aria-labelledby="my-activities-title">
      <div className="my-activities-heading">
        <div>
          <p className="eyebrow">MY CLASSROOM ACTIVITIES</p>
          <h2 id="my-activities-title">我的課堂活動</h2>
        </div>
        {activities.length > 0 && <span>{ongoing} 個進行中 · 共 {activities.length} 個</span>}
      </div>
      {unavailable ? (
        <p className="form-message form-error" role="alert">目前無法載入活動清單，請稍後重新整理。</p>
      ) : activities.length === 0 ? (
        <p className="my-activities-empty">尚無課堂活動。匯入學習單後活動會出現在這裡，離開控制台後也能從這裡回去。</p>
      ) : (
        <ol className="my-activity-list">
          {activities.map((activity) => {
            const created = activity.createdAt ? new Date(activity.createdAt) : null;
            const statusLabel = activity.status === "ended" ? "已關閉" : "進行中";
            return (
              <li key={activity.activityId}>
                <Link
                  className={`my-activity-row my-activity-${activity.status}`}
                  href={`/teacher/activities/${activity.activityId}`}
                  aria-label={`${statusLabel}：${activity.title ?? "課堂活動"}，活動代碼 ${activity.joinCode}，進入教師控制台`}
                >
                  <span className={`activity-status activity-status-${activity.status}`}>{statusLabel}</span>
                  <span className="my-activity-main">
                    <strong>{activity.title ?? "未命名學習單"}</strong>
                    <small>{activity.questionCount} 題 · {activity.groupCount} 組 · {progress(activity)}</small>
                  </span>
                  <span className="my-activity-meta">
                    <span className="my-activity-code">{activity.joinCode}</span>
                    {created && <time dateTime={activity.createdAt!}>{createdFormat.format(created)}</time>}
                  </span>
                  <ArrowRight aria-hidden="true" className="my-activity-arrow" size={16} />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
