import { redirect } from "next/navigation";
import { withSeat } from "@/lib/session/seat";

// Legacy URL: the student activity page lives at /student/activity; keep the tab's seat.
export default async function LegacyStudentActivityPage({ searchParams }: { searchParams: Promise<{ seat?: string | string[] }> }) {
  const { seat } = await searchParams;
  redirect(typeof seat === "string" ? withSeat("/student/activity", seat) : "/student/activity");
}
