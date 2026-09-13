import type { Metadata } from "next";
import KnowledgeUsageEditor from "./KnowledgeUsageEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "자료 활용 메모 — Focus Feed", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <KnowledgeUsageEditor key={jobId} jobId={jobId} />;
}
