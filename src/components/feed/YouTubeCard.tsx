"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, RotateCcw, MoreHorizontal, ExternalLink } from "lucide-react";
import { FeedItem as FeedItemType } from "@/types/feed";
import AddToRadioButton from "./AddToRadioButton";
import BookmarkButton from "./BookmarkButton";
import ContentStateControl from "./ContentStateControl";
import SummarizeButton from "./SummarizeButton";
import InsightButton from "./InsightButton";
import KnowledgeCaptureButton from "./KnowledgeCaptureButton";
import { DeepDiveButton } from "./VideoDigestDrawer";
import type { BookmarkEntry } from "./FeedClientContainer";
import type { ContentStateInfo } from "@/app/actions/content-state";
import { getWatchProgress } from "@/lib/watch-history";
import { useRadioQueueOptional } from "@/contexts/RadioQueueContext";
import { useIsHydrated } from "@/lib/use-is-hydrated";
import { HIT_AREA_44, ICON_ACTION_BTN } from "@/lib/ui";
import type { KnowledgeJobSummary } from "@/lib/knowledge-capture";

function formatTimeAgo(pubDate: string): string {
  const date = new Date(pubDate);
  if (!Number.isFinite(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  if (diff < min) return "방금 전";
  if (diff < hour) return `${Math.floor(diff / min)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < week) return `${Math.floor(diff / day)}일 전`;
  if (diff < month) return `${Math.floor(diff / week)}주 전`;
  return `${Math.floor(diff / month)}개월 전`;
}

interface Props {
  item: FeedItemType;
  bookmark?: BookmarkEntry | null;
  onBookmarkChange?: () => void;
  contentState?: ContentStateInfo;
  onContentStateChange?: () => void;
  knowledgeJob?: KnowledgeJobSummary | null;
  onKnowledgeJobChange?: (job: KnowledgeJobSummary) => void;
}

function formatSeconds(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function YouTubeCard({
  item,
  bookmark,
  onBookmarkChange,
  contentState,
  onContentStateChange,
  knowledgeJob,
  onKnowledgeJobChange,
}: Props) {
  const radio = useRadioQueueOptional();
  const [menuOpen, setMenuOpen] = useState(false);
  const isHydrated = useIsHydrated();
  // Date.now() 기반 timeAgo는 서버/클라이언트 시간이 달라 hydration 에러(#418)를 유발.
  // hydration 이후에만 계산하여 서버·클라이언트 초기 렌더를 일치시킴.
  const timeAgo = isHydrated ? formatTimeAgo(item.pubDate) : "";

  const storedProgress = isHydrated && item.id ? getWatchProgress(item.id) : null;
  const playback = radio?.playback;

  let baseDuration: number | null = null;
  if (playback && playback.videoId === item.id && playback.durationSeconds > 0) {
    baseDuration = playback.durationSeconds;
  } else if (storedProgress?.durationSeconds && storedProgress.durationSeconds > 0) {
    baseDuration = storedProgress.durationSeconds;
  } else if (typeof item.durationSeconds === "number" && item.durationSeconds > 0) {
    baseDuration = item.durationSeconds;
  }

  let progressSeconds: number | null = null;
  if (playback && playback.videoId === item.id && playback.positionSeconds > 0) {
    progressSeconds = playback.positionSeconds;
  } else if (storedProgress?.lastPositionSeconds && storedProgress.lastPositionSeconds > 0) {
    progressSeconds = storedProgress.lastPositionSeconds;
  }

  const completed =
    storedProgress?.completed === true ||
    (playback?.videoId === item.id && playback?.completed === true);

  const progressRatio = useMemo(() => {
    if (!progressSeconds || !baseDuration || baseDuration <= 0) return 0;
    return Math.min(1, Math.max(0, progressSeconds / baseDuration));
  }, [progressSeconds, baseDuration]);

  const resumeHref = useMemo(() => {
    const fallback = item.id
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`
      : null;
    const base = item.link || fallback;
    if (!base) return null;
    if (!progressSeconds || completed) return base;
    const sep = base.includes("?") ? "&" : "?";
    const t = Math.max(0, Math.floor(progressSeconds));
    return `${base}${sep}t=${t}s`;
  }, [item.id, item.link, progressSeconds, completed]);

  const durationLabel = useMemo(() => {
    if (!baseDuration || baseDuration <= 0) return null;
    return formatSeconds(baseDuration);
  }, [baseDuration]);

  const inAppWatchHref = useMemo(() => {
    const params = new URLSearchParams();
    const mode = item.isLive
      ? "live"
      : typeof item.durationSeconds === "number" && item.durationSeconds <= 60
        ? "shortform"
        : "longform";
    params.set("viewMode", mode);
    params.set("watch", item.id);
    if (item.sourceId) params.set("source", item.sourceId);
    return `/?${params.toString()}`;
  }, [item.durationSeconds, item.id, item.isLive, item.sourceId]);

  const formLabel = useMemo(() => {
    if (!baseDuration || baseDuration <= 0) return null;
    const total = baseDuration;
    const isShort = total <= 90; // 1분 30초 이하면 숏폼 느낌으로 표시
    return isShort ? "숏폼" : "롱폼";
  }, [baseDuration]);

  return (
    <article
      data-testid="youtube-card"
      data-video-id={item.id}
      className="group relative flex h-full min-w-0 flex-col bg-transparent"
    >
      <Link
        href={inAppWatchHref}
        prefetch
        className="flex flex-1 flex-col"
        aria-label={`${item.sourceName} - ${item.title} 앱에서 재생`}
      >
        <div
          data-testid="youtube-card-thumbnail"
          className="relative aspect-video w-full shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-(--surface-subtle)"
        >
          {item.thumbnail ? (
            <Image
              src={item.thumbnail}
              alt=""
              fill
              sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, (max-width: 1535px) 25vw, 20vw"
              className="object-cover transition-transform duration-[var(--motion-standard)] group-hover:scale-[1.02] motion-reduce:transition-none"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-(--notion-fg)/30">
              <span className="text-sm">No thumbnail</span>
            </div>
          )}

          {(completed || (progressRatio >= 0.05 && progressSeconds != null)) && (
            <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-[1px]">
              {completed ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  <span>시청 완료</span>
                </>
              ) : (
                <>
                  <RotateCcw className="h-3 w-3" />
                  <span>이어보기</span>
                </>
              )}
            </span>
          )}

          {durationLabel && (
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {durationLabel}
            </span>
          )}
        </div>
        <div className="flex flex-1 gap-3 pb-1 pt-3">
          <div className="shrink-0" data-testid="youtube-card-channel">
            {item.sourceAvatarUrl ? (
              <div className="relative h-9 w-9 overflow-hidden rounded-full bg-(--surface-subtle)">
                <Image src={item.sourceAvatarUrl} alt={item.sourceName} fill sizes="36px" className="object-cover" />
              </div>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-(--surface-subtle)">
                <span className="text-[13px] font-semibold text-(--text-primary)/80">{item.sourceName.charAt(0)}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="min-h-[2.55rem] sm:min-h-[2.7rem]">
              <h3
                data-testid="youtube-card-title"
                className="m-0! line-clamp-2 text-[15px]! font-semibold leading-[1.35] tracking-[-0.015em] text-(--text-primary) group-hover:text-(--text-primary)/90 sm:text-base!"
              >
                {item.title}
              </h3>
            </div>
            <p className="mt-1 truncate text-xs font-medium text-(--text-secondary) sm:text-[13px]">{item.sourceName}</p>
            <p
              data-testid="youtube-card-meta"
              className="mt-0.5 min-h-[1.125rem] text-xs leading-[1.125rem] text-(--text-secondary)"
              suppressHydrationWarning
            >
              {formLabel ? `${formLabel} · ${timeAgo}` : timeAgo}
            </p>
          </div>
        </div>
      </Link>
      {item.id && (
        <div
          data-testid="youtube-card-actions"
          className="flex shrink-0 flex-col gap-1 py-2"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SummarizeButton videoId={item.id} compact />
          <div className="flex items-center gap-0.5">
            <div data-testid="youtube-card-hover-actions" className="hidden items-center opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100 sm:flex">
              {onBookmarkChange && (
                <BookmarkButton
                  videoId={item.id}
                  videoTitle={item.title}
                  isBookmarked={!!bookmark}
                  bookmarkId={bookmark?.id ?? null}
                  onBookmarkChange={onBookmarkChange}
                  className={`h-9 w-9 ${HIT_AREA_44}`}
                />
              )}
              <AddToRadioButton videoId={item.id} title={item.title} iconOnly />
            </div>
            <div data-testid="youtube-card-mobile-radio" className="sm:hidden">
              <AddToRadioButton videoId={item.id} title={item.title} iconOnly />
            </div>
            <button
              type="button"
              data-testid="youtube-card-more-action"
              onClick={() => setMenuOpen((prev) => !prev)}
              className={`${ICON_ACTION_BTN} text-(--notion-fg)/60 hover:text-(--notion-fg)`}
              aria-label="더보기"
              aria-expanded={menuOpen}
              aria-controls={`card-more-${item.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          </div>
          <div data-testid="youtube-card-capture-action" className="min-w-0">
            <KnowledgeCaptureButton
              videoUrl={item.link}
              title={item.title}
              channelName={item.sourceName}
              compact
              job={knowledgeJob}
              onJobChange={onKnowledgeJobChange}
            />
          </div>
          {menuOpen && (
            <div id={`card-more-${item.id}`} className="w-full space-y-2.5 rounded-xl border border-(--notion-border) bg-(--notion-bg) px-2.5 py-2 text-xs text-(--notion-fg) shadow-sm">
              {resumeHref && (
                <a
                  href={resumeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-(--text-primary) hover:bg-(--surface-subtle)"
                >
                  <ExternalLink size={16} aria-hidden /> YouTube에서 열기
                </a>
              )}
              {onBookmarkChange && (
                <div className="flex items-center justify-between sm:hidden">
                  <span className="font-medium">북마크</span>
                  <BookmarkButton
                    videoId={item.id}
                    videoTitle={item.title}
                    isBookmarked={!!bookmark}
                    bookmarkId={bookmark?.id ?? null}
                    onBookmarkChange={onBookmarkChange}
                    className={`h-9 w-9 ${HIT_AREA_44}`}
                  />
                </div>
              )}
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--notion-fg)/55 sm:text-xs">
                  더 알아보기
                </p>
                <DeepDiveButton
                  videoId={item.id}
                  title={item.title}
                  channel={item.sourceName}
                  durationSeconds={item.durationSeconds ?? null}
                  compact
                />
              </div>
              {onContentStateChange && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--notion-fg)/55 sm:text-xs">
                    처리 상태
                  </p>
                  <ContentStateControl
                    contentId={item.id}
                    sourceId={item.sourceId}
                    sourceType="YouTube"
                    state={contentState?.state}
                    onChange={onContentStateChange}
                  />
                </div>
              )}
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--notion-fg)/55 sm:text-xs">
                  AI 도구
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <InsightButton videoId={item.id} completed={completed} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
