"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Check, CircleAlert, Loader2, XCircle } from "lucide-react";
import {
  knowledgeCaptureAction,
  notifyKnowledgeJobsChanged,
  type KnowledgeJobSummary,
} from "@/lib/knowledge-capture";

type CaptureState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; job: KnowledgeJobSummary }
  | { kind: "error"; message: string; job?: KnowledgeJobSummary };

interface Props {
  videoUrl: string;
  title?: string;
  channelName?: string;
  compact?: boolean;
  className?: string;
  job?: KnowledgeJobSummary | null;
  onJobChange?: (job: KnowledgeJobSummary) => void;
}

export default function KnowledgeCaptureButton({
  videoUrl,
  title,
  channelName,
  compact = false,
  className = "",
  job = null,
  onJobChange,
}: Props) {
  const [state, setState] = useState<CaptureState>({ kind: "idle" });
  const currentJob = job ?? (state.kind === "done" || state.kind === "error" ? state.job ?? null : null);
  const action = knowledgeCaptureAction(currentJob);
  const isSubmitting = state.kind === "submitting";
  const iconSize = compact ? 16 : 17;
  const label = compact ? action.compactLabel : action.label;

  const capture = async () => {
    if (isSubmitting || action.kind === "busy" || action.kind === "open") return;
    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/knowledge/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: videoUrl,
          title,
          channelName,
          via: "focus-feed",
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { created?: boolean; job?: KnowledgeJobSummary; error?: string }
        | null;
      if (!response.ok) {
        if (data?.job) {
          onJobChange?.(data.job);
          notifyKnowledgeJobsChanged();
        }
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
      setState({ kind: "done", job: data.job });
      onJobChange?.(data.job);
      notifyKnowledgeJobsChanged();
    } catch {
      setState({ kind: "error", message: "연결 오류입니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  const statusIcon = isSubmitting || currentJob?.status === "processing" || currentJob?.status === "approving"
    ? <Loader2 size={iconSize} className="animate-spin" aria-hidden />
    : currentJob && !currentJob.captureReady
      ? <CircleAlert size={iconSize} aria-hidden />
    : currentJob?.status === "failed" || currentJob?.status === "cancelled"
      ? <XCircle size={iconSize} aria-hidden />
      : currentJob?.status === "review_required" || currentJob?.status === "action_required"
        ? <CircleAlert size={iconSize} aria-hidden />
        : currentJob
          ? <Check size={iconSize} aria-hidden />
          : <Brain size={iconSize} aria-hidden />;

  const controlClass = compact
    ? "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-(--border-subtle) px-3 text-xs font-semibold text-(--text-primary) hover:bg-(--surface-subtle) disabled:cursor-default disabled:opacity-70"
    : "inline-flex min-h-11 items-center gap-2 rounded-full border border-(--border-subtle) px-4 text-sm font-semibold text-(--text-primary) hover:bg-(--surface-subtle) disabled:cursor-default disabled:opacity-70";

  return (
    <span className={`inline-flex min-w-0 flex-col items-stretch gap-1 ${className}`}>
      {action.kind === "open" ? (
        <Link
          href={action.href}
          className={controlClass}
          aria-live="polite"
          onClick={(event) => event.stopPropagation()}
        >
          {statusIcon}
          {label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void capture();
          }}
          disabled={isSubmitting || action.kind === "busy"}
          className={controlClass}
          aria-live="polite"
        >
          {statusIcon}
          {isSubmitting ? (compact ? "담는 중" : "담는 중…") : label}
        </button>
      )}
      {state.kind === "error" && (
        <span role="status" className="max-w-xs text-xs leading-relaxed text-red-600 dark:text-red-400">
          {state.message}
        </span>
      )}
    </span>
  );
}
