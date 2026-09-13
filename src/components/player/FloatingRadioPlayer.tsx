"use client";

/** 하단 고정 라디오 플레이어. YouTube IFrame API, 플레이리스트 서랍·AI 요약 뷰·미니 영상 토글 */
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRadioQueueOptional } from "@/contexts/RadioQueueContext";
import { qaLog } from "@/lib/qa-log";
import { AlertCircle, ListMusic, Loader2, Radio, Sparkles, X } from "lucide-react";
import { summarizeVideoAction } from "@/app/actions/summarize";
import { RadioFooterControls } from "./RadioFooterControls";
import { RadioPlaylistDrawer } from "./RadioPlaylistDrawer";
import { RadioLyricsView } from "./RadioLyricsView";
import { getWatchProgress, saveWatchProgress } from "@/lib/watch-history";
import { useBodyScrollLock } from "@/lib/body-scroll-lock";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  oauthAuthorizeUrlReturnsToOrigin,
  oauthCallbackUrl,
  rememberOAuthNext,
} from "@/lib/oauth-redirect";
import { ModalTransition } from "@/components/ui/ModalTransition";

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace YT {
  class Player {
    constructor(elementId: string, options: {
      height?: string;
      width?: string;
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: { target: Player }) => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    });
    loadVideoById(videoId: string): void;
    playVideo(): void;
    pauseVideo(): void;
    getPlayerState(): number;
    getCurrentTime(): number;
    getDuration(): number;
  }
  enum PlayerState {
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}

const PLAYER_DIV_ID = "yt-radio-player-host";
const PLAYER_WRAPPER_ID = "yt-radio-player-wrapper";

type RadioOptional = ReturnType<typeof useRadioQueueOptional>;
type RadioRefValue = NonNullable<RadioOptional>;

interface ExpandedSummaryBodyProps {
  summary?: string;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  onLogin: () => void;
}

function ExpandedSummaryBody({
  summary,
  loading,
  error,
  onGenerate,
  onLogin,
}: ExpandedSummaryBodyProps) {
  if (summary) {
    return (
      <p className="whitespace-pre-wrap rounded-2xl bg-(--surface-subtle) px-5 py-4 text-base leading-7 text-(--text-primary)">
        {summary}
      </p>
    );
  }

  if (loading) {
    return (
      <div
        data-testid="expanded-ai-summary-loading"
        role="status"
        aria-live="polite"
        className="rounded-2xl bg-(--surface-subtle) px-5 py-5"
      >
        <div className="flex items-center gap-3 text-sm font-semibold text-(--text-primary)">
          <Loader2 size={18} className="animate-spin text-(--ai-accent)" aria-hidden />
          AI가 영상의 핵심 내용을 정리하고 있어요.
        </div>
        <div className="mt-5 space-y-3" aria-hidden>
          <span className="block h-3 w-full animate-pulse rounded-full bg-(--border-subtle)" />
          <span className="block h-3 w-[88%] animate-pulse rounded-full bg-(--border-subtle)" />
          <span className="block h-3 w-[72%] animate-pulse rounded-full bg-(--border-subtle)" />
        </div>
        <p className="mt-5 text-xs leading-5 text-(--text-secondary)">
          영상 길이에 따라 시간이 조금 걸릴 수 있습니다. 재생은 계속할 수 있어요.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="expanded-ai-summary-error" role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-5">
        <div className="flex items-start gap-3 text-red-700 dark:text-red-300">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm font-medium leading-6">{error}</p>
        </div>
        {error.includes("로그인") ? (
          <button
            data-testid="expanded-ai-summary-login"
            type="button"
            onClick={onLogin}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--ai-accent) px-4 text-sm font-bold text-white transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ai-accent)/40 focus-visible:ring-offset-2 dark:text-violet-950"
          >
            Google로 로그인
          </button>
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-red-500/25 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/35 dark:text-red-300"
          >
            다시 시도
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-(--surface-subtle) px-5 py-5">
      <p className="text-base font-semibold">아직 생성된 요약이 없어요.</p>
      <p className="mt-2 text-sm leading-6 text-(--text-secondary)">
        재생 화면을 벗어나지 않고 현재 영상의 핵심 내용을 바로 정리할 수 있습니다.
      </p>
      <button
        data-testid="expanded-ai-summary-generate"
        type="button"
        onClick={onGenerate}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--ai-accent) px-4 text-sm font-bold text-white shadow-sm transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ai-accent)/40 focus-visible:ring-offset-2 dark:text-violet-950"
      >
        <Sparkles size={16} aria-hidden />
        AI 요약 생성
      </button>
      <p className="mt-3 text-xs leading-5 text-(--text-secondary)">
        생성이 끝나면 이 패널에 자동으로 표시됩니다.
      </p>
    </div>
  );
}

