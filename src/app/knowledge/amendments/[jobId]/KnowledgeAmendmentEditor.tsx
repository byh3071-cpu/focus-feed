"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import KnowledgeApprovalStatus from "./KnowledgeApprovalStatus";
import { amendmentApprovalRequest, amendmentChangedRange, MAX_AMENDMENT_CHARS, type AmendmentDocument, type AmendmentWorkspace } from "@/lib/knowledge-amendments";

export default function KnowledgeAmendmentEditor({ jobId, initialRevision }: { jobId: string; initialRevision?: number }) {
  const [workspace, setWorkspace] = useState<AmendmentWorkspace | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [saved, setSaved] = useState("");
  const [comparison, setComparison] = useState("");
  const [compareRevision, setCompareRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<string | null>(null);
  const comparisonRequest = useRef(0);
  const endpoint = `/api/knowledge/jobs/${encodeURIComponent(jobId)}/amendments`;
  const dirty = markdown !== saved;
  const diff = useMemo(() => amendmentChangedRange(comparison, markdown), [comparison, markdown]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(initialRevision ? `${endpoint}?revision=${initialRevision}` : endpoint, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "수정안을 열지 못했어요.");
        if (controller.signal.aborted) return;
        const data = body as AmendmentWorkspace;
        const initial = data.current?.markdown ?? data.base.markdown;
        setWorkspace(data);
        setSaved(initial);
        setMarkdown(initial);
        setComparison(data.base.markdown);
        try {
          const key = `ff_amendment_seed:${jobId}`;
          const raw = initialRevision ? null : sessionStorage.getItem(key);
          if (raw) {
            const seed = JSON.parse(raw);
            if (seed.jobId === jobId && typeof seed.markdown === "string" && seed.markdown.trim() && seed.markdown.length <= MAX_AMENDMENT_CHARS) {
              setMarkdown(seed.markdown);
              setMessage("대화에서 만든 수정안을 가져왔어요. 아직 저장하지 않았습니다.");
              sessionStorage.removeItem(key);
            }
          }
        } catch { /* 임시 전달이 없어도 저장된 문서는 열 수 있다. */ }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "문서를 불러오지 못했어요.");
      }
    })();
    return () => controller.abort();
  }, [endpoint, jobId, initialRevision]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function save() {
    if (!workspace?.storageReady || saving || copying || checkingApproval || !dirty) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ markdown, baseRevision: workspace.base.revision, expectedRevision: workspace.history[0]?.revision ?? 0 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "저장하지 못했어요.");
      const amendment = body.amendment as AmendmentDocument;
      setSaved(amendment.markdown);
      setWorkspace({ ...workspace, current: amendment, history: [amendment, ...workspace.history.filter((item) => item.id !== amendment.id)].slice(0, 50) });
      setMessage(`수정안 v${amendment.revision}을 저장했어요. 승인본은 그대로입니다.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했어요. 입력 내용은 유지됩니다."); }
    finally { setSaving(false); }
  }

  async function selectComparison(revision: number) {
    if (!workspace) return;
    const number = ++comparisonRequest.current;
    if (revision === 0) { setCompareRevision(0); setComparison(workspace.base.markdown); setComparing(false); return; }
    setComparing(true); setError(null);
    try {
      const response = await fetch(`${endpoint}?revision=${revision}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if (!response.ok || !body.current) throw new Error(body.error ?? "이전 수정안을 불러오지 못했어요.");
      if (number !== comparisonRequest.current) return;
      setComparison(body.current.markdown); setCompareRevision(revision);
    } catch (cause) { if (number === comparisonRequest.current) setError(cause instanceof Error ? cause.message : "비교 문서를 불러오지 못했어요."); }
    finally { if (number === comparisonRequest.current) setComparing(false); }
  }

  function exportMarkdown() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `knowledge-amendment-${jobId}.md`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyApprovalRequest() {
    if (!workspace?.current || dirty || saving || copying || checkingApproval) return;
    setCopying(true);
    setError(null);
    try {
      const response = await fetch(`${endpoint}?revision=${workspace.current.revision}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if (!response.ok || body.current?.id !== workspace.current.id || body.current?.markdown !== saved) throw new Error("저장된 수정안을 다시 확인하지 못했어요.");
      const request = amendmentApprovalRequest(jobId, workspace.current);
      if (!request) throw new Error("수정안 승인 정보를 확인하지 못했어요.");
      setApprovalRequest(request);
      try {
        await navigator.clipboard.writeText(request);
        setMessage("재승인 요청을 복사했어요. 요한브레인을 사용할 수 있는 에이전트에게 전달해 주세요. 복사만으로 승인되지는 않아요.");
      } catch {
        setMessage("자동 복사가 안 됐어요. 아래 요청을 직접 복사해 전달해 주세요.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "재승인 요청을 만들지 못했어요."); }
    finally { setCopying(false); }
  }

  return <main className="mx-auto min-h-dvh max-w-6xl space-y-5 p-4 md:p-8">
    <a className="underline" href={`/knowledge?job=${encodeURIComponent(jobId)}`}>승인 문서로 돌아가기</a>
    <header><h1 className="text-xl font-semibold">수정안 · 변경 이력</h1>{workspace && <p className="mt-2">{workspace.base.title} · 기준 승인본 r{workspace.base.revision}</p>}</header>
    {error && <p role="alert" className="rounded border border-red-500 p-3">{error}</p>}
    {!workspace && !error && <p role="status">승인본과 수정안 이력을 불러오는 중</p>}
    {workspace && <>
      <p className="text-sm text-(--text-secondary)">수정안을 저장해도 승인본은 바뀌지 않아요. 저장할 때마다 별도 버전이 남습니다.</p>
      {!workspace.storageReady && <p role="status" className="rounded border border-amber-500 p-3">수정안 저장 기능은 연결 준비 중입니다. 지금 편집한 내용은 저장되지 않아요. 필요하면 Markdown으로 내보내 주세요.</p>}
      {message && <p role="status">{message}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!workspace.storageReady || !dirty || saving || copying || !markdown.trim()} onClick={() => void save()} className="min-h-11 rounded border px-4 disabled:opacity-40">{saving ? "저장 중" : "수정안 저장"}</button>
        <button type="button" onClick={exportMarkdown} className="min-h-11 rounded border px-4">Markdown 내보내기</button>
        <button type="button" disabled={!workspace.current || dirty || saving || copying} onClick={() => void copyApprovalRequest()} className="min-h-11 rounded border px-4 disabled:opacity-40">{copying ? "저장본 확인 중" : "재승인 요청 복사"}</button>
        <span className="text-sm">{dirty ? "저장하지 않은 변경 있음" : workspace.current ? `저장된 수정안 v${workspace.current.revision}` : "아직 저장한 수정안 없음"}</span>
      </div>
      {approvalRequest && <details className="rounded border p-3"><summary>복사한 재승인 요청</summary><pre className="mt-2 whitespace-pre-wrap break-all text-sm">{approvalRequest}</pre></details>}
      <KnowledgeApprovalStatus jobId={jobId} disabled={dirty || saving || copying} onBusy={setCheckingApproval} onLoad={(document) => { setMarkdown(document.markdown); setSaved(document.markdown); setWorkspace({ ...workspace, current: document }); setApprovalRequest(null); setMessage(`승인된 수정안 v${document.revision}을 불러왔어요.`); }} />
      <label className="block">수정안 본문<textarea aria-label="수정안 본문" value={markdown} disabled={saving || copying || checkingApproval} maxLength={MAX_AMENDMENT_CHARS} onChange={(event) => { setMarkdown(event.target.value); setApprovalRequest(null); setMessage(null); }} className="mt-2 min-h-80 w-full rounded border border-(--border-subtle) bg-transparent p-3 font-mono text-sm leading-6" /></label>
      <section className="space-y-3" aria-label="변경 내용 비교">
        <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold">변경 내용</h2><label>비교 기준 <select aria-label="비교 기준" value={compareRevision} onChange={(event) => void selectComparison(Number(event.target.value))} className="min-h-11 rounded border bg-(--surface-canvas) px-2">
          <option value={0}>승인본 r{workspace.base.revision}</option>
          {workspace.history.map((item) => <option key={item.id} value={item.revision}>수정안 v{item.revision} · {new Date(item.createdAt).toLocaleString("ko-KR")}</option>)}
        </select></label></div>
        <p className="text-xs text-(--text-secondary)">최근 수정안 50개까지 표시해요. 같은 앞뒤 문장은 접고 바뀐 구간을 비교합니다.</p>
        {comparing ? <p role="status">비교 문서를 불러오는 중</p> : !diff.changed ? <p>비교 기준과 내용이 같아요.</p> : <div className="grid gap-3 md:grid-cols-2">
          <div><h3>이전 · {diff.startLine}행부터</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-red-300 p-3 text-sm">{diff.before || "(내용 없음)"}</pre></div>
          <div><h3>수정 후</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-green-300 p-3 text-sm">{diff.after || "(내용 없음)"}</pre></div>
        </div>}
      </section>
    </>}
  </main>;
}
