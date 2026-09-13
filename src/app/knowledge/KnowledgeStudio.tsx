"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  MoreHorizontal,
  PanelRight,
  List,
  Bold,
  Italic,
  Link2,
  Heading2,
  X,
  Menu,
  MessageSquare,
  CornerDownLeft,
  Bookmark,
  Play,
  Pause,
} from "lucide-react";
import {
  knowledgeCitationUrl,
  knowledgeJobActionMessage,
  notifyKnowledgeJobsChanged,
  type KnowledgeReviewClaim,
} from "@/lib/knowledge-capture";
import { NOTEBOOKLM_PUBLIC_URL } from "@/lib/knowledge-studio-agent";
import {
  addDeferredJobId,
  loadDeferredJobIds,
  storeDeferredJobIds,
  studioChatEvidenceLines,
  studioMarkdownPreviewBlocks,
  studioParagraphSelections,
  type KnowledgeStudioDraftView,
  type StudioParagraphSelection,
  type KnowledgeStudioPayload,
} from "@/lib/knowledge-studio";
import KnowledgeStudioAgent, { STUDIO_ASK_PROMPTS, type StudioAgentControl, type StudioReviewState } from "./KnowledgeStudioAgent";

import "./workspace.css";

type VideoController = { getCurrentTime: () => number; getPlayerState: () => number; playVideo: () => void; pauseVideo: () => void; seekTo: (time: number, allowSeekAhead: boolean) => void; destroy: () => void };
type YouTubeApi = { Player: new (frame: HTMLIFrameElement, options: { events: { onReady: () => void; onError: () => void; onStateChange: (event: { data: number }) => void; onAutoplayBlocked: () => void } }) => VideoController };
let videoApiPromise: Promise<YouTubeApi> | undefined;
function loadVideoApi(): Promise<YouTubeApi> {
  const host = window as Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
  if (host.YT?.Player) return Promise.resolve(host.YT);
  if (videoApiPromise) return videoApiPromise;
  videoApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = host.onYouTubeIframeAPIReady;
    const timer = window.setTimeout(() => reject(new Error("player unavailable")), 12_000);
    host.onYouTubeIframeAPIReady = () => { previous?.(); window.clearTimeout(timer); if (host.YT?.Player) resolve(host.YT); else reject(new Error("player unavailable")); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => { window.clearTimeout(timer); reject(new Error("player unavailable")); };
    document.head.append(script);
  }).catch(error => { videoApiPromise = undefined; throw error; });
  return videoApiPromise;
}
function timeLabel(seconds: number) { const time = Math.max(0, Math.floor(seconds)); return `${Math.floor(time / 60).toString().padStart(2, "0")}:${(time % 60).toString().padStart(2, "0")}`; }
function citationTime(citation: string | null | undefined): number | null { const match = citation?.match(/(\d+):(\d{2})(?::(\d{2}))?/); if (!match) return null; return match[3] ? Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) : Number(match[1])*60 + Number(match[2]); }

type StudioTab = "video" | "page" | "agent";

const TABS: { id: StudioTab; label: string }[] = [
  { id: "video", label: "영상" },
  { id: "page", label: "페이지" },
  { id: "agent", label: "에이전트" },
];

const STUDIO_WIDTHS_KEY = "ff_studio_pane_widths";
const SOURCE_DEFAULT = 417;
const RAIL_DEFAULT = 463;
const SOURCE_MIN = 200;
const SOURCE_MAX = 600;
const RAIL_MIN = 300;
const RAIL_MAX = 520;

function clampPane(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStudioWidths() {
  if (typeof window === "undefined") {
    return { source: SOURCE_DEFAULT, rail: RAIL_DEFAULT };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STUDIO_WIDTHS_KEY) ?? "") as {
      source?: unknown
      rail?: unknown
    };
    return {
      source: clampPane(Number(parsed.source) || SOURCE_DEFAULT, SOURCE_MIN, SOURCE_MAX),
      rail: clampPane(Number(parsed.rail) || RAIL_DEFAULT, RAIL_MIN, RAIL_MAX),
    };
  } catch {
    const [source, rail] = paneWidthSnapshot.split(":").map(Number);
    return { source, rail };
  }
}

const paneWidthListeners = new Set<() => void>();
let paneWidthSnapshot = `${SOURCE_DEFAULT}:${RAIL_DEFAULT}`;

function emitStudioWidths() {
  paneWidthListeners.forEach((listener) => listener());
}

function writeStudioWidths(widths: { source: number; rail: number }) {
  try { window.localStorage.setItem(STUDIO_WIDTHS_KEY, JSON.stringify(widths)); } catch { /* Keep the live layout usable when storage is unavailable. */ }
  paneWidthSnapshot = `${widths.source}:${widths.rail}`;
  emitStudioWidths();
}

function subscribeStudioWidths(listener: () => void) {
  paneWidthListeners.add(listener);
  return () => {
    paneWidthListeners.delete(listener);
  };
}

function getStudioWidthSnapshot() {
  if (typeof window === "undefined") return `${SOURCE_DEFAULT}:${RAIL_DEFAULT}`;
  const widths = readStudioWidths();
  const next = `${widths.source}:${widths.rail}`;
  if (next !== paneWidthSnapshot) paneWidthSnapshot = next;
  return paneWidthSnapshot;
}

function parseStudioWidths(snapshot: string) {
  const [source, rail] = snapshot.split(":").map(Number);
  return { source, rail };
}

