"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Brain, Check, ClipboardPaste, Loader2 } from "lucide-react";
import {
  extractYouTubeVideoId,
  knowledgeCaptureAction,
  knowledgeJobCanOpenStudio,
  knowledgeJobIsOpen,
  knowledgeJobStatusLabel,
  knowledgeQueueOpenLabel,
  mergeKnowledgeJobMaps,
  notifyKnowledgeJobsChanged,
  type KnowledgeJobSummary,
} from "@/lib/knowledge-capture";

type CaptureState =
  | { kind: "ready" }
  | { kind: "submitting" }
  | { kind: "done"; created: boolean; job: KnowledgeJobSummary }
  | { kind: "error"; message: string; job?: KnowledgeJobSummary };

type VideoPreview = {
  videoId: string;
  sourceUrl: string;
  title: string;
  channelName: string | null;
  thumbnailUrl: string;
};

function extractSharedUrl(params: URLSearchParams): string {
  for (const key of ["url", "text", "title"] as const) {
    const value = params.get(key);
    if (!value) continue;
    const match = value.match(/https?:\/\/\S+/i);
    if (match) return match[0];
  }
  return "";
}

function captureDoneCta(job: KnowledgeJobSummary): { href: string; label: string } {
  const action = knowledgeCaptureAction(job);
  if (action.kind === "open") {
    return {
      href: action.href,
      label: knowledgeQueueOpenLabel(job.status) ?? action.label,
    };
  }
  return { href: "/knowledge", label: "지식함 보기" };
}

