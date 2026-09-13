"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_STUDIO_REFERENCES, referenceDocumentUrl, referenceVersionLabel, type StudioReference } from "@/lib/knowledge-reference-context";
import { approvedKnowledgeRequestError, KnowledgeLoginRequiredError, knowledgeLoginUrl } from "@/lib/knowledge-recovery";

export default function KnowledgeReferencePicker({ jobId, selected, onChange, disabled }: {
  jobId: string;
  selected: StudioReference[];
  onChange: (sources: StudioReference[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudioReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">("keyword");
  const [unindexedCount, setUnindexedCount] = useState(0);
  const requestNumber = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => { requestController.current?.abort(); }, []);

  function invalidateSearch() {
    ++requestNumber.current;
    requestController.current?.abort();
    setLoading(false);
    setResults([]);
    setSearched(false);
    setHasMore(false);
    setUnindexedCount(0);
    setError(null);
    setLoginRequired(false);
  }

  async function search() {
    if (searchMode === "semantic" && !query.trim()) {
      setError("찾고 싶은 내용을 문장으로 입력해 주세요.");
      return;
    }
    const number = ++requestNumber.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    setLoginRequired(false);
    try {
      const response = await fetch(`/api/knowledge/approved?q=${encodeURIComponent(query.trim())}&search=${searchMode}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105_000)]) });
      const body = await response.json();
      if (!response.ok) throw approvedKnowledgeRequestError(response.status, body.error);
      if (number !== requestNumber.current) return;
      setResults(body.sources.filter((source: StudioReference) => source.id !== jobId));
      setHasMore(body.hasMore === true);
      setUnindexedCount(Number.isSafeInteger(body.unindexedCount) ? body.unindexedCount : 0);
      setSearched(true);
    } catch (cause) {
      if (number === requestNumber.current) {
        setResults([]);
        setError(cause instanceof Error ? cause.message : "승인 자료 조회에 실패했어요.");
        setLoginRequired(cause instanceof KnowledgeLoginRequiredError);
      }
    } finally {
      if (number === requestNumber.current) setLoading(false);
    }
  }

  return <div className="shrink-0 border-t border-(--border-subtle) px-3 py-2 text-sm">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !searched) void search(); }} className="min-h-11 text-(--text-secondary)">
      승인 자료 첨부{selected.length ? ` · ${selected.length}개` : ""}
    </button>
    {open && <div className="space-y-2">
      <p className="text-xs text-(--text-secondary)">최근 승인한 문서 100개에서 찾아 최대 3개를 첨부해요. 자연어 검색은 Brain에 색인된 최신 승인본을 관련도순으로 보여줘요.</p>
      <div role="group" aria-label="승인 자료 검색 방식" className="flex gap-2">
        {(["keyword", "semantic"] as const).map((mode) => <button key={mode} type="button" aria-pressed={searchMode === mode} onClick={() => { invalidateSearch(); setSearchMode(mode); }} className={`min-h-11 rounded border px-3 ${searchMode === mode ? "border-(--text-primary) text-(--text-primary)" : "border-(--border-subtle) text-(--text-secondary)"}`}>{mode === "keyword" ? "키워드" : "자연어"}</button>)}
      </div>
      <div className="flex gap-2">
        <input aria-label="승인 자료 검색어" value={query} maxLength={120} onChange={(event) => { invalidateSearch(); setQuery(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }} className="min-w-0 flex-1 rounded border border-(--border-subtle) bg-transparent px-2 py-2" placeholder={searchMode === "semantic" ? "예: 흩어진 요청에서 일정과 할 일을 정리하는 방법" : "예: 일정, 개인 맥락"} />
        <button type="button" onClick={() => void search()} disabled={loading} className="min-h-11 px-2">{loading ? "찾는 중" : "자료 검색"}</button>
      </div>
      {error && <p role="status">{error}</p>}
      {loginRequired && <a className="inline-block min-h-11 underline" href={knowledgeLoginUrl(jobId)} target="_blank" rel="noopener noreferrer">새 탭에서 로그인</a>}
      {hasMore && <p className="text-xs">더 오래된 문서는 이번 검색 범위에 포함되지 않았어요.</p>}
      {unindexedCount > 0 && <p className="text-xs">승인 문서 {unindexedCount}개는 최신 버전의 검색 색인이 아직 없어 제외됐어요.</p>}
      {searched && searchMode === "semantic" && !error && <p className="text-xs text-(--text-secondary)">관련도순 · 최대 20개 문서</p>}
      {selected.length > 0 && <div aria-label="첨부한 승인 자료">
        {selected.map((source) => <div key={source.id} className="flex items-center gap-2 text-xs">
          <a href={referenceDocumentUrl(source)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 underline">{source.title} · {referenceVersionLabel(source)}</a>
          <button type="button" disabled={disabled} aria-label={`${source.title} 첨부 해제`} onClick={() => onChange(selected.filter((item) => item.id !== source.id))} className="min-h-11 px-2">해제</button>
        </div>)}
      </div>}
      <div className="max-h-40 space-y-2 overflow-y-auto">
        {results.map((source) => {
          const checked = selected.some((item) => item.id === source.id);
          return <label key={source.id} className="flex gap-2 rounded border border-(--border-subtle) p-2">
            <input type="checkbox" checked={checked} disabled={disabled || (!checked && selected.length >= MAX_STUDIO_REFERENCES)} onChange={() => onChange(checked ? selected.filter((item) => item.id !== source.id) : [...selected, source])} />
            <span><span className="block">{source.title} · {referenceVersionLabel(source)}</span><span className="text-xs text-(--text-secondary)">{source.excerpt}</span></span>
          </label>;
        })}
        {searched && !loading && !error && !results.length && <p className="text-xs">함께 읽을 다른 승인 자료가 없어요. 검색어를 바꿔보세요.</p>}
      </div>
      <p className="text-xs text-(--text-secondary)">자료를 바꾸면 이전 대화는 화면에 남고, 다음 질문부터 새 맥락으로 답해요.</p>
    </div>}
  </div>;
}