function useStudioPaneWidths() {
  const snapshot = useSyncExternalStore(
    subscribeStudioWidths,
    getStudioWidthSnapshot,
    () => `${SOURCE_DEFAULT}:${RAIL_DEFAULT}`,
  );
  const widths = parseStudioWidths(snapshot);

  const persist = useCallback((next: { source: number; rail: number }) => {
    writeStudioWidths({
      source: clampPane(next.source, SOURCE_MIN, SOURCE_MAX),
      rail: clampPane(next.rail, RAIL_MIN, RAIL_MAX),
    });
  }, []);

  const reset = useCallback(() => {
    persist({ source: SOURCE_DEFAULT, rail: RAIL_DEFAULT });
  }, [persist]);

  const startDrag = useCallback((edge: "source" | "rail", event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const start = { source: widths.source, rail: widths.rail };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      persist(edge === "source"
        ? { ...start, source: start.source + dx }
        : { ...start, rail: start.rail - dx });
    };
    const onUp = () => {
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [persist, widths.rail, widths.source]);

  const nudge = (edge: "source" | "rail", delta: number) => persist({ ...widths, [edge]: widths[edge] + delta });
  return { widths, startDrag, reset, nudge };
}

function verifiedClaims(claims: KnowledgeReviewClaim[] | undefined): KnowledgeReviewClaim[] {
  return (claims ?? []).filter((claim) => claim.citationVerified && Boolean(claim.citation));
}

function NotebookLmOpen({
  sourceUrl,
  testId,
  hintTestId,
}: {
  sourceUrl?: string;
  testId: string;
  hintTestId?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copySourceUrl = useCallback(() => {
    if (!sourceUrl) return;
    void navigator.clipboard.writeText(sourceUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }, [sourceUrl]);

  return (
    <div className="mt-5">
      {hintTestId && <span data-testid={hintTestId} className="sr-only">NotebookLM은 URL 복사 후 새 탭</span>}
      <a
        href={NOTEBOOKLM_PUBLIC_URL}
        target="_blank"
        rel="noreferrer"
        data-testid={testId}
        onClick={copySourceUrl}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-sm)] border border-(--border-subtle) bg-(--surface-raised) px-3 text-sm font-semibold hover:bg-(--surface-hover)"
      >
        {copied ? "복사됨 · NotebookLM" : "NotebookLM에 URL 복사"}
      </a>
    </div>
  );
}

function splitDraft(markdown: string, fallback: string) {
  const titled = markdown.match(/^#\s+(.+?)\r?\n+([\s\S]*)$/);
  if (titled) return { title: titled[1].trim(), body: titled[2] };
  const titleOnly = markdown.match(/^#\s+(.+)\s*$/);
  if (titleOnly) return { title: titleOnly[1].trim(), body: "" };
  return { title: fallback, body: markdown };
}

function joinDraft(title: string, body: string) {
  return `# ${title.trim() || "초안"}\n\n${body.replace(/^\s+/, "")}`;
}

function applyDraftEditorInput(current: string, fallback: string, next: string) {
  if (next.startsWith("# ")) return next;
  return joinDraft(splitDraft(current, fallback).title, next);
}

function sourceGuideParts(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  return { title: lines[0] ?? "", lines: lines.slice(1) };
}

function InlineText({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-(--surface-subtle) px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="underline underline-offset-4">{link[1]}</a>;
    return part;
  });
}

function Preview({ markdown, selection, revision = 0, onSelect, inline, replacing = false }: { markdown: string; selection?: StudioParagraphSelection | null; revision?: number; onSelect?: (target: StudioParagraphSelection) => void; inline?: ReactNode; replacing?: boolean }) {
  const blocks = studioMarkdownPreviewBlocks(markdown);
  const paragraphs = studioParagraphSelections(markdown, revision);
  let paragraphIndex = 0;
  if (blocks.length === 0) {
    return <p className="text-sm text-(--text-secondary)">미리볼 내용이 없어요.</p>;
  }
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === "h1") {
          return <h2 id={`studio-heading-${index}`} key={index} className={`${index === 0 ? "mt-0" : ""} text-[1.75rem] font-semibold leading-8 tracking-[-0.03em]`}><InlineText text={block.text} /></h2>;
        }
        if (block.type === "h2") {
          return <h3 id={`studio-heading-${index}`} key={index} className="text-base font-semibold leading-6"><InlineText text={block.text} /></h3>;
        }
        if (block.type === "ul") {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5 text-[15px] leading-7">
              {block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}><InlineText text={item} /></li>)}
            </ul>
          );
        }
        const target = paragraphs[paragraphIndex++];
        const selected = !!target && selection?.start === target.start && selection.text === target.text && selection.revision === revision;
        return <div key={index} className="workspace-paragraph"><p hidden={selected && replacing} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-pressed={onSelect ? selected : undefined} onClick={event => { if (!(event.target as HTMLElement).closest("a") && target) onSelect?.(target); }} onKeyDown={event => { if (event.target !== event.currentTarget) return; if ((event.key === "Enter" || event.key === " ") && target) { event.preventDefault(); onSelect?.(target); } }} className="workspace-selectable text-[15px] leading-7"><InlineText text={block.text} /></p>{selected && inline}</div>;
      })}
    </div>
  );
}

