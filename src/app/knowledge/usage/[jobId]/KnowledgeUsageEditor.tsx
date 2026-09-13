"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UsageContent, UsageVersion } from "@/lib/knowledge-usage-context";

type Workspace = { title: string; version: UsageVersion; record: UsageContent & { revision: number; updatedAt: string | null } };
const labels = { project: "프로젝트", question: "궁금한 점", document: "관련 문서" };

export default function KnowledgeUsageEditor({ jobId }: { jobId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [content, setContent] = useState<UsageContent>({ savedReason: "", links: [] });
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const [login, setLogin] = useState(false);
  const endpoint = `/api/knowledge/jobs/${encodeURIComponent(jobId)}/usage-context`;
  const back = `/knowledge?job=${encodeURIComponent(jobId)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) { setLogin(response.status === 401); throw new Error(body.error || "메모를 열지 못했어요."); }
      if (!controller.signal.aborted) { setWorkspace(body); setContent({ savedReason: body.record.savedReason, links: body.record.links }); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "메모를 열지 못했어요."); });
    return () => controller.abort();
  }, [endpoint]);

  async function save() {
    if (!workspace || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: workspace.version, expectedRevision: workspace.record.revision, content }) });
      const body = await response.json();
      if (!response.ok) { setLogin(response.status === 401); throw new Error(body.error || "메모를 저장하지 못했어요."); }
      setWorkspace(body); setContent({ savedReason: body.record.savedReason, links: body.record.links }); setNotice("활용 메모를 저장했어요.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했어요."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-2xl space-y-5 p-5 md:p-8">
    <div className="flex gap-4 text-sm"><a href={back} className="underline">자료로 돌아가기</a><Link href="/knowledge/usage" className="underline">활용 메모 모아보기</Link></div>
    <h1 className="text-xl font-semibold">이 자료를 어디에 쓸까?</h1>
    <p className="text-sm text-(--text-secondary)">승인 문서 옆에 남기는 나만의 활용 메모예요. 이 서버에 저장되며, 다른 기기에서는 같은 서버에 접속해야 볼 수 있어요.</p>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {login && <a target="_blank" rel="noopener noreferrer" className="underline" href={`/login?next=${encodeURIComponent(`/knowledge/usage/${jobId}`)}`}>새 탭에서 로그인</a>}
    {!workspace && !error && <p role="status">승인 버전과 메모를 확인하는 중…</p>}
    {workspace && <>
      <h2 className="font-medium">{workspace.title}</h2>
      <p className="text-sm text-(--text-secondary)">기준: {workspace.version.kind === "amendment" ? "수정안" : "원본"} v{workspace.version.revision} · 메모 {workspace.record.revision ? `${workspace.record.revision}회 저장` : "아직 없음"}</p>
      <fieldset disabled={busy} className="space-y-4">
        <label className="block space-y-2"><span>왜 저장했나요?</span><textarea aria-label="저장 이유" rows={4} maxLength={2000} className="w-full rounded-lg border border-(--border-subtle) bg-(--surface-subtle) p-3" value={content.savedReason} onChange={event => { setNotice(""); setContent({ ...content, savedReason: event.target.value }); }} placeholder="다시 읽을 상황이나 참고하고 싶은 부분을 적어 주세요." /></label>
        {content.links.map((link, index) => <div key={index} className="flex flex-wrap gap-2">
          <select aria-label={`연결 ${index + 1} 종류`} className="rounded border bg-(--surface-subtle) p-2" value={link.kind} onChange={event => setContent({ ...content, links: content.links.map((item, i) => i === index ? { ...item, kind: event.target.value as typeof link.kind } : item) })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input aria-label={`연결 ${index + 1} 내용`} maxLength={500} className="min-w-0 flex-1 rounded border bg-(--surface-subtle) p-2" placeholder={link.kind === "document" ? "https://…" : link.kind === "question" ? "어떤 점이 궁금한가요?" : "프로젝트 이름"} value={link.ref} onChange={event => setContent({ ...content, links: content.links.map((item, i) => i === index ? { ...item, ref: event.target.value } : item) })} />
          <button type="button" aria-label={`연결 ${index + 1} 제거`} onClick={() => setContent({ ...content, links: content.links.filter((_, i) => i !== index) })}>제거</button>
        </div>)}
        <button type="button" className="text-sm underline disabled:opacity-50" disabled={content.links.length >= 8} onClick={() => setContent({ ...content, links: [...content.links, { kind: "project", ref: "" }] })}>연결 추가</button>
        <p className="text-xs text-(--text-secondary)">프로젝트 이름·질문·문서 링크를 최대 8개 남길 수 있어요.</p>
        <button type="button" className="rounded-lg bg-(--ai-accent) px-4 py-2 text-white disabled:opacity-50" onClick={() => void save()}>{busy ? "저장 중…" : "활용 메모 저장"}</button>
      </fieldset>
      {notice && <p role="status">{notice}</p>}
    </>}
  </main>;
}
