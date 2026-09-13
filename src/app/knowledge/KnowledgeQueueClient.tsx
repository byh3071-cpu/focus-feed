"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  knowledgeJobActionMessage,
  knowledgeJobStatusLabel,
  knowledgeQueueOpenLabel,
  type KnowledgeJobStatus,
  type KnowledgeJobSummary,
} from "@/lib/knowledge-capture";
import KnowledgeStudio from "./KnowledgeStudio";
import { loadDeferredJobIds, storeDeferredJobIds } from "@/lib/knowledge-studio";

type QueueSection = "needs_action" | "active" | "completed";

const SECTION_META: Record<QueueSection, { label: string; description: string }> = {
  needs_action: { label: "확인 필요", description: "검토 필요와 조치 필요를 모은 목록" },
  active: { label: "처리 중", description: "담겼거나 초안을 만드는 중" },
  completed: { label: "완료", description: "브레인에 적재된 항목" },
};

function sectionForStatus(status: KnowledgeJobStatus): QueueSection {
  if (status === "review_required" || status === "action_required" || status === "failed") return "needs_action";
  if (status === "completed" || status === "cancelled") return "completed";
  return "active";
}

function needsActionRank(status: KnowledgeJobStatus): number {
  if (status === "review_required" || status === "approving") return 0;
  if (status === "action_required") return 1;
  return 2;
}

function StatusIcon({ status }: { status: KnowledgeJobStatus }) {
  const section = sectionForStatus(status);
  if (section === "needs_action") return <AlertCircle size={14} aria-hidden="true" />;
  if (section === "completed") return <CheckCircle2 size={14} aria-hidden="true" />;
  return <Clock3 size={14} aria-hidden="true" />;
}