export default function CaptureDeepLinkClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrl = useMemo(
    () => extractSharedUrl(new URLSearchParams(searchParams?.toString())),
    [searchParams],
  );
  const [url, setUrl] = useState(initialUrl);
  const [state, setState] = useState<CaptureState>({ kind: "ready" });
  const [preview, setPreview] = useState<VideoPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  const validVideo = extractYouTubeVideoId(url);
  const matchingPreview = preview?.videoId === validVideo ? preview : null;
  const addChannelHref = validVideo ? `/add?url=${encodeURIComponent(url)}` : "/add";
  const activeJobId = state.kind === "done"
    && (state.job.status === "queued" || state.job.status === "processing")
    ? state.job.id
    : null;
  const activeVideoId = state.kind === "done" ? state.job.videoId : null;

  useEffect(() => {
    const element = bookmarkletRef.current;
    if (!element) return;
    element.setAttribute(
      "href",
      `javascript:location.href='${window.location.origin}/capture?url='+encodeURIComponent(location.href)`,
    );
  }, []);

  useEffect(() => {
    if (!validVideo) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({ url });
        const response = await fetch(`/api/knowledge/preview?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const value = response.ok ? await response.json() as Partial<VideoPreview> : null;
        if (
          value
          && value.videoId === validVideo
          && typeof value.sourceUrl === "string"
          && typeof value.title === "string"
          && typeof value.thumbnailUrl === "string"
        ) {
          setPreview({
            videoId: value.videoId,
            sourceUrl: value.sourceUrl,
            title: value.title,
            channelName: typeof value.channelName === "string" ? value.channelName : null,
            thumbnailUrl: value.thumbnailUrl,
          });
        } else {
          setPreview(null);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setPreview(null);
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, validVideo]);

  useEffect(() => {
    if (!activeJobId || !activeVideoId) return;
    let cancelled = false;
    let timer = 0;
    let delay = 5_000;

    const poll = async () => {
      if (document.visibilityState === "hidden") {
        delay = Math.min(delay * 2, 30_000);
        timer = window.setTimeout(poll, delay);
        return;
      }
      try {
        const params = new URLSearchParams({ videoIds: activeVideoId });
        const response = await fetch(`/api/knowledge/status?${params.toString()}`, { cache: "no-store" });
        const data = response.ok
          ? await response.json() as { jobs?: KnowledgeJobSummary[] }
          : null;
        if (cancelled) return;
        const nextJob = data?.jobs?.find((job) => job.id === activeJobId);
        if (nextJob) {
          setState((previous) => {
            if (previous.kind !== "done" || previous.job.id !== activeJobId) return previous;
            const merged = mergeKnowledgeJobMaps(
              { [previous.job.videoId]: previous.job },
              { [nextJob.videoId]: nextJob },
            )[previous.job.videoId];
            return { ...previous, job: merged };
          });
          if (nextJob.status !== "queued" && nextJob.status !== "processing") {
            if (!knowledgeJobIsOpen(nextJob.status)) notifyKnowledgeJobsChanged();
            return;
          }
          delay = 5_000;
        } else {
          delay = Math.min(delay * 2, 30_000);
        }
      } catch {
        delay = Math.min(delay * 2, 30_000);
      }
      timer = window.setTimeout(poll, delay);
    };

    timer = window.setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeJobId, activeVideoId]);

  const capture = async () => {
    if (!validVideo || state.kind === "submitting") return;
    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/knowledge/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          via: "share",
          ...(preview?.videoId === validVideo
            ? { title: preview.title, channelName: preview.channelName }
            : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { created?: boolean; job?: KnowledgeJobSummary; error?: string }
        | null;
      if (!response.ok) {
        if (data?.job) notifyKnowledgeJobsChanged();
        setState({
          kind: "error",
          message: data?.error ?? "지식함에 담지 못했어요.",
          job: data?.job,
        });
        return;
      }
      if (!data?.job) {
        setState({ kind: "error", message: "지식함 응답을 확인하지 못했어요." });
        return;
      }
      setState({ kind: "done", created: data.created !== false, job: data.job });
      notifyKnowledgeJobsChanged();
    } catch {
      setState({ kind: "error", message: "연결 오류입니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))] text-(--notion-fg) sm:justify-center sm:gap-5 sm:px-5 sm:py-10">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="이전 화면으로 돌아가기"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--border-subtle) bg-(--surface-raised) hover:bg-(--surface-subtle) focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">지식으로 담기</h1>
          <p className="mt-0.5 truncate text-sm text-(--text-secondary)">영상 링크를 확인하고 지식함에 담아요.</p>
        </div>
      </header>

      {state.kind === "done" ? (
        <section className="rounded-2xl border border-(--notion-border) bg-(--surface-raised) p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-2 font-semibold">
            <Check size={18} aria-hidden />
            {state.created ? "지식함에 담았어요." : "이미 지식함에 있어요."}
          </div>
          <p className="mt-2 text-sm font-medium text-(--notion-fg)">
            현재 상태: {knowledgeJobStatusLabel(state.job.status)}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-(--notion-fg)/65">
            {knowledgeJobCanOpenStudio(state.job.status)
              ? "작업실에서 초안을 확인하고 브레인에 승인할 수 있어요."
              : "집 컴퓨터가 초안을 만들면 지식함에서 작업실이 열려요."}
          </p>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <Link
              href={captureDoneCta(state.job).href}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-(--notion-fg) px-4 py-2 text-sm font-semibold text-(--notion-bg) hover:opacity-90"
            >
              {captureDoneCta(state.job).label}
            </Link>
            <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-(--text-secondary) hover:bg-(--notion-hover)">
              Focus Feed로 돌아가기
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-(--notion-border) bg-(--surface-raised) p-4 shadow-[var(--shadow-xs)] sm:p-5">
          <label htmlFor="knowledge-capture-url" className="mb-2 block text-sm font-semibold">
            YouTube 영상 링크
          </label>
          <textarea
            id="knowledge-capture-url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (state.kind === "error") setState({ kind: "ready" });
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            rows={3}
            className="w-full resize-none rounded-xl border border-(--notion-border) bg-(--notion-bg) px-3 py-3 text-base leading-relaxed focus:border-(--notion-fg)/30 focus:outline-none sm:text-sm"
          />
          <p className={`mt-2 text-xs ${validVideo ? "text-(--notion-fg)/55" : "text-amber-700 dark:text-amber-300"}`}>
            {validVideo ? "영상 URL을 확인했습니다. 아래 버튼을 눌러야 접수됩니다." : "YouTube 영상 URL을 붙여 넣어 주세요."}
          </p>

          {validVideo && (
            <div className="mt-4 overflow-hidden rounded-xl border border-(--notion-border) bg-(--notion-hover)/45">
              {previewLoading && !matchingPreview ? (
                <div className="flex min-h-24 items-center justify-center gap-2 px-4 text-sm text-(--notion-fg)/60" role="status">
                  <Loader2 size={16} className="animate-spin" aria-hidden /> 영상 정보 확인 중…
                </div>
              ) : matchingPreview ? (
                <div className="flex gap-3 p-3">
                  <Image
                    src={matchingPreview.thumbnailUrl}
                    alt=""
                    width={160}
                    height={90}
                    className="h-[72px] w-32 shrink-0 rounded-lg object-cover sm:h-[90px] sm:w-40"
                  />
                  <div className="min-w-0 self-center">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug">{matchingPreview.title}</p>
                    <p className="mt-1 truncate text-xs text-(--notion-fg)/55">
                      {matchingPreview.channelName ?? "채널 정보 확인 필요"}
                    </p>
                    <p className="mt-2 text-[11px] text-(--notion-fg)/50">기본값은 이 영상만 저장합니다.</p>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-3 text-xs text-(--notion-fg)/55">
                  영상 정보는 담을 때 다시 확인합니다. 이 영상만 지식함에 담습니다.
                </p>
              )}
            </div>
          )}

          {state.kind === "error" && (
            <div role="status" className="mt-3 text-sm text-red-600 dark:text-red-400">
              <p>{state.message}</p>
              {state.job && (
                <Link href="/knowledge" className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                  지식함에서 보기
                </Link>
              )}
            </div>
          )}

          <button
            type="button"
            data-testid="knowledge-capture-submit"
            onClick={() => void capture()}
            disabled={!validVideo || state.kind === "submitting"}
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-(--notion-fg) px-4 py-2 text-sm font-semibold text-(--notion-bg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {state.kind === "submitting" ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Brain size={17} aria-hidden />}
            {state.kind === "submitting" ? "담는 중…" : "지식으로 담기"}
          </button>
          <Link
            href={addChannelHref}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-(--text-secondary) hover:bg-(--surface-subtle) sm:w-auto"
          >
            이 채널도 피드에 추가
          </Link>
        </section>
      )}

      <section className="hidden rounded-2xl border border-(--notion-border) bg-(--surface-raised) p-5 text-sm leading-relaxed text-(--text-secondary) sm:block">
        <h2 className="m-0! text-base! font-semibold text-(--notion-fg)">데스크톱 빠른 캡처</h2>
        <p className="mt-2">아래 버튼을 북마크바에 끌어 놓고 YouTube 영상에서 누르세요.</p>
        <a
          ref={bookmarkletRef}
          href="#"
          draggable
          onClick={(event) => event.preventDefault()}
          className="mt-4 inline-flex cursor-grab items-center gap-2 rounded-lg border border-dashed border-(--notion-fg)/40 px-4 py-2 text-sm font-medium hover:bg-(--notion-hover)"
          title="이 버튼을 북마크바로 드래그하세요"
        >
          <ClipboardPaste size={16} aria-hidden /> FF 지식 담기
        </a>
      </section>
    </main>
  );
}
