"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageContextRecord, UsageVersion } from "@/lib/knowledge-usage-context";

type Results = { items: { jobId: string; title: string; version: UsageVersion; record: UsageContextRecord }[]; total: number; page: number; pageSize: number; noCurrentMemo: number; unavailableDocuments: number };
const labels = { project: "프로젝트", question: "궁금한 점", document: "관련 문서" };

export default function KnowledgeUsageSearch() {
  const [query, setQuery] = useState(""); const [searchedQuery, setSearchedQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState(""); const [login, setLogin] = useState(false); const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const search = useCallback(async (text: string, page = 0) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(""); setLogin(false); setResults(null); setSearchedQuery(text);
    try {
      const response = await fetch(`/api/knowledge/usage-contexts?q=${encodeURIComponent(text)}&page=${page}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)]) });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setLogin(response.status === 401); throw new Error(body.error || "메모를 찾지 못했어요."); }
      setResults(body);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "메모를 찾지 못했어요."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void search(""); return () => request.current?.abort(); }, [search]);

  return <main className="mx-auto max-w-3xl space-y-5 p-5 md:p-8">
    <a href="/knowledge" className="text-sm underline">지식함으로 돌아가기</a>
    <h1 className="text-xl font-semibold">활용 메모 찾기</h1>
    <p className="text-sm text-(--text-secondary)">현재 승인본의 저장 이유·프로젝트·질문·문서 링크에서 찾아요. 이 서버에 저장된 내 메모만 표시해요.</p>
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void search(query.trim()); }}>
      <input aria-label="활용 메모 검색" placeholder="예: 요한브레인, 영상 작업, 적용 방법" maxLength={120} className="min-w-0 flex-1 rounded-lg border border-(--border-subtle) bg-(--surface-subtle) p-3" value={query} onChange={event => setQuery(event.target.value)} />
      <button disabled={loading} className="rounded-lg bg-(--ai-accent) px-4 py-2 text-white disabled:opacity-50">검색</button>
    </form>
    {loading && <p role="status">승인 버전과 활용 메모를 확인하는 중…</p>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p>{login && <a className="mr-4 underline" href="/login?next=%2Fknowledge%2Fusage" target="_blank" rel="noopener noreferrer">새 탭에서 로그인</a>}<button className="underline" onClick={() => void search(query.trim())}>다시 시도</button></div>}
    {results && <>
      <p role="status" className="text-sm">{results.total ? `${results.total}개 메모` : searchedQuery ? "검색 결과가 없어요. 다른 단어로 찾아보세요." : "현재 승인본에 저장된 활용 메모가 없어요. 자료를 열고 ‘활용 메모’에서 남겨보세요."}</p>
      {results.noCurrentMemo > 0 && <p className="text-sm text-(--text-secondary)">메모 폴더가 있는 자료 중 {results.noCurrentMemo}개는 현재 승인본의 메모가 없거나 비어 있어요. 이전 버전의 메모는 자동으로 가져오지 않아요.</p>}
      {results.unavailableDocuments > 0 && <p className="text-sm text-(--text-secondary)">접근 가능한 완료 자료로 확인되지 않은 메모 {results.unavailableDocuments}개는 표시하지 않았어요.</p>}
      <ul className="space-y-4">{results.items.map(item => <li key={item.jobId} className="space-y-3 rounded-xl border border-(--border-subtle) p-4">
        <h2 className="font-semibold">{item.title}</h2>
        <p className="text-xs text-(--text-secondary)">{item.version.kind === "amendment" ? "수정안" : "원본"} v{item.version.revision} · {item.record.updatedAt ? new Date(item.record.updatedAt).toLocaleDateString("ko-KR") : ""}</p>
        {item.record.savedReason && <p className="whitespace-pre-wrap text-sm">{item.record.savedReason}</p>}
        <ul className="space-y-1 text-sm">{item.record.links.map((link, index) => <li key={index} className="break-words"><span className="text-(--text-secondary)">{labels[link.kind]}: </span>{link.label ? `${link.label} · ` : ""}{link.ref}</li>)}</ul>
        <div className="flex gap-4 text-sm"><a className="underline" href={`/knowledge/usage/${encodeURIComponent(item.jobId)}`}>활용 메모 열기</a><a className="underline" href={item.version.amendmentId ? `/knowledge/amendments/${encodeURIComponent(item.jobId)}?revision=${item.version.revision}` : `/knowledge?job=${encodeURIComponent(item.jobId)}`}>기준 자료 열기</a></div>
      </li>)}</ul>
      {results.total > results.pageSize && <nav aria-label="메모 검색 페이지" className="flex items-center gap-4"><button className="underline disabled:opacity-50" disabled={results.page === 0 || loading} onClick={() => void search(searchedQuery, results.page - 1)}>이전</button><span>{results.page + 1} / {Math.ceil(results.total / results.pageSize)}</span><button className="underline disabled:opacity-50" disabled={(results.page + 1) * results.pageSize >= results.total || loading} onClick={() => void search(searchedQuery, results.page + 1)}>다음</button></nav>}
    </>}
  </main>;
}
