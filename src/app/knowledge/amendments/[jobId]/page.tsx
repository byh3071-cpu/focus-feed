import type { Metadata } from "next";
import KnowledgeAmendmentEditor from "./KnowledgeAmendmentEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "지식 수정안 — Focus Feed", robots: { index: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ revision?: string | string[] }> }) {
  const { jobId } = await params;
  const { revision } = await searchParams;
  if (revision !== undefined && (typeof revision !== "string" || !/^[1-9]\d*$/.test(revision) || !Number.isSafeInteger(Number(revision)))) return <p role="alert">수정안 버전 주소가 올바르지 않아요.</p>;
  return <KnowledgeAmendmentEditor key={`${jobId}:${revision ?? "latest"}`} jobId={jobId} initialRevision={revision === undefined ? undefined : Number(revision)} />;
}