export default function FloatingRadioPlayer() {
  const radio = useRadioQueueOptional();
  const radioRef = useRef<RadioRefValue | null>(null);
  radioRef.current = radio ?? null;

  const playerRef = useRef<YT.Player | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [fullPlayerOpen, setFullPlayerOpen] = useState(false);
  const [expandedSummaryOpen, setExpandedSummaryOpen] = useState(false);
  const expandedSummaryOpenRef = useRef(false);
  expandedSummaryOpenRef.current = expandedSummaryOpen;
  const [wideSummaryLayout, setWideSummaryLayout] = useState(false);
  const [expandedSummaryLoading, setExpandedSummaryLoading] = useState(false);
  const [expandedSummaryError, setExpandedSummaryError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [resumeSeconds, setResumeSeconds] = useState<number | null>(null);
  const [expandedChromeVisible, setExpandedChromeVisible] = useState(true);
  const fullPlayerRef = useRef<HTMLDivElement>(null);
  const fullPlayerCloseRef = useRef<HTMLButtonElement>(null);
  const fullPlayerRestoreFocusRef = useRef<HTMLElement | null>(null);
  const expandedMediaRef = useRef<HTMLElement>(null);
  /** 시크 직후 rAF가 이전 재생 위치로 덮어쓰지 않도록 목표 % 유지 */
  const seekTargetRef = useRef<number | null>(null);
  const seekTargetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedSummaryRequestRef = useRef<string | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setWideSummaryLayout(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    return () => {
      if (seekTargetTimeoutRef.current) {
        clearTimeout(seekTargetTimeoutRef.current);
        seekTargetTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.YT?.Player) {
      queueMicrotask(() => setApiReady(true));
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(tag, firstScript);
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { prevReady?.(); } catch { /* 이전 콜백 오류 무시 */ }
      setApiReady(true);
    };
    return () => {
      window.onYouTubeIframeAPIReady = prevReady;
    };
  }, []);

  useEffect(() => {
    if (!apiReady || !radio?.currentItem || !window.YT) return;
    const videoId = radio.currentItem.videoId;
    const isPlaying = radio.isPlaying;
    if (!playerRef.current) {
      playerRef.current = new window.YT.Player(PLAYER_DIV_ID, {
        height: "1",
        width: "1",
        videoId,
        playerVars: {
          autoplay: isPlaying ? 1 : 0,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady(ev: { target: YT.Player }) {
            setPlayerReady(true);
            if (radioRef.current?.isPlaying) ev.target.playVideo();
          },
          onStateChange(ev: { data: number }) {
            if (window.YT && ev.data === window.YT.PlayerState.ENDED) {
              radioRef.current?.next();
            }
          },
        },
      });
    } else if (playerReady) {
      if (typeof playerRef.current.loadVideoById === "function") {
        playerRef.current.loadVideoById(videoId);
        if (isPlaying && typeof playerRef.current.playVideo === "function") {
          playerRef.current.playVideo();
        }
      }
    }
    // radio.isPlaying은 의존성에서 제외한다. 재생/일시정지 토글마다 이 이펙트가 재실행되면
    // else 분기의 loadVideoById가 매번 호출돼 영상이 처음부터 다시 로드된다(시청 위치 유실).
    // 재생/일시정지는 아래 별도 이펙트가 전담하고, 여기서는 videoId 변경 시에만 로드한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- player 인스턴스 재생성 비용 때문에 videoId·ready만 동기화
  }, [apiReady, radio?.currentItem?.videoId, playerReady]);

  useEffect(() => {
    if (!playerRef.current || !radioRef.current || !playerReady) return;
    const r = radioRef.current;
    if (r.isPlaying && typeof playerRef.current.playVideo === "function") {
      playerRef.current.playVideo();
    } else if (!r.isPlaying && typeof playerRef.current.pauseVideo === "function") {
      playerRef.current.pauseVideo();
    }
  }, [radio?.isPlaying, playerReady]);

  useEffect(() => {
    const r = radioRef.current;
    if (r && r.queue.length === 0) {
      playerRef.current = null;
      setPlayerReady(false);
      setProgress(0);
      setResumeSeconds(null);
    }
  }, [radio?.queue.length]);

  // 재생 중인 영상이 바뀌면 진행 바를 즉시 0으로 리셋 (이전 영상 진행도가 남아 점점 사라지는 현상 방지)
  useEffect(() => {
    if (!radio?.currentItem) return;
    setProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- videoId 변경만 진행 바 초기화 트리거로 사용
  }, [radio?.currentItem?.videoId]);

  useEffect(() => {
    setExpandedSummaryLoading(false);
    setExpandedSummaryError(null);
    expandedSummaryRequestRef.current = null;

    const current = radioRef.current?.currentItem;
    if (!current || current.summary || typeof window === "undefined") return;
    const cached = localStorage.getItem(`summary_${current.videoId}`);
    if (cached) radioRef.current?.updateItemSummary(current.videoId, cached);
  }, [radio?.currentItem?.videoId]);

  // 현재 큐 아이템 기준으로 저장된 마지막 시청 위치 불러오기 (완료한 영상은 제외)
  useEffect(() => {
    if (!radio?.currentItem) {
      setResumeSeconds(null);
      return;
    }
    const stored = getWatchProgress(radio.currentItem.videoId);
    if (!stored || stored.completed || !Number.isFinite(stored.lastPositionSeconds) || stored.lastPositionSeconds <= 0) {
      setResumeSeconds(null);
      return;
    }
    setResumeSeconds(stored.lastPositionSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- videoId만 추적해 재실행, currentItem 객체 참조는 제외
  }, [radio?.currentItem?.videoId]);

  // 진행 바 상태 업데이트 (재생 중일 때만 활성화해 불필요한 rAF 최소화)
  useEffect(() => {
    if (!playerRef.current || !playerReady || !radio?.currentItem || !radio.isPlaying) return;
    let frameId: number | null = null;
    let lastSavedAt = 0;
    let lastBroadcastAt = 0;
    /** seekTarget 유지 프레임 수; 너무 오래 유지되면 강제 해제해 바가 멈추는 버그 방지 */
    let seekHoldFrames = 0;
    const SEEK_HOLD_MAX_FRAMES = 90; // ~1.5초

    /** 탭 포커스 복귀 시 재생바를 즉시 플레이어 시간과 동기화 (백그라운드에서 rAF가 멈춰 지연되는 현상 방지) */
    const syncProgressFromPlayer = () => {
      try {
        const p = playerRef.current as { getCurrentTime?: () => number; getDuration?: () => number } | null;
        if (!p?.getCurrentTime || !p?.getDuration) return;
        const current = p.getCurrentTime();
        const duration = p.getDuration();
        if (duration > 0 && Number.isFinite(current)) {
          const percent = Math.max(0, Math.min(100, (current / duration) * 100));
          seekTargetRef.current = null;
          setProgress(percent);
        }
      } catch {
        // ignore
      }
    };

    const onVisibilityChange = () => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      syncProgressFromPlayer();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    const update = () => {
      try {
        const r = radioRef.current;
        const item = r?.currentItem;
        if (!item) return;
        let current = 0;
        let duration = 0;
        try {
          current = typeof playerRef.current?.getCurrentTime === "function" ? playerRef.current.getCurrentTime() : 0;
          duration = typeof playerRef.current?.getDuration === "function" ? playerRef.current.getDuration() : 0;
        } catch {
          seekTargetRef.current = null;
          frameId = requestAnimationFrame(update);
          return;
        }
        if (duration > 0 && Number.isFinite(current)) {
          const ratio = Math.max(0, Math.min(1, current / duration));
          const percent = ratio * 100;
          const target = seekTargetRef.current;
          if (target != null) {
            seekHoldFrames += 1;
            if (percent >= target - 1 || seekHoldFrames >= SEEK_HOLD_MAX_FRAMES) {
              seekTargetRef.current = null;
              seekHoldFrames = 0;
            } else {
              setProgress(target);
              frameId = requestAnimationFrame(update);
              return;
            }
          } else {
            seekHoldFrames = 0;
          }
          setProgress(percent);

          const now = Date.now();
          if (now - lastSavedAt > 5000) {
            saveWatchProgress(item.videoId, current, duration);
            lastSavedAt = now;
          }
          if (now - lastBroadcastAt > 1000 && typeof r?.updatePlayback === "function") {
            r.updatePlayback({
              videoId: item.videoId,
              positionSeconds: current,
              durationSeconds: duration,
              completed: ratio >= 0.9,
            });
            lastBroadcastAt = now;
          }
        }
      } catch {
        seekTargetRef.current = null;
      }
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [playerReady, radio?.currentItem?.videoId, radio?.currentItem, radio?.isPlaying]);

  // 미니/전체 영상: YT가 1x1로 만든 iframe을 모드에 맞게 리사이즈
  const MINI_VIDEO_W = 320;
  const videoVisible = videoExpanded || fullPlayerOpen;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const run = () => {
      const wrapper = document.getElementById(PLAYER_WRAPPER_ID);
      const iframe = wrapper?.querySelector?.("iframe") as HTMLIFrameElement | null;
      if (!iframe) return;
      if (fullPlayerOpen) {
        iframe.removeAttribute("width");
        iframe.removeAttribute("height");
        iframe.style.width = "100%";
        iframe.style.height = "100%";
      } else if (videoExpanded) {
        iframe.removeAttribute("width");
        iframe.removeAttribute("height");
        iframe.style.width = "100%";
        iframe.style.height = "100%";
      } else {
        iframe.setAttribute("width", "1");
        iframe.setAttribute("height", "1");
        iframe.style.width = "1px";
        iframe.style.height = "1px";
      }
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(run));
    const t = window.setTimeout(run, 150);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [videoExpanded, fullPlayerOpen]);

  useBodyScrollLock(fullPlayerOpen);

  const closeFullPlayer = useCallback(() => {
    setExpandedChromeVisible(true);
    setExpandedSummaryOpen(false);
    setFullPlayerOpen(false);
    qaLog.radio.fullPlayerClose();
  }, []);

  const hasExpandedChromeKeyboardFocus = useCallback(() => {
    const media = expandedMediaRef.current;
    const active = document.activeElement;
    return Boolean(
      media &&
      active instanceof HTMLElement &&
      media.contains(active) &&
      active.matches(":focus-visible"),
    );
  }, []);

  useEffect(() => {
    if (!fullPlayerOpen) return;
    const syncChromeWithPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const media = expandedMediaRef.current;
      if (!media) return;
      const rect = media.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (inside) {
        setExpandedChromeVisible(true);
      } else if (!hasExpandedChromeKeyboardFocus()) {
        setExpandedChromeVisible(false);
      }
    };
    document.addEventListener("pointermove", syncChromeWithPointer, true);
    return () => document.removeEventListener("pointermove", syncChromeWithPointer, true);
  }, [fullPlayerOpen, hasExpandedChromeKeyboardFocus]);

  useEffect(() => {
    if (!fullPlayerOpen) return;
    fullPlayerRestoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => fullPlayerCloseRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (expandedSummaryOpenRef.current) {
          setExpandedSummaryOpen(false);
          return;
        }
        closeFullPlayer();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = fullPlayerRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, iframe, [href], [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      const previous = fullPlayerRestoreFocusRef.current;
      requestAnimationFrame(() => {
        if (previous?.isConnected && previous !== document.body) {
          previous.focus();
          return;
        }
        document.querySelector<HTMLButtonElement>('button[aria-label="플레이어 더보기"]')?.focus();
      });
    };
  }, [closeFullPlayer, fullPlayerOpen]);

  const togglePlay = useCallback(() => {
    radioRef.current?.togglePlay();
  }, []);

  /** 초 단위 직접 시킹 (딥다이브 드로어 등 외부 타임스탬프 클릭용) */
  const seekToSeconds = useCallback((seconds: number) => {
    const p = playerRef.current as { getDuration?: () => number; seekTo?: (sec: number, allow: boolean) => void } | null;
    if (!p || typeof p.seekTo !== "function") return;
    try {
      p.seekTo(Math.max(0, seconds), true);
      const duration = typeof p.getDuration === "function" ? p.getDuration() : 0;
      if (duration > 0) {
        const percent = Math.max(0, Math.min(100, (seconds / duration) * 100));
        seekTargetRef.current = percent;
        setProgress(percent);
        if (seekTargetTimeoutRef.current) clearTimeout(seekTargetTimeoutRef.current);
        seekTargetTimeoutRef.current = setTimeout(() => {
          seekTargetRef.current = null;
          seekTargetTimeoutRef.current = null;
        }, 1500);
      }
    } catch {
      // ignore
    }
  }, []);

  /** 외부 시킹 요청 수신: 해당 영상이 아직 로드 전이면 보류했다가 준비되면 적용 */
  const pendingSeekRef = useRef<{ videoId: string; seconds: number } | null>(null);
  useEffect(() => {
    const onSeekRequest = (e: Event) => {
      const detail = (e as CustomEvent<{ videoId?: string; seconds?: number }>).detail;
      if (!detail?.videoId || typeof detail.seconds !== "number") return;
      if (radioRef.current?.currentItem?.videoId === detail.videoId && playerReady) {
        seekToSeconds(detail.seconds);
      } else {
        pendingSeekRef.current = { videoId: detail.videoId, seconds: detail.seconds };
      }
    };
    window.addEventListener("focus-feed:radio-seek", onSeekRequest);
    return () => window.removeEventListener("focus-feed:radio-seek", onSeekRequest);
  }, [playerReady, seekToSeconds]);

  useEffect(() => {
    const pending = pendingSeekRef.current;
    if (!pending || !playerReady) return;
    if (radio?.currentItem?.videoId !== pending.videoId) return;

    // loadVideoById 직후에는 새 영상이 아직 로드 전이라 시킹이 무시되고, getDuration()도
    // 0/이전 영상 길이를 돌려준다. 고정 지연 대신 getDuration()>0(= 새 영상 메타데이터 로드 완료)이
    // 될 때까지 폴링한 뒤 적용해, 시킹 유실과 잘못된 진행률 계산을 막는다.
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const MAX_ATTEMPTS = 25; // ~5초 (200ms 간격)

    const tryApply = () => {
      if (cancelled) return;
      // 폴링 중 영상이 또 바뀌면 이 보류는 폐기
      if (radioRef.current?.currentItem?.videoId !== pending.videoId) {
        pendingSeekRef.current = null;
        return;
      }
      const p = playerRef.current as { getDuration?: () => number } | null;
      const duration = p && typeof p.getDuration === "function" ? p.getDuration() : 0;
      if (duration > 0) {
        seekToSeconds(pending.seconds);
        pendingSeekRef.current = null;
        return;
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        // 끝내 준비되지 않으면 잘못된 duration으로 적용하지 않고 보류를 폐기
        pendingSeekRef.current = null;
        return;
      }
      timer = setTimeout(tryApply, 200);
    };

    timer = setTimeout(tryApply, 100);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [playerReady, radio?.currentItem?.videoId, seekToSeconds]);

  const handleSeek = useCallback((percent: number) => {
    const p = playerRef.current as { getDuration?: () => number; seekTo?: (sec: number, allow: boolean) => void } | null;
    if (!p || typeof p.getDuration !== "function" || typeof p.seekTo !== "function") return;
    const duration = p.getDuration();
    if (!(duration > 0)) return;
    if (seekTargetTimeoutRef.current) {
      clearTimeout(seekTargetTimeoutRef.current);
      seekTargetTimeoutRef.current = null;
    }
    const sec = Math.max(0, Math.min(duration, (percent / 100) * duration));
    seekTargetRef.current = percent;
    setProgress(percent);
    p.seekTo(sec, true);
    seekTargetTimeoutRef.current = setTimeout(() => {
      seekTargetRef.current = null;
      seekTargetTimeoutRef.current = null;
    }, 1500);
  }, []);

  const generateExpandedSummary = useCallback(async () => {
    const current = radioRef.current?.currentItem;
    if (!current || expandedSummaryRequestRef.current === current.videoId) return;

    const requestVideoId = current.videoId;
    expandedSummaryRequestRef.current = requestVideoId;
    setExpandedSummaryLoading(true);
    setExpandedSummaryError(null);
    qaLog.radio.summaryFetchStart(requestVideoId);

    try {
      const result = await summarizeVideoAction(requestVideoId);
      if (result.summary) {
        radioRef.current?.updateItemSummary(requestVideoId, result.summary);
        localStorage.setItem(`summary_${requestVideoId}`, result.summary);
        window.dispatchEvent(new Event("focus-feed:usage-updated"));
        qaLog.radio.summaryFetchSuccess(requestVideoId);
      } else {
        const message = result.error ?? "요약을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        if (radioRef.current?.currentItem?.videoId === requestVideoId) {
          setExpandedSummaryError(message);
        }
        qaLog.radio.summaryFetchError(requestVideoId, message);
      }
    } catch {
      const message = "요약 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
      if (radioRef.current?.currentItem?.videoId === requestVideoId) {
        setExpandedSummaryError(message);
      }
      qaLog.radio.summaryFetchError(requestVideoId, message);
    } finally {
      if (expandedSummaryRequestRef.current === requestVideoId) {
        expandedSummaryRequestRef.current = null;
      }
      if (radioRef.current?.currentItem?.videoId === requestVideoId) {
        setExpandedSummaryLoading(false);
      }
    }
  }, []);

  const startSummaryLogin = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setExpandedSummaryError("로그인 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const origin = window.location.origin;
    rememberOAuthNext(`${window.location.pathname}${window.location.search}`);
    const redirectTo = oauthCallbackUrl(origin);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      setExpandedSummaryError("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    if (!oauthAuthorizeUrlReturnsToOrigin(data.url, origin)) {
      setExpandedSummaryError(`Supabase Redirect URLs에 ${redirectTo} 를 추가하세요.`);
      return;
    }
    window.location.assign(data.url);
  }, []);

  if (!radio) return null;

  if (radio.queue.length === 0) {
    return null;
  }

  // 확장 플레이어의 작은 대기열도 현재 항목 이후만 보여주지 않고,
  // 현재 항목을 중심으로 이전·다음 항목을 최대 5개까지 유지한다.
  const queuePreviewStart = Math.max(
    0,
    Math.min(radio.currentIndex - 2, Math.max(0, radio.queue.length - 5)),
  );
  const queuePreviewItems = radio.queue.slice(queuePreviewStart, queuePreviewStart + 5);

  return (
    <>
      {/* 미니: 우하단 320x180 / 전체: 모달 중앙 큰 영상 / 숨김: 1px */}
      <div
        id={PLAYER_WRAPPER_ID}
        ref={fullPlayerRef}
        data-testid={fullPlayerOpen ? "expanded-radio-player" : undefined}
        role={fullPlayerOpen ? "dialog" : undefined}
        aria-modal={fullPlayerOpen ? true : undefined}
        aria-label={fullPlayerOpen ? "확장 라디오 플레이어" : undefined}
        className={
          fullPlayerOpen
            ? "pointer-events-auto fixed inset-0 z-60 overflow-y-auto bg-(--surface-canvas) text-(--text-primary)"
            : videoExpanded
              ? "scroll-lock-stable-right pointer-events-auto fixed bottom-[calc(5rem+env(safe-area-inset-bottom)+0.75rem)] right-3 z-60 overflow-hidden rounded-xl border border-(--notion-border) bg-black shadow-lg transition-[box-shadow] duration-[180ms] md:bottom-24 md:right-4"
              : "pointer-events-none fixed bottom-0 left-0 h-px w-px overflow-hidden opacity-0"
        }
        style={
          fullPlayerOpen
            ? undefined
            : videoExpanded
              ? { width: `min(${MINI_VIDEO_W}px, calc(100vw - 1.5rem))`, aspectRatio: "16 / 9" }
              : undefined
        }
        aria-hidden={!videoVisible}
      >
        <div className={fullPlayerOpen ? "mx-auto flex min-h-dvh w-full max-w-[2160px] flex-col" : "h-full w-full"}>
          <header className={fullPlayerOpen ? "flex h-16 shrink-0 items-center justify-between px-4 sm:h-[72px] sm:px-7 xl:h-14" : "hidden"}>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--playback-accent-muted) text-(--playback-accent)" aria-hidden>
                <Radio size={18} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold tracking-[0.16em] text-(--text-secondary)">FOCUS FEED RADIO</p>
                <p className="mt-0.5 truncate text-sm font-semibold">현재 재생</p>
              </div>
            </div>
            <button
              ref={fullPlayerCloseRef}
              type="button"
              onClick={closeFullPlayer}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--surface-raised) text-(--text-secondary) shadow-[var(--shadow-sm)] transition-colors hover:bg-(--surface-subtle) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--playback-accent)/45"
              aria-label="확장 플레이어 닫기"
            >
              <X size={20} />
            </button>
          </header>

          <main className={fullPlayerOpen ? "flex flex-1 flex-col items-center justify-center px-3 pb-5 sm:px-7 sm:pb-7 xl:pb-3" : "h-full w-full"}>
            <div
              data-testid={fullPlayerOpen ? "expanded-radio-stage" : undefined}
              className={fullPlayerOpen ? "flex w-full items-stretch gap-4" : "h-full w-full"}
              style={
                fullPlayerOpen
                  ? {
                      width: expandedSummaryOpen
                        ? "min(100%, 2000px, calc((100dvh - 164px) * 1.77778 + clamp(360px, 21vw, 420px) + 16px))"
                        : "min(100%, 2000px, calc((100dvh - 164px) * 1.77778))",
                    }
                  : undefined
              }
            >
              <section
                ref={expandedMediaRef}
                data-testid={fullPlayerOpen ? "expanded-radio-media" : undefined}
                className={
                  fullPlayerOpen
                    ? "relative aspect-video min-w-0 flex-1 overflow-hidden rounded-2xl bg-black shadow-[0_24px_70px_rgba(15,23,42,0.22)] sm:rounded-3xl"
                    : "relative h-full w-full overflow-hidden bg-black"
                }
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setExpandedChromeVisible(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse" && !hasExpandedChromeKeyboardFocus()) {
                  setExpandedChromeVisible(false);
                }
              }}
              onFocusCapture={() => setExpandedChromeVisible(true)}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setExpandedChromeVisible(false);
                }
              }}
            >
              <div
                id={PLAYER_DIV_ID}
                className="h-full w-full"
                style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}
                aria-hidden={!videoVisible}
              />

              {videoExpanded && !fullPlayerOpen && (
                <button
                  type="button"
                  data-testid="mini-video-close"
                  onClick={() => {
                    setVideoExpanded(false);
                    qaLog.radio.videoExpandOff();
                  }}
                  className="absolute right-2 top-2 z-80 inline-flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-full border border-white/15 bg-black/72 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  aria-label="미니 영상 닫기"
                >
                  <X size={20} aria-hidden />
                </button>
              )}

              {fullPlayerOpen && radio.currentItem && resumeSeconds != null && (
                <div
                  data-testid="resume-playback-prompt"
                  className={`pointer-events-none absolute inset-x-0 top-3 z-70 flex justify-center px-3 transition-opacity duration-[180ms] motion-reduce:transition-none sm:top-4 sm:px-4 ${!expandedSummaryOpen ? "xl:right-[21rem]" : ""} ${expandedChromeVisible ? "opacity-100" : "opacity-0"}`}
                >
                  <div className="flex max-w-3xl flex-1 items-center justify-between gap-3 rounded-2xl bg-black/65 px-3 py-2 text-[11px] text-white shadow-lg backdrop-blur-md sm:rounded-full sm:px-4">
                    <span className="line-clamp-1 font-semibold">이어서 재생할 위치가 있어요.</span>
                    <button
                      type="button"
                      className="pointer-events-auto shrink-0 rounded-full bg-(--playback-accent) px-3 py-1.5 text-[10px] font-bold text-black hover:brightness-95"
                      onClick={() => {
                        try {
                          const player = playerRef.current as { seekTo?: (sec: number, allow: boolean) => void } | null;
                          if (player && typeof player.seekTo === "function") player.seekTo(resumeSeconds, true);
                        } catch {
                          // ignore
                        } finally {
                          setResumeSeconds(null);
                        }
                      }}
                    >
                      마지막 시청 {(() => {
                        const total = Math.max(0, Math.floor(resumeSeconds));
                        const h = Math.floor(total / 3600);
                        const m = Math.floor((total % 3600) / 60);
                        const s = total % 60;
                        return h > 0
                          ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                          : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
                      })()}로 이동
                    </button>
                  </div>
                </div>
              )}

              {fullPlayerOpen && radio.queue.length > 0 && !expandedSummaryOpen && (
                <aside
                  data-testid="expanded-queue-preview"
                  aria-label="재생 대기열 미리보기"
                  className={`absolute top-20 right-4 z-60 hidden max-h-[calc(100%-9rem)] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/72 text-white shadow-2xl backdrop-blur-xl transition-[opacity,transform] duration-[180ms] motion-reduce:transition-none xl:flex ${expandedChromeVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0"}`}
                >
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ListMusic size={16} className="text-emerald-300" aria-hidden />
                      <span className="text-xs font-bold">재생 대기열</span>
                    </div>
                    <span className="text-[11px] font-medium text-white/65">
                      {radio.currentIndex + 1} / {radio.queue.length}
                    </span>
                  </div>
                  <div className="min-h-0 overflow-y-auto px-2 pb-2">
                    {queuePreviewItems.map((item, offset) => {
                      const itemIndex = queuePreviewStart + offset;
                      const current = itemIndex === radio.currentIndex;
                      const relativeLabel = itemIndex < radio.currentIndex
                        ? `이전 ${radio.currentIndex - itemIndex}번째`
                        : `다음 ${itemIndex - radio.currentIndex}번째`;
                      return (
                        <button
                          key={`${item.videoId}-${itemIndex}`}
                          type="button"
                          data-testid="expanded-queue-preview-item"
                          data-queue-index={itemIndex}
                          onClick={() => radio.setCurrentIndex(itemIndex)}
                          className={`flex min-h-[68px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 ${current ? "bg-white/14" : "hover:bg-white/9"}`}
                          aria-current={current ? "true" : undefined}
                        >
                          <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-white/10">
                            <Image
                              src={`https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/mqdefault.jpg`}
                              alt=""
                              fill
                              sizes="80px"
                              className="object-cover"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 text-xs font-semibold leading-4">{item.title}</span>
                            <span className={`mt-1 block text-[10px] ${current ? "font-bold text-emerald-300" : "text-white/55"}`}>
                              {current ? (radio.isPlaying ? "재생 중" : "일시정지") : relativeLabel}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}

              </section>

              {fullPlayerOpen && expandedSummaryOpen && wideSummaryLayout && (
                <aside
                  id="expanded-ai-summary-panel"
                  data-testid="expanded-ai-summary-panel"
                  aria-label="AI 핵심 요약"
                  className="hidden w-[clamp(360px,21vw,420px)] shrink-0 self-stretch flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-raised) text-(--text-primary) shadow-[var(--shadow-lg)] xl:flex"
                >
                  <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--ai-accent-muted) text-(--ai-accent)">
                        <Sparkles size={18} aria-hidden />
                      </span>
                      <div>
                        <p className="text-[11px] font-bold tracking-[0.13em] text-(--ai-accent)">FOCUS FEED AI</p>
                        <h3 className="m-0! mt-0.5! text-base! font-bold leading-6!">AI 핵심 요약</h3>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedSummaryOpen(false)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-(--text-secondary) transition-colors hover:bg-(--surface-subtle) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ai-accent)/45"
                      aria-label="AI 요약 패널 닫기"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="min-h-0 overflow-y-auto px-5 pb-5">
                    <ExpandedSummaryBody
                      summary={radio.currentItem?.summary}
                      loading={expandedSummaryLoading}
                      error={expandedSummaryError}
                      onGenerate={generateExpandedSummary}
                      onLogin={startSummaryLogin}
                    />
                  </div>
                </aside>
              )}
            </div>

            <section
              data-testid={fullPlayerOpen ? "expanded-radio-context" : undefined}
              className={
                fullPlayerOpen
                  ? "mt-3 flex w-full max-w-[2000px] flex-col gap-3 rounded-2xl bg-(--surface-raised) px-4 py-4 shadow-[var(--shadow-sm)] sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 xl:mt-3 xl:px-5 xl:py-4"
                  : "hidden"
              }
              style={
                fullPlayerOpen
                  ? {
                      width: expandedSummaryOpen
                        ? "min(100%, 2000px, calc((100dvh - 164px) * 1.77778 + clamp(360px, 21vw, 420px) + 16px))"
                        : "min(100%, 2000px, calc((100dvh - 164px) * 1.77778))",
                    }
                  : undefined
              }
              aria-label="현재 재생 정보"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.12em] text-emerald-700 dark:text-emerald-300">NOW PLAYING</p>
                <h2 className="m-0! mt-1! line-clamp-2 text-base! font-bold leading-6! text-(--text-primary) sm:text-lg!">
                  {radio.currentItem?.title}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-(--text-secondary)">
                <button
                  data-testid="expanded-ai-summary-trigger"
                  type="button"
                  onClick={() => setExpandedSummaryOpen((open) => !open)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 xl:min-h-9 ${expandedSummaryOpen ? "bg-(--ai-accent-muted) text-(--ai-accent)" : "bg-(--surface-subtle) text-(--text-secondary) hover:text-(--ai-accent)"}`}
                  aria-expanded={expandedSummaryOpen}
                  aria-controls={wideSummaryLayout ? "expanded-ai-summary-panel" : "expanded-ai-summary-sheet"}
                >
                  <Sparkles size={14} aria-hidden />
                  AI 요약
                </button>
                <span className="inline-flex min-h-8 items-center rounded-full bg-(--playback-accent-muted) px-3 font-semibold text-emerald-700 dark:text-emerald-300">
                  {radio.isPlaying ? "재생 중" : "일시정지"}
                </span>
                <span className="inline-flex min-h-8 items-center rounded-full bg-(--surface-subtle) px-3 font-medium">
                  {radio.currentIndex + 1} / {radio.queue.length}
                </span>
              </div>
            </section>
          </main>
        </div>
      </div>

      {fullPlayerOpen && !wideSummaryLayout && (
        <ModalTransition
          open={expandedSummaryOpen}
          onClose={() => setExpandedSummaryOpen(false)}
          overlayClassName="fixed inset-0 bg-black/30 backdrop-blur-[1px] xl:hidden"
          overlayZ={80}
          panelZ={81}
          variant="bottom"
          panelId="expanded-ai-summary-sheet"
          panelTestId="expanded-ai-summary-sheet"
          panelRole="dialog"
          panelAriaLabel="AI 핵심 요약"
          transitionDuration={0.16}
          exitDuration={0.1}
          panelClassName="fixed inset-x-0 bottom-0 mx-auto flex max-h-[72dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-(--border-subtle) bg-(--surface-raised) text-(--text-primary) shadow-[0_-24px_70px_rgba(15,23,42,0.22)] xl:hidden"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-(--text-secondary)/25" aria-hidden />
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--ai-accent-muted) text-(--ai-accent)">
                <Sparkles size={18} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.13em] text-(--ai-accent)">FOCUS FEED AI</p>
                <h3 className="m-0! mt-0.5! truncate text-base! font-bold leading-6!">AI 핵심 요약</h3>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExpandedSummaryOpen(false)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--text-secondary) transition-colors hover:bg-(--surface-subtle) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ai-accent)/45"
              aria-label="AI 요약 닫기"
            >
              <X size={19} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-5">
            <ExpandedSummaryBody
              summary={radio.currentItem?.summary}
              loading={expandedSummaryLoading}
              error={expandedSummaryError}
              onGenerate={generateExpandedSummary}
              onLogin={startSummaryLogin}
            />
          </div>
        </ModalTransition>
      )}

      <RadioFooterControls
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
        lyricsOpen={lyricsOpen}
        setLyricsOpen={setLyricsOpen}
        videoExpanded={videoExpanded}
        setVideoExpanded={setVideoExpanded}
        setFullPlayerOpen={setFullPlayerOpen}
        togglePlay={togglePlay}
        progress={progress}
        onSeek={handleSeek}
      />
      
      <RadioPlaylistDrawer
        drawerOpen={drawerOpen}
        setDrawerOpen={setDrawerOpen}
      />

      <RadioLyricsView 
        lyricsOpen={lyricsOpen} 
        setLyricsOpen={setLyricsOpen} 
      />
    </>
  );
}
