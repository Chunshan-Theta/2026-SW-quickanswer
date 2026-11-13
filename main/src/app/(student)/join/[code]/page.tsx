import { redirect } from "next/navigation";

export default async function StudentJoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/join?code=${encodeURIComponent(code)}`);
}