export default function KnowledgeQueueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job")?.trim() || null;
  const [jobs, setJobs] = useState<KnowledgeJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [activeSection, setActiveSection] = useState<QueueSection>("needs_action");
  const [deferredIds, setDeferredIds] = useState<string[]>([]);
  const initialSectionSelected = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const jobsResponse = await fetch("/api/knowledge/jobs", { cache: "no-store" });
      const jobsData = await jobsResponse.json().catch(() => null) as {
        jobs?: KnowledgeJobSummary[];
        error?: string;
      } | null;
      if (jobsResponse.status === 401) {
        setAuthRequired(true);
        setJobs([]);
        return;
      }
      if (!jobsResponse.ok) throw new Error(jobsData?.error ?? "지식함을 불러오지 못했어요.");
      setJobs(jobsData?.jobs ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "지식함을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (jobId) return;
    void load();
    setDeferredIds(loadDeferredJobIds());
  }, [jobId, load]);

  const groupedJobs = useMemo(() => ({
    needs_action: jobs
      .filter((job) => sectionForStatus(job.status) === "needs_action")
      .filter((job) => !(job.status === "review_required" && deferredIds.includes(job.id)))
      .slice()
      .sort((a, b) => {
        const rank = needsActionRank(a.status) - needsActionRank(b.status);
        if (rank !== 0) return rank;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }),
    active: jobs.filter((job) => sectionForStatus(job.status) === "active"),
    completed: jobs.filter((job) => sectionForStatus(job.status) === "completed"),
  }), [deferredIds, jobs]);

  useEffect(() => {
    if (loading || initialSectionSelected.current) return;
    initialSectionSelected.current = true;
    if (jobs.length === 0 || groupedJobs[activeSection].length > 0) return;
    const nextSection = (["needs_action", "active", "completed"] as QueueSection[])
      .find((section) => groupedJobs[section].length > 0);
    if (nextSection) setActiveSection(nextSection);
  }, [activeSection, groupedJobs, jobs.length, loading]);

  const goBack = useCallback(() => {
    router.push("/");
  }, [router]);

  const openStudio = useCallback((id: string) => {
    router.push(`/knowledge?job=${encodeURIComponent(id)}`);
  }, [router]);

  const visibleJobs = groupedJobs[activeSection];
  const reviewReadyCount = groupedJobs.needs_action.filter((job) => job.reviewAvailable).length;
  const hiddenDeferredCount = jobs.filter((job) => job.status === "review_required" && deferredIds.includes(job.id)).length;

  if (jobId) return <KnowledgeStudio key={jobId} jobId={jobId} />;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:py-8">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="이전 화면으로 돌아가기"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-subtle) bg-(--surface-raised) hover:bg-(--surface-subtle) focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold sm:text-2xl">지식함</h1>
          <p className="mt-0.5 truncate text-sm text-(--text-secondary)">담은 영상의 처리와 작업실 입구</p>
          <Link href="/knowledge/usage" className="mt-1 inline-block text-sm underline">활용 메모 찾기</Link>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="지식함 새로고침"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-(--border-subtle) bg-(--surface-raised) px-3 text-sm font-semibold hover:bg-(--surface-subtle) disabled:opacity-60"
        >
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} aria-hidden="true" />
          <span className="hidden sm:inline">새로고침</span>
        </button>
      </header>

      {!authRequired && !error && !loading && jobs.length > 0 && (
        <nav aria-label="지식함 상태" className="mt-5 grid grid-cols-3 gap-1 rounded-2xl bg-(--surface-subtle) p-1">
          {(Object.keys(SECTION_META) as QueueSection[]).map((section) => {
            const selected = activeSection === section;
            return (
              <button
                key={section}
                type="button"
                aria-pressed={selected}
                aria-label={`${SECTION_META[section].label} ${groupedJobs[section].length}개`}
                onClick={() => setActiveSection(section)}
                className={`min-h-11 rounded-xl px-2 text-sm font-semibold transition-colors ${selected
                  ? "bg-(--surface-raised) text-(--text-primary) shadow-[var(--shadow-xs)]"
                  : "text-(--text-secondary) hover:text-(--text-primary)"}`}
              >
                {SECTION_META[section].label}
                <span className="ml-1 tabular-nums" aria-hidden="true">
                  {groupedJobs[section].length}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      <section className="mt-4">
        {authRequired ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-(--border-subtle) bg-(--surface-raised) px-5 text-center">
            <Brain size={28} aria-hidden="true" />
            <div>
              <p className="font-semibold">로그인하면 지식함을 볼 수 있어요.</p>
              <p className="mt-1 text-sm text-(--text-secondary)">담은 영상과 작업실은 본인에게만 표시됩니다.</p>
            </div>
            <Link href="/login?next=/knowledge" className="inline-flex min-h-11 items-center rounded-xl border border-(--border-subtle) px-4 text-sm font-semibold hover:bg-(--surface-subtle)">
              로그인하기
            </Link>
          </div>
        ) : error ? (
          <div role="status" className="flex min-h-40 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 px-5 text-center text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 rounded-2xl border border-(--border-subtle) bg-(--surface-raised) text-sm text-(--text-secondary)">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />불러오는 중
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-(--border-subtle) bg-(--surface-raised) px-5 text-center">
            <Brain size={28} aria-hidden="true" />
            <div>
              <p className="font-semibold">아직 담은 영상이 없어요.</p>
              <p className="mt-1 text-sm text-(--text-secondary)">유용한 영상을 발견하면 한 번에 담아두세요.</p>
            </div>
            <Link href="/capture" className="inline-flex min-h-11 items-center rounded-xl bg-(--notion-fg) px-4 text-sm font-semibold text-(--notion-bg) hover:opacity-90">
              영상 담기
            </Link>
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-(--border-subtle) px-5 text-center">
            <CheckCircle2 size={24} aria-hidden="true" />
            <p className="mt-2 font-semibold">{SECTION_META[activeSection].label} 항목이 없어요.</p>
            <p className="mt-1 text-sm text-(--text-secondary)">{SECTION_META[activeSection].description}</p>
            {activeSection === "needs_action" && hiddenDeferredCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  storeDeferredJobIds([]);
                  setDeferredIds([]);
                }}
                className="mt-4 min-h-11 rounded-[var(--radius-md)] border border-(--border-subtle) px-3 text-xs font-semibold hover:bg-(--surface-subtle)"
              >
                보류한 검토 {hiddenDeferredCount}개 다시 보기
              </button>
            )}
          </div>
        ) : (
          <>
            {activeSection === "needs_action" && (
              <div className="mb-3 space-y-2 text-sm leading-6 text-(--text-secondary)">
                <p>
                  {reviewReadyCount > 0
                    ? `검토 필요는 작업실에서 고칩니다. 지금 ${reviewReadyCount}개.`
                    : "지금은 검토 필요 항목이 없어요. 아래는 다음 행동이 필요한 항목입니다."}
                </p>
                {hiddenDeferredCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      storeDeferredJobIds([]);
                      setDeferredIds([]);
                    }}
                    className="min-h-11 rounded-[var(--radius-md)] border border-(--border-subtle) px-3 text-xs font-semibold hover:bg-(--surface-subtle)"
                  >
                    보류한 검토 {hiddenDeferredCount}개 다시 보기
                  </button>
                )}
              </div>
            )}
          <ul className="space-y-3">
            {visibleJobs.map((job) => {
              const actionMessage = knowledgeJobActionMessage(job);
              const sourceUrl = job.sourceUrl ?? `https://www.youtube.com/watch?v=${job.videoId}`;
              const section = sectionForStatus(job.status);

              return (
                <li key={job.id} className="overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-raised) shadow-[var(--shadow-xs)]">
                  <article className="px-4 py-4 sm:px-5">
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${section === "needs_action"
                        ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                        : section === "completed"
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                          : "bg-(--playback-accent-muted) text-(--playback-accent)"}`}
                      >
                        <StatusIcon status={job.status} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-(--text-secondary)">{knowledgeJobStatusLabel(job.status)}</span>
                          <span className="text-xs text-(--text-secondary)" aria-hidden="true">·</span>
                          <time className="text-xs text-(--text-secondary)" dateTime={job.createdAt}>
                            {new Date(job.createdAt).toLocaleDateString("ko-KR")}
                          </time>
                        </div>
                        <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block text-base font-semibold leading-6 hover:underline">
                          {job.title ?? `YouTube ${job.videoId}`}
                        </a>
                        {job.channelName && <p className="mt-1 truncate text-sm text-(--text-secondary)">{job.channelName}</p>}
                        {actionMessage && (
                          <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm leading-6 text-amber-800 dark:text-amber-200">{actionMessage}</p>
                        )}
                        {job.status === "completed" && (
                          <p className="mt-3 text-sm text-(--text-secondary)">브레인에 적재됨</p>
                        )}
                        {(job.status === "queued" || job.status === "processing") && (
                          <p className="mt-3 text-sm text-(--text-secondary)">초안이 준비되면 작업실이 열려요.</p>
                        )}
                      </div>
                    </div>

                    {knowledgeQueueOpenLabel(job.status) && (
                      <button
                        type="button"
                        onClick={() => openStudio(job.id)}
                        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-(--border-subtle) px-4 text-sm font-semibold hover:bg-(--surface-subtle) focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto"
                      >
                        {knowledgeQueueOpenLabel(job.status)}
                      </button>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>
    </main>
  );
}