export default function KnowledgeStudio({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<KnowledgeStudioPayload | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [revision, setRevision] = useState(0);
  const [savedMarkdown, setSavedMarkdown] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<StudioTab>("page");
  const [pageMode, setPageMode] = useState<"edit" | "preview">("preview");
  const [layoutMode, setLayoutMode] = useState<"study" | "watch" | "write">("study");
  const [aiOpen, setAiOpen] = useState(true);
  const [miniVideo, setMiniVideo] = useState(false);
  const [selection, setSelection] = useState<StudioParagraphSelection | null>(null);
  const agentControl = useRef<StudioAgentControl>(null);
  const [review, setReview] = useState<StudioReviewState | null>(null);
  const [inlineMessage, setInlineMessage] = useState("");
  const [activeHeading, setActiveHeading] = useState("");
  const [sourceTab, setSourceTab] = useState<"evidence" | "guide" | "comments" | "notes">("evidence");
  const videoFrame = useRef<HTMLIFrameElement>(null);
  const videoController = useRef<VideoController | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [followVideo, setFollowVideo] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteTime, setNoteTime] = useState("00:00");
  const [watchMessage, setWatchMessage] = useState("");
  const { widths, startDrag, reset, nudge } = useStudioPaneWidths();
  const [agentApplying, setAgentApplying] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveGen = useRef(0);

  const closeStudio = useCallback(() => {
    router.replace("/knowledge");
  }, [router]);

  const applyDraft = useCallback((draft: KnowledgeStudioDraftView) => {
    setSelection(null);
    setMarkdown(draft.markdown);
    setRevision(draft.revision);
    setSavedMarkdown(draft.markdown);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    try {
      const response = await fetch(`/api/knowledge/jobs/${encodeURIComponent(jobId)}/studio`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const data = await response.json().catch(() => null) as (KnowledgeStudioPayload & { error?: string }) | null;
      if (response.status === 401) {
        setAuthRequired(true);
        setPayload(null);
        return;
      }
      if (!response.ok || !data?.job) throw new Error(data?.error ?? "작업실을 불러오지 못했어요.");
      setPayload(data);
      if (data.studioDraft) applyDraft(data.studioDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업실을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [applyDraft, jobId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const frame = videoFrame.current;
    if (!frame || !payload?.studioAvailable) return;
    let disposed = false;
    let controller: VideoController | null = null;
    let poll: number | undefined;
    const failed = () => {
      if (disposed) return;
      setPlayerReady(false);
      setPlayerFailed(true);
      setVideoPlaying(false);
      setPlaybackBlocked(false);
      window.clearInterval(poll);
    };
    const readyTimeout = window.setTimeout(failed, 15_000);
    void loadVideoApi().then(api => {
      if (disposed) return;
      controller = new api.Player(frame, { events: {
        onReady: () => { if (disposed) return; window.clearTimeout(readyTimeout); window.clearInterval(poll); videoController.current = controller; setPlayerFailed(false); setPlayerReady(true); poll = window.setInterval(() => { const next = controller?.getCurrentTime(); if (Number.isFinite(next)) setVideoTime(next!); }, 750); },
        onError: () => { window.clearTimeout(readyTimeout); failed(); },
        onStateChange: ({ data }) => {
          if (disposed) return;
          setVideoPlaying(data === 1 || data === 3);
          if (data === 1) setPlaybackBlocked(false);
        },
        onAutoplayBlocked: () => { if (!disposed) { setVideoPlaying(false); setPlaybackBlocked(true); } },
      }});
    }).catch(() => { window.clearTimeout(readyTimeout); failed(); });
    return () => { disposed = true; window.clearTimeout(readyTimeout); window.clearInterval(poll); videoController.current = null; queueMicrotask(() => { if (!frame.isConnected) controller?.destroy(); }); };
  }, [payload?.job.videoId, payload?.studioAvailable, playerAttempt]);

  const retryVideo = () => {
    setPlayerFailed(false);
    setPlayerReady(false);
    setVideoPlaying(false);
    setPlaybackBlocked(false);
    setFollowVideo(false);
    setVideoTime(0);
    setPlayerAttempt(attempt => attempt + 1);
  };

  const togglePlayback = () => {
    const controller = videoController.current;
    if (!playerReady || !controller) return;
    setPlaybackBlocked(false);
    const state = controller.getPlayerState();
    if (state === 1 || state === 3) controller.pauseVideo();
    else controller.playVideo();
  };

  const canEdit = payload?.studioAvailable === true && payload.job.status === "review_required";
  const dirty = markdown !== savedMarkdown;
  const jobStatus = payload?.job.status;
  const approveLocked = !canEdit || saveState === "saving" || approving || agentApplying;
  const approveLabel = jobStatus === "completed"
    ? "적재됨"
    : jobStatus === "approving" || approving
      ? "승인 적재 중"
      : "브레인에 승인";

  const save = useCallback(async () => {
    if (!canEdit || agentApplying) return;
    const nextMarkdown = markdown;
    const expectedRevision = revision;
    if (!nextMarkdown.trim() || nextMarkdown === savedMarkdown) return;
    const gen = ++saveGen.current;
    setSaveState("saving");
    setSaveError(null);
    try {
      const response = await fetch(`/api/knowledge/jobs/${encodeURIComponent(jobId)}/studio`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: nextMarkdown, expectedRevision }),
      });
      const data = await response.json().catch(() => null) as {
        studioDraft?: KnowledgeStudioDraftView;
        error?: string;
      } | null;
      if (gen !== saveGen.current) return;
      if (response.status === 409) {
        setSaveState("error");
        setSaveError(data?.error ?? "다른 곳에서 초안이 바뀌었어요. 다시 불러옵니다.");
        await load();
        return;
      }
      if (!response.ok || !data?.studioDraft) {
        throw new Error(data?.error ?? "초안을 저장하지 못했어요.");
      }
      setRevision(data.studioDraft.revision);
      setSavedMarkdown(data.studioDraft.markdown);
      setSaveState("saved");
    } catch (cause) {
      if (gen !== saveGen.current) return;
      setSaveState("error");
      setSaveError(cause instanceof Error ? cause.message : "초안을 저장하지 못했어요.");
    }
  }, [canEdit, agentApplying, jobId, load, markdown, revision, savedMarkdown]);

  const approveToBrain = useCallback(async () => {
    if (approveLocked) return;
    setApproving(true);
    setDecisionError(null);
    try {
      const response = await fetch(`/api/knowledge/jobs/${encodeURIComponent(jobId)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown, expectedRevision: revision }),
      });
      const data = await response.json().catch(() => null) as {
        job?: KnowledgeStudioPayload["job"];
        statusLabel?: string;
        studioDraft?: KnowledgeStudioDraftView;
        error?: string;
      } | null;
      if (response.status === 401) {
        setAuthRequired(true);
        return;
      }
      if (response.status === 409) {
        setDecisionError(data?.error ?? "다시 불러온 뒤 승인해 주세요.");
        await load();
        return;
      }
      if (!response.ok || !data?.job) {
        throw new Error(data?.error ?? "승인을 시작하지 못했어요.");
      }
      setPayload((current) => current ? {
        ...current,
        job: data.job!,
        statusLabel: data.statusLabel ?? current.statusLabel,
        studioDraft: data.studioDraft ?? current.studioDraft,
      } : current);
      if (data.studioDraft) applyDraft(data.studioDraft);
      notifyKnowledgeJobsChanged();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "승인을 시작하지 못했어요.");
    } finally {
      setApproving(false);
    }
  }, [applyDraft, approveLocked, jobId, load, markdown, revision]);

  const deferReview = useCallback(() => {
    storeDeferredJobIds(addDeferredJobId(loadDeferredJobIds(), jobId));
    closeStudio();
  }, [closeStudio, jobId]);

  const askFromPage = useCallback((text: string) => {
    setSelection(null);
    setAiOpen(true);
    setLayoutMode(current => current === "watch" ? "study" : current);
    setAskSeed(text);
    setTab("agent");
  }, []);

  const consumeAskSeed = useCallback(() => {
    setAskSeed(null);
  }, []);

  useEffect(() => {
    if (!canEdit || !dirty) return;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, markdown, save]);

  const evidence = useMemo(
    () => verifiedClaims(payload?.review?.claims),
    [payload?.review?.claims],
  );
  const evidenceLines = useMemo(
    () => payload?.review ? studioChatEvidenceLines(payload.review) : [],
    [payload?.review],
  );
  const sourceUrl = payload?.job.sourceUrl
    ?? (payload ? `https://www.youtube.com/watch?v=${payload.job.videoId}` : undefined);
  const actionMessage = payload ? knowledgeJobActionMessage(payload.job) : null;
  const fallbackTitle = payload?.job.title ?? "초안";
  const pageDraft = splitDraft(markdown, fallbackTitle);
  const headings = studioMarkdownPreviewBlocks(markdown).flatMap((block, index) => block.type === "h2" ? [{ id: `studio-heading-${index}`, text: block.text }] : []);
  const guide = sourceGuideParts(payload?.sourceGuide ?? "");

  const timedEvidence = evidence.map(claim => ({ claim, seconds: citationTime(claim.citation) })).filter((item): item is { claim: KnowledgeReviewClaim; seconds: number } => item.seconds !== null);
  const activeTime = timedEvidence.filter(item => item.seconds <= videoTime).sort((a,b) => b.seconds-a.seconds)[0]?.seconds;
  const notes = [...markdown.matchAll(/^- \[(\d+:\d{2})\]\((https?:\/\/[^\s)]+)\) (.+)$/gm)].map(match => ({ time: match[1], url: match[2], text: match[3] }));
  const seekVideo = (seconds: number) => { if (playerReady) { videoController.current?.seekTo(seconds, true); setVideoTime(seconds); } };
  const addNote = () => { if (!canEdit || agentApplying || !noteText.trim() || citationTime(noteTime) === null || !sourceUrl) return; const seconds = citationTime(noteTime)!; const line = `- [${timeLabel(seconds)}](${knowledgeCitationUrl(sourceUrl, `[${timeLabel(seconds)}]`)}) ${noteText.trim().replace(/\n/g, " ")}`; setMarkdown(current => current.split("\n").includes(line) ? current : `${current.trimEnd()}${current.includes("## 시점 메모") ? "\n" : "\n\n## 시점 메모\n\n"}${line}\n`); setSaveState("idle"); setNoteText(""); };

  useEffect(() => {
    if (followVideo && playerReady && sourceTab === "evidence" && activeTime !== undefined) {
      document.querySelector('.workspace-evidence li[data-active="true"]')?.scrollIntoView({block:"nearest",behavior:"auto"});
    }
  }, [followVideo, playerReady, sourceTab, activeTime]);

  const paneHidden = (id: StudioTab) =>
    tab === id ? "block" : "hidden lg:block";

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 bg-(--surface-canvas) text-sm text-(--text-secondary)">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />작업실을 여는 중
      </main>
    );
  }

  if (authRequired) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="font-semibold">로그인하면 작업실을 볼 수 있어요.</p>
        <Link href={`/login?next=${encodeURIComponent(`/knowledge?job=${jobId}`)}`} className="inline-flex min-h-11 items-center rounded-xl border border-(--border-subtle) px-4 text-sm font-semibold hover:bg-(--surface-subtle)">
          로그인하기
        </Link>
      </main>
    );
  }

  if (error || !payload) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-sm text-red-700 dark:text-red-300">{error ?? "작업실을 불러오지 못했어요."}</p>
        <button type="button" onClick={closeStudio} className="inline-flex min-h-11 items-center rounded-xl border border-(--border-subtle) px-4 text-sm font-semibold hover:bg-(--surface-subtle)">
          지식함으로
        </button>
      </main>
    );
  }

  return (
    <div data-player-ready={playerReady} data-mode={layoutMode} data-ai-open={aiOpen} data-mini-video={miniVideo} className="knowledge-workspace flex h-dvh min-h-0 flex-col overflow-hidden bg-(--surface-canvas)">
      <header className="workspace-header relative z-20 shrink-0 border-b border-(--border-subtle) bg-(--surface-canvas) px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeStudio}
            aria-label="지식함 목록으로"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-(--border-subtle) bg-(--surface-raised) hover:bg-(--surface-subtle) focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="workspace-brand min-w-0">
            <p className="truncate text-sm font-semibold">Focus Feed <span>/ 지식함</span></p>
            <p className="truncate text-xs text-(--text-secondary)">
              {payload.statusLabel}
            </p>
          </div>
      <nav className="workspace-modes" aria-label="작업실 보기" hidden={!payload.studioAvailable}>
        {([["study", "자료와 정리"], ["watch", "영상 집중"], ["write", "문서 집중"]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={layoutMode === mode} onClick={() => { setLayoutMode(mode); if (mode === "watch") setSourceTab("evidence"); if (mode !== "study") setAiOpen(false); setTab(mode === "watch" ? "video" : "page"); }}>{label}</button>)}
        {layoutMode === "write" && <button className="workspace-mini-toggle" type="button" aria-pressed={miniVideo} onClick={() => setMiniVideo(!miniVideo)}>작은 영상</button>}
        <button type="button" className="workspace-ai-toggle" aria-pressed={aiOpen} onClick={() => { setAiOpen(!aiOpen); setTab(aiOpen ? "page" : "agent"); if (!aiOpen && layoutMode === "watch") setLayoutMode("study"); }}><PanelRight size={16} aria-hidden="true" />{aiOpen ? "AI 접기" : "AI 열기"}</button>
      </nav>
          <details className="relative lg:hidden">
            <summary className="inline-flex h-11 w-11 list-none items-center justify-center rounded-[var(--radius-md)] border border-(--border-subtle) marker:hidden">
              <MoreHorizontal size={18} aria-hidden="true" />
              <span className="sr-only">더보기</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 min-w-40 rounded-[var(--radius-md)] border border-(--border-subtle) bg-(--surface-raised) p-1 shadow-[var(--shadow-xs)]">
              <button
                type="button"
                disabled={!canEdit || approving}
                onClick={deferReview}
                className="inline-flex min-h-11 w-full items-center rounded-[var(--radius-md)] px-3 text-sm font-semibold hover:bg-(--surface-subtle) disabled:text-(--text-secondary)"
              >
                보류
              </button>
            </div>
          </details>
          <button
            type="button"
            disabled={!canEdit || approving}
            onClick={deferReview}
            className="hidden min-h-11 items-center rounded-[var(--radius-md)] border border-(--border-subtle) px-4 text-sm font-semibold hover:bg-(--surface-subtle) disabled:text-(--text-secondary) lg:inline-flex"
          >
            보류
          </button>
          <button
            type="button"
            disabled={approveLocked}
            onClick={() => void approveToBrain()}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] bg-(--text-primary) px-4 text-sm font-semibold text-(--surface-canvas) disabled:opacity-60"
          >
            {approving ? <Loader2 size={15} className="mr-2 animate-spin" aria-hidden="true" /> : null}
            {approveLabel}
          </button>
        </div>
        {decisionError && (
          <p role="status" className="mt-2 text-xs text-red-700 dark:text-red-300">{decisionError}</p>
        )}
        {jobStatus === "completed" && (
          <p role="status" className="mt-2 text-sm text-(--text-secondary)">브레인에 저장한 문서입니다. <a className="underline" href={`/knowledge/amendments/${encodeURIComponent(jobId)}`}>원본을 보존하고 수정안 만들기</a> · <a className="underline" href={`/knowledge/usage/${encodeURIComponent(jobId)}`}>활용 메모</a></p>
        )}
        {saveError && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p role="status" className="text-xs text-red-700 dark:text-red-300">{saveError}</p>
            {canEdit && (
              <button type="button" onClick={() => void save()} className="min-h-11 rounded-[var(--radius-md)] border border-current px-3 text-xs font-semibold text-red-700 dark:text-red-300">
                다시 저장
              </button>
            )}
          </div>
        )}
      </header>

      <nav hidden={!payload.studioAvailable} aria-label="작업실 패널" className="grid shrink-0 grid-cols-3 gap-1 border-b border-(--border-subtle) bg-(--surface-subtle) p-1 lg:hidden">
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => { setTab(item.id); if (item.id === "agent") { setAiOpen(true); if (layoutMode === "watch") setLayoutMode("study"); } }}
              className={`min-h-11 rounded-[var(--radius-md)] px-2 text-sm font-semibold transition-opacity duration-[var(--motion-standard)] motion-reduce:transition-none ${
                selected
                  ? "bg-(--surface-raised) text-(--text-primary) shadow-[var(--shadow-xs)]"
                  : "text-(--text-secondary)"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {!aiOpen && payload.studioAvailable && layoutMode !== "watch" && <button className="workspace-floating-ai" type="button" onClick={() => { setAiOpen(true); setTab("agent"); }}><MessageSquare size={18} aria-hidden="true" />AI와 이어서 작성하기</button>}
      {!payload.studioAvailable ? (
        <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <p className="font-semibold">{payload.statusLabel}</p>
          <p className="text-sm text-(--text-secondary)">
            {actionMessage ?? "아직 작업실에서 고칠 초안이 없어요. 처리가 끝나면 여기로 다시 열려요."}
          </p>
        </section>
      ) : (
        <div className="workspace-panes flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <section
            aria-label="영상과 근거"
            style={{ ["--studio-source-now" as string]: `${widths.source}px` }}
            className={`${paneHidden("video")} studio-source min-h-0 overflow-y-auto bg-studio-pane px-4 py-4`}
          >
            <button className="workspace-source-back" type="button" onClick={closeStudio}><ArrowLeft size={14} aria-hidden="true" />지식함으로 돌아가기</button>
            <div className="workspace-player relative aspect-video w-full overflow-hidden bg-black">
              <iframe
                key={`${payload.job.videoId}:${playerAttempt}`}
                ref={videoFrame}
                title={payload.job.title ?? payload.job.videoId}
                src={`https://www.youtube.com/embed/${encodeURIComponent(payload.job.videoId)}?autoplay=0&rel=0&enablejsapi=1&origin=${typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : ""}`}
                className="absolute inset-0 h-full w-full border-0"
                allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
              {playerFailed && <div className="workspace-player-notice" role="status" aria-label="영상 연결 안내">
                <strong>영상을 연결하지 못했어요</strong>
                <p>다시 시도하거나 YouTube에서 이어서 볼 수 있어요.</p>
                <div><button type="button" aria-label="영상 다시 시도" onClick={retryVideo}>다시 시도</button><a href={sourceUrl} target="_blank" rel="noreferrer">YouTube에서 열기</a></div>
              </div>}
              {layoutMode === "write" && miniVideo && <button className="workspace-mini-close" aria-label="작은 영상 닫기" type="button" onClick={() => setMiniVideo(false)}><X size={16} aria-hidden="true" /></button>}
            </div>
            {playerReady && <div className="workspace-playback">
              <button type="button" aria-label={videoPlaying ? "영상 일시정지" : "영상 재생"} onClick={togglePlayback}>
                {videoPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{videoPlaying ? "일시정지" : "재생"}
              </button>
              <span className="workspace-playback-time">{timeLabel(videoTime)}</span>
              {playbackBlocked && <span role="status" aria-label="영상 재생 안내">영상 안의 재생 버튼을 눌러주세요.</span>}
            </div>}
            <h1 style={{ fontSize: "1rem", lineHeight: "1.5", marginTop: "0.75rem", marginBottom: 0 }} className="break-words font-semibold">
              {payload.job.title ?? `YouTube ${payload.job.videoId}`}
            </h1>
            {sourceUrl && <a className="workspace-video-fallback" href={sourceUrl} target="_blank" rel="noreferrer">영상이 보이지 않으면 원본에서 열기</a>}
            {payload.job.channelName && (
              <p className="mt-1 truncate text-xs text-(--text-secondary)">{payload.job.channelName}</p>
            )}
            <nav className="workspace-source-tabs" aria-label="자료 종류"><button type="button" aria-label="근거 발췌" aria-pressed={sourceTab === "evidence"} onClick={() => setSourceTab("evidence")}>자막</button><button hidden={layoutMode === "watch"} type="button" aria-pressed={sourceTab === "guide"} onClick={() => setSourceTab("guide")}>소스 가이드</button><button hidden={layoutMode === "watch"} type="button" aria-pressed={sourceTab === "comments"} onClick={() => setSourceTab("comments")}>댓글</button>{layoutMode === "watch" && <button type="button" aria-pressed={sourceTab === "notes"} onClick={() => setSourceTab("notes")}>메모</button>}{layoutMode === "watch" && <button className="workspace-follow" title="확인된 자막 발췌의 재생 위치를 따라갑니다" type="button" aria-pressed={followVideo} disabled={!playerReady} onClick={() => setFollowVideo(!followVideo)}><Play size={14} aria-hidden="true"/>재생 따라가기</button>}</nav>
            {sourceTab === "comments" && <div className="workspace-empty"><p>아직 가져온 댓글이 없어요.</p><a href={sourceUrl} target="_blank" rel="noreferrer">YouTube에서 댓글 보기</a></div>}
            {guide.title && (
              <div hidden={sourceTab !== "guide"} className="mt-5 workspace-guide">
                <p className="text-xs font-semibold text-(--text-secondary)">{guide.title}</p>
                {guide.lines.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {guide.lines.map((line) => (
                      <li key={line} className="text-xs leading-5 text-(--text-secondary)">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {sourceTab === "evidence" && evidence.length === 0 && <p className="workspace-empty">확인된 근거 발췌가 아직 없어요.</p>}
            {sourceTab === "guide" && !guide.title && <p className="workspace-empty">소스 가이드가 아직 없어요.</p>}
            {evidence.length > 0 && (
              <div hidden={sourceTab !== "evidence"} className="mt-5 workspace-evidence">
                <div className="workspace-source-scope"><span>확인된 자막 발췌</span></div>
                <ul className="mt-2 space-y-3">
                  {evidence.map((claim) => {
                    const href = knowledgeCitationUrl(sourceUrl, claim.citation);
                    return (
                      <li data-active={playerReady && citationTime(claim.citation) === activeTime} key={`${claim.citation}-${claim.statement}`}>
                        {claim.evidenceExcerpt && (
                          <blockquote className="text-xs leading-5 text-(--text-secondary)">{claim.evidenceExcerpt}</blockquote>
                        )}
                        {!claim.evidenceExcerpt && <p className="mt-1 text-sm leading-6">{claim.statement}</p>}
                        {href && claim.citation && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            onClick={event => { const seconds = citationTime(claim.citation); if (playerReady && seconds !== null) { event.preventDefault(); seekVideo(seconds); } }} aria-label={`${claim.citation} 원본에서 확인`} className="workspace-citation mt-1 inline-flex min-h-11 items-center text-xs text-(--text-secondary) hover:text-(--text-primary) hover:underline"
                          >
                            {claim.citation.replace(/[\[\]]/g, "")}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {layoutMode === "watch" && <>
              <section className="workspace-video-notes" hidden={sourceTab !== "notes" && sourceTab !== "evidence"} aria-label="시점 메모">
                <div className="workspace-notes-heading"><strong>내 메모</strong><span>{saveState === "saving" ? "저장 중" : dirty ? "수정 중" : "문서에 저장"}</span></div>
                {notes.map((note,index) => <div className="workspace-note" key={index}><a href={note.url} target="_blank" rel="noreferrer" onClick={event => { if (playerReady) { event.preventDefault(); seekVideo(citationTime(note.time)!); } }}>{note.time}</a><p>{note.text}</p></div>)}
                <form onSubmit={event => {event.preventDefault();addNote();}}><input aria-label="메모 시점" value={noteTime} onChange={event=>setNoteTime(event.target.value)} pattern="[0-9]+:[0-5][0-9]" required/><textarea aria-label="시점 메모 내용" value={noteText} onChange={event=>setNoteText(event.target.value)} placeholder="이 순간 떠오른 생각" maxLength={1000} rows={2}/><button disabled={!canEdit || agentApplying || !noteText.trim()} type="submit">메모 저장</button></form>
              </section>
              <div className="workspace-watch-actions"><button type="button" onClick={()=>{setNoteTime(timeLabel(videoTime));setSourceTab("notes");document.querySelector<HTMLTextAreaElement>('[aria-label="시점 메모 내용"]')?.focus();}}><Bookmark size={16}/>현재 시점에 메모</button>{!playerReady && <span>영상 연결 전에는 시점을 직접 적을 수 있어요.</span>}</div>
              <nav className="workspace-timeline" aria-label="확인된 영상 시점">{timedEvidence.slice(0,6).map(({claim,seconds})=><a key={`${seconds}-${claim.statement}`} href={knowledgeCitationUrl(sourceUrl,claim.citation) ?? sourceUrl} target="_blank" rel="noreferrer" onClick={event=>{if(playerReady){event.preventDefault();seekVideo(seconds);}}}><span>{timeLabel(seconds)}</span><strong>{claim.evidenceExcerpt ?? claim.statement}</strong></a>)}</nav>
              <form className="workspace-watch-question" onSubmit={event=>{event.preventDefault();if(watchMessage.trim()) {setSelection(null);askFromPage(watchMessage);setWatchMessage("");}}}><MessageSquare size={22}/><input aria-label="영상 질문" value={watchMessage} onChange={event=>setWatchMessage(event.target.value)} placeholder="AI에게 물어보거나, 아이디어를 정리해요…" maxLength={500}/><button type="submit" aria-label="영상 질문 이어가기" disabled={!watchMessage.trim()}><CornerDownLeft size={20}/></button></form>
            </>}
            <NotebookLmOpen
              sourceUrl={sourceUrl}
              testId="studio-notebooklm-open"
              hintTestId="studio-notebooklm-optional"
            />
          </section>

          <button
            type="button"
            aria-label="원본 칸 너비"
            onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge("source", event.key === "ArrowRight" ? 20 : -20); } }}
            title="드래그해서 칸 너비. 더블클릭하면 원래대로."
            className="studio-gutter hidden lg:block"
            onPointerDown={(event) => startDrag("source", event)}
            onDoubleClick={reset}
          />

          <section
            aria-label="요약 페이지"
            className={`${tab === "page" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col lg:flex`}
          >
            <div className="mb-2 grid grid-cols-2 gap-1 border-b border-(--border-subtle) p-1 lg:hidden">
              {(["edit", "preview"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={pageMode === mode}
                  disabled={mode === "edit" && !canEdit}
                  onClick={() => setPageMode(mode)}
                  className={`min-h-11 text-sm font-semibold ${
                    pageMode === mode ? "text-(--text-primary)" : "text-(--text-secondary)"
                  }`}
                >
                  {mode === "edit" ? "편집" : "보기"}
                </button>
              ))}
            </div>
            <div className="workspace-page-meta hidden items-center gap-4 px-[var(--studio-page-x)] py-2 lg:flex"><span className="mr-auto text-sm text-(--text-secondary)">내 문서 <span className="workspace-document-badge">{saveState === "saving" ? "저장 중" : dirty ? "수정 중" : "저장됨"}</span></span>
              {(["edit", "preview"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={pageMode === mode}
                  disabled={mode === "edit" && !canEdit}
                  onClick={() => setPageMode(mode)}
                  className={`min-h-11 text-sm ${
                    pageMode === mode
                      ? "font-semibold text-(--text-primary)"
                      : "text-(--text-secondary)"
                  }`}
                >
                  {mode === "edit" ? "편집" : "보기"}
                </button>
              ))}
            </div>
            <div className="workspace-editor-tools" aria-label="문서 서식">
              <button type="button" disabled={!canEdit || agentApplying} onClick={() => setPageMode(pageMode === "edit" ? "preview" : "edit")}>{pageMode === "edit" ? "미리보기" : "본문 편집"}</button><span aria-hidden="true" />
              {([{label:"제목", icon:Heading2, before:"\n## ", after:""}, {label:"굵게",icon:Bold,before:"**",after:"**"},{label:"기울임",icon:Italic,before:"*",after:"*"},{label:"링크",icon:Link2,before:"[",after:"](https://)"}]).map(item => <button key={item.label} type="button" aria-label={item.label} title={item.label} disabled={!canEdit || agentApplying} onClick={() => {
                const input = editorRef.current;
                const start = input?.selectionStart ?? pageDraft.body.length;
                const end = input?.selectionEnd ?? start;
                const selected = pageDraft.body.slice(start, end) || "텍스트";
                const body = pageDraft.body.slice(0,start) + item.before + selected + item.after + pageDraft.body.slice(end);
                setMarkdown(applyDraftEditorInput(markdown, fallbackTitle, body)); setSaveState("idle"); setPageMode("edit");
                requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(start + item.before.length,start + item.before.length + selected.length); });
              }}><item.icon size={17} aria-hidden="true" /></button>)}
            </div>
            <div onScroll={(event) => { const root = event.currentTarget; const top = root.getBoundingClientRect().top; const nodes = Array.from(root.querySelectorAll<HTMLElement>("[id^='studio-heading-']")); const current = nodes.filter(node => node.getBoundingClientRect().top <= top + 90).at(-1) ?? nodes[0]; if (current) setActiveHeading(current.id); }} className="workspace-document min-h-0 flex-1 overflow-y-auto px-4 pb-16 sm:px-5 lg:px-[var(--studio-page-x)] lg:pt-8">
              {pageMode === "preview" && headings.length > 1 && <details className="workspace-outline" open><summary><List size={15} aria-hidden="true" /> 목차</summary><nav aria-label="문서 목차">{headings.map(h => <a key={h.id} aria-current={activeHeading === h.id ? "location" : undefined} onClick={() => setActiveHeading(h.id)} href={`#${h.id}`}>{h.text}</a>)}</nav></details>}
              {pageMode === "edit" && (
                <h2 className="mb-5 mt-0 max-w-[var(--studio-measure)] text-[1.75rem] font-semibold leading-8 tracking-[-0.03em]">
                  {pageDraft.title}
                </h2>
              )}
              <label className={`block max-w-[var(--studio-measure)] ${pageMode === "preview" ? "hidden" : ""}`}>
                <span className="sr-only">초안 마크다운</span>
                <textarea
                  placeholder="생각을 적거나 문단을 선택해 AI와 다듬어 보세요."
                  ref={editorRef}
                  value={pageDraft.body}
                  onChange={(event) => {
                    setMarkdown(applyDraftEditorInput(markdown, fallbackTitle, event.target.value));
                    setSaveState("idle");
                  }}
                  disabled={!canEdit || agentApplying}
                  spellCheck={false}
                  className="min-h-64 w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-7 text-(--text-primary) focus-visible:outline-none disabled:opacity-70 lg:min-h-[28rem]"
                />
              </label>
              <div className={`workspace-page-content max-w-[var(--studio-measure)] ${pageMode === "edit" ? "hidden" : ""}`}>
                <Preview replacing={layoutMode === "write" && !!review?.proposal?.target && review.proposal.target.start === selection?.start} markdown={markdown} revision={revision} selection={selection} onSelect={canEdit && !review?.busy ? target => { setSelection(target); setDecisionError(null); if (layoutMode !== "write") { setAiOpen(true); setTab("agent"); } } : undefined} inline={layoutMode === "write" ? <section className="workspace-inline" aria-label="본문에서 다듬기">
                  {review?.proposal?.target?.start === selection?.start && review?.proposal?.replacement && <div className="workspace-inline-proposal"><del>{review.proposal.target?.text}</del><p><mark>{review.proposal.replacement}</mark></p><div className="workspace-inline-actions"><button type="button" disabled={review.busy || dirty || approving} onClick={() => void agentControl.current?.apply()}>적용</button><button type="button" disabled={review.busy} onClick={() => agentControl.current?.cancel()}>취소</button></div></div>}
                  <form onSubmit={event => { event.preventDefault(); if (inlineMessage.trim() && !review?.busy) void agentControl.current?.send(inlineMessage); }}>
                    <label><span><MessageSquare size={14} aria-hidden="true" />이 문단을 바탕으로</span><textarea aria-label="문단 수정 요청" value={inlineMessage} onChange={event => setInlineMessage(event.target.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={500} placeholder="내가 이해한 말로 더 쉽게 다듬어줘" disabled={review?.busy} rows={1}/></label>
                    <button type="submit" aria-label="문단 요청 보내기" disabled={!inlineMessage.trim() || !review?.connected || review.busy}>{review?.busy ? <Loader2 size={18} className="animate-spin"/> : <CornerDownLeft size={20}/>}</button>
                  </form>
                  {!review?.connected && <button className="workspace-inline-connect" type="button" onClick={() => {setAiOpen(true);setTab("agent");}}>AI 연결 확인하기</button>}
                  {review?.error && <p role="status">{review.error}</p>}
                </section> : undefined} />
              </div>
              {review?.canUndo && layoutMode === "write" && <div className="workspace-inline-undo" role="status">문서에 반영했어요 <button type="button" disabled={review.busy || dirty || approving} onClick={() => void agentControl.current?.undo()}>되돌리기</button></div>}
              <details className="workspace-writing-tools"><summary>AI로 다듬기</summary><div className="mt-3 flex max-w-[var(--studio-measure)] flex-wrap gap-x-5 gap-y-1">
                {STUDIO_ASK_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => askFromPage(item.text)}
                    className="inline-flex min-h-11 items-center text-sm text-(--text-secondary) underline-offset-2 hover:text-(--text-primary) hover:underline"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              </details>
              <div className="lg:hidden">
                <NotebookLmOpen
                  sourceUrl={sourceUrl}
                  testId="studio-notebooklm-page-open"
                />
              </div>
            </div>
          </section>

          <button
            type="button"
            aria-label="채팅 칸 너비"
            onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); nudge("rail", event.key === "ArrowLeft" ? 20 : -20); } }}
            title="드래그해서 칸 너비. 더블클릭하면 원래대로."
            className="studio-gutter hidden lg:block"
            onPointerDown={(event) => startDrag("rail", event)}
            onDoubleClick={reset}
          />

          <KnowledgeStudioAgent
            controlRef={agentControl}
            onReviewChange={setReview}
            selection={selection}
            onClearSelection={() => setSelection(null)}
            mutationBlocked={dirty || saveState === "saving" || approving}
            onApplyingChange={setAgentApplying}
            onClose={() => { setAiOpen(false); setTab("page"); }}
            jobId={jobId}
            markdown={markdown}
            revision={revision}
            canEdit={canEdit}
            canAmend={payload.job.status === "completed"}
            sourceGuide={payload.sourceGuide ?? ""}
            evidenceLines={evidenceLines}
            paneWidth={widths.rail}
            askSeed={askSeed}
            onAskSeedConsumed={consumeAskSeed}
            className={`${tab === "agent" ? "flex" : "hidden"} min-h-0 flex-1 flex-col overflow-hidden lg:flex lg:shrink-0`}
            onDraftApplied={(draft) => {
              applyDraft(draft);
              setSaveState("saved");
              setSaveError(null);
            }}
            onDraftConflict={async () => {
              await load();
            }}
          />
        </div>
      )}
    </div>
  );
}
