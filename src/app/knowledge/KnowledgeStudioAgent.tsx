"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { replaceStudioParagraph, resolveStudioParagraphReply, type StudioParagraphSelection } from "@/lib/knowledge-studio";
import { CornerDownLeft, Loader2, Plus, X } from "lucide-react";
import KnowledgeReferencePicker from "./KnowledgeReferencePicker";
import { referenceDocumentUrl, referenceVersionKey, referenceVersionLabel, referenceVersionsMatch, type StudioReference, type StudioReferenceDocument } from "@/lib/knowledge-reference-context";
import { approvedKnowledgeRequestError, KnowledgeLoginRequiredError, knowledgeLoginUrl } from "@/lib/knowledge-recovery";
import {
  DEFAULT_KNOWLEDGE_AGENT_MODEL,
  KNOWLEDGE_AGENT_START_COMMAND,
  MAX_AGENT_PROMPT_CHARS,
  knowledgeAgentBaseUrl,
  knowledgeAgentModelLabel,
  knowledgeAgentModelOptions,
  knowledgeAgentWsUrl,
  parseKnowledgeAgentHealth,
  parseKnowledgeAgentSocketEvent,
  readKnowledgeAgentSse,
  resolveKnowledgeAgentModel,
  type KnowledgeAgentHealth,
  type KnowledgeAgentModelOption,
  type KnowledgeAgentProvider,
  type KnowledgeAgentSseEvent,
} from "@/lib/knowledge-agent-protocol";
import {
  buildStudioAgentPrompt,
  parseStudioChatMessage,
  resolveStudioChatDraft,
  summarizeStudioDraftChange,
  type KnowledgeStudioDraftView,
} from "@/lib/knowledge-studio";

type ThreadTurn = {
  role: "user" | "assistant";
  content: string;
  applied?: boolean;
  change?: string;
  references?: StudioReference[];
  approvedDocument?: StudioReference;
  failed?: boolean;
  amendmentMarkdown?: string;
};
type StudioAgentModels = Record<KnowledgeAgentProvider, string>;
export type StudioProposal = { before: string; after: string; revision: number; target?: StudioParagraphSelection; replacement?: string };
export type StudioReviewState = { proposal: StudioProposal | null; busy: boolean; connected: boolean; canUndo: boolean; error: string | null; status: string | null };
export type StudioAgentControl = { send: (message: string) => Promise<void>; apply: () => Promise<void>; undo: () => Promise<void>; cancel: () => void };
type StudioAskChip =
  | { label: string; text: string }
  | { label: string; local: "change" };

const MODEL_STORAGE_KEY = "ff_studio_agent_models";
const PROVIDER_STORAGE_KEY = "ff_studio_agent_provider";

function providerLabel(provider: KnowledgeAgentProvider): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "cursor") return "Cursor";
  return "Codex";
}

function defaultModels(): StudioAgentModels {
  return {
    claude: DEFAULT_KNOWLEDGE_AGENT_MODEL.claude,
    codex: DEFAULT_KNOWLEDGE_AGENT_MODEL.codex,
    cursor: DEFAULT_KNOWLEDGE_AGENT_MODEL.cursor,
  };
}

function readStoredModels(): StudioAgentModels {
  const fallback = defaultModels();
  try {
    const raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { claude?: unknown; codex?: unknown; cursor?: unknown };
    return {
      claude: resolveKnowledgeAgentModel("claude", parsed.claude) ?? fallback.claude,
      codex: resolveKnowledgeAgentModel("codex", parsed.codex) ?? fallback.codex,
      cursor: resolveKnowledgeAgentModel("cursor", parsed.cursor) ?? fallback.cursor,
    };
  } catch {
    return fallback;
  }
}

function writeStoredModels(models: StudioAgentModels) {
  window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(models));
}

function catalogFor(
  provider: KnowledgeAgentProvider,
  health: KnowledgeAgentHealth | null,
): KnowledgeAgentModelOption[] {
  return health?.models?.[provider] ?? knowledgeAgentModelOptions(provider);
}

function selectedModel(
  provider: KnowledgeAgentProvider,
  models: StudioAgentModels,
  health: KnowledgeAgentHealth | null,
): string {
  const options = catalogFor(provider, health);
  if (options.some((item) => item.id === models[provider])) return models[provider];
  return health?.defaults?.[provider] ?? DEFAULT_KNOWLEDGE_AGENT_MODEL[provider];
}

// Brand assets: Lobe Icons (https://github.com/lobehub/lobe-icons), see docs/screenshots/brand-assets-license.txt.
const PROVIDER_ICONS: Record<string,string> = {"openai": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSJjdXJyZW50Q29sb3IiIGZpbGwtcnVsZT0iZXZlbm9kZCIgaGVpZ2h0PSIxZW0iIHN0eWxlPSJmbGV4Om5vbmU7bGluZS1oZWlnaHQ6MSIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMWVtIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0aXRsZT5PcGVuQUk8L3RpdGxlPjxwYXRoIGQ9Ik05LjIwNSA4LjY1OHYtMi4yNmMwLS4xOS4wNzItLjMzMy4yMzgtLjQyOGw0LjU0My0yLjYxNmMuNjE5LS4zNTcgMS4zNTYtLjUyMyAyLjExNy0uNTIzIDIuODU0IDAgNC42NjIgMi4yMTIgNC42NjIgNC41NjYgMCAuMTY3IDAgLjM1Ny0uMDI0LjU0N2wtNC43MS0yLjc1OWEuNzk3Ljc5NyAwIDAwLS44NTYgMGwtNS45NyAzLjQ3M3ptMTAuNjA5IDguOFYxMi4wNmMwLS4zMzMtLjE0My0uNTctLjQyOS0uNzM3bC01Ljk3LTMuNDczIDEuOTUtMS4xMThhLjQzMy40MzMgMCAwMS40NzYgMGw0LjU0MyAyLjYxN2MxLjMwOS43NiAyLjE4OSAyLjM3OCAyLjE4OSAzLjk0OCAwIDEuODA4LTEuMDcgMy40NzMtMi43NiA0LjE2M3pNNy44MDIgMTIuNzAzbC0xLjk1LTEuMTQyYy0uMTY3LS4wOTUtLjIzOS0uMjM4LS4yMzktLjQyOFY1Ljg5OWMwLTIuNTQ1IDEuOTUtNC40NzIgNC41OTEtNC40NzIgMSAwIDEuOTI3LjMzMyAyLjcxMi45MjhMOC4yMyA1LjA2N2MtLjI4NS4xNjYtLjQyOC40MDQtLjQyOC43Mzd2Ni44OTh6TTEyIDE1LjEyOGwtMi43OTUtMS41N3YtMy4zM0wxMiA4LjY1OGwyLjc5NSAxLjU3djMuMzNMMTIgMTUuMTI4em0xLjc5NiA3LjIzYy0xIDAtMS45MjctLjMzMi0yLjcxMi0uOTI3bDQuNjg2LTIuNzEyYy4yODUtLjE2Ni40MjgtLjQwNC40MjgtLjczN3YtNi44OThsMS45NzQgMS4xNDJjLjE2Ny4wOTUuMjM4LjIzOC4yMzguNDI4djUuMjMzYzAgMi41NDUtMS45NzQgNC40NzItNC42MTQgNC40NzJ6bS01LjYzNy01LjMwM2wtNC41NDQtMi42MTdjLTEuMzA4LS43NjEtMi4xODgtMi4zNzgtMi4xODgtMy45NDhBNC40ODIgNC40ODIgMCAwMTQuMjEgNi4zMjd2NS40MjNjMCAuMzMzLjE0My41NzEuNDI4LjczOGw1Ljk0NyAzLjQ0OS0xLjk1IDEuMTE4YS40MzIuNDMyIDAgMDEtLjQ3NiAwem0tLjI2MiAzLjljLTIuNjg4IDAtNC42NjItMi4wMjEtNC42NjItNC41MTkgMC0uMTkuMDI0LS4zOC4wNDctLjU3bDQuNjg2IDIuNzFjLjI4Ni4xNjcuNTcxLjE2Ny44NTYgMGw1Ljk3LTMuNDQ4djIuMjZjMCAuMTktLjA3LjMzMy0uMjM3LjQyOGwtNC41NDMgMi42MTZjLS42MTkuMzU3LTEuMzU2LjUyMy0yLjExNy41MjN6bTUuODk5IDIuODNhNS45NDcgNS45NDcgMCAwMDUuODI3LTQuNzU2QzIyLjI4NyAxOC4zMzkgMjQgMTUuODQgMjQgMTMuMjk2YzAtMS42NjUtLjcxMy0zLjI4Mi0xLjk5OC00LjQ0OC4xMTktLjUuMTktLjk5OS4xOS0xLjQ5OCAwLTMuNDAxLTIuNzU5LTUuOTQ3LTUuOTQ2LTUuOTQ3LS42NDIgMC0xLjI2LjA5NS0xLjg4LjMxQTUuOTYyIDUuOTYyIDAgMDAxMC4yMDUgMGE1Ljk0NyA1Ljk0NyAwIDAwLTUuODI3IDQuNzU3QzEuNzEzIDUuNDQ3IDAgNy45NDUgMCAxMC40OWMwIDEuNjY2LjcxMyAzLjI4MyAxLjk5OCA0LjQ0OC0uMTE5LjUtLjE5IDEtLjE5IDEuNDk5IDAgMy40MDEgMi43NTkgNS45NDYgNS45NDYgNS45NDYuNjQyIDAgMS4yNi0uMDk1IDEuODgtLjMwOWE1Ljk2IDUuOTYgMCAwMDQuMTYyIDEuNzEzeiI+PC9wYXRoPjwvc3ZnPg==", "claude": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSJjdXJyZW50Q29sb3IiIGZpbGwtcnVsZT0iZXZlbm9kZCIgaGVpZ2h0PSIxZW0iIHN0eWxlPSJmbGV4Om5vbmU7bGluZS1oZWlnaHQ6MSIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMWVtIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0aXRsZT5DbGF1ZGU8L3RpdGxlPjxwYXRoIGQ9Ik00LjcwOSAxNS45NTVsNC43Mi0yLjY0Ny4wOC0uMjMtLjA4LS4xMjhIOS4ybC0uNzktLjA0OC0yLjY5OC0uMDczLTIuMzM5LS4wOTctMi4yNjYtLjEyMi0uNTcxLS4xMjFMMCAxMS43ODRsLjA1NS0uMzUyLjQ4LS4zMjEuNjg2LjA2IDEuNTIuMTAzIDIuMjc4LjE1OCAxLjY1Mi4wOTcgMi40NDkuMjU1aC4zODlsLjA1NS0uMTU3LS4xMzQtLjA5OC0uMTAzLS4wOTctMi4zNTgtMS41OTYtMi41NTItMS42ODgtMS4zMzYtLjk3Mi0uNzI0LS40OTEtLjM2NC0uNDYyLS4xNTgtMS4wMDguNjU2LS43MjIuODgxLjA2LjIyNS4wNjEuODkzLjY4NiAxLjkwOCAxLjQ3NiAyLjQ5MSAxLjgzMy4zNjUuMzA0LjE0NS0uMTAzLjAxOS0uMDczLS4xNjQtLjI3NC0xLjM1NS0yLjQ0Ni0xLjQ0Ni0yLjQ5LS42NDQtMS4wMzItLjE3LS42MTlhMi45NyAyLjk3IDAgMDEtLjEwNC0uNzI5TDYuMjgzLjEzNCA2LjY5NiAwbC45OTYuMTM0LjQyLjM2NC42MiAxLjQxNCAxLjAwMiAyLjIyOSAxLjU1NSAzLjAzLjQ1Ni44OTguMjQzLjgzMi4wOTEuMjU1aC4xNThWOS4wMWwuMTI4LTEuNzA2LjIzNy0yLjA5NS4yMy0yLjY5NS4wOC0uNzYuMzc2LS45MS43NDctLjQ5Mi41ODQuMjguNDguNjg1LS4wNjcuNDQ0LS4yODYgMS44NTEtLjU1OSAyLjkwMy0uMzY0IDEuOTQyaC4yMTJsLjI0My0uMjQyLjk4NS0xLjMwNiAxLjY1Mi0yLjA2NC43My0uODIuODUtLjkwNC41NDctLjQzMWgxLjAzM2wuNzYgMS4xMjktLjM0IDEuMTY2LTEuMDY0IDEuMzQ3LS44ODEgMS4xNDItMS4yNjQgMS43LS43OSAxLjM2LjA3My4xMS4xODgtLjAyIDIuODU2LS42MDYgMS41NDMtLjI4IDEuODQxLS4zMTUuODMzLjM4OC4wOTEuMzk1LS4zMjguODA3LTEuOTY5LjQ4Ni0yLjMwOS40NjItMy40MzkuODEzLS4wNDIuMDMuMDQ5LjA2MSAxLjU0OS4xNDYuNjYyLjAzNmgxLjYyMmwzLjAyLjIyNS43OS41MjIuNDc0LjYzOC0uMDc5LjQ4NS0xLjIxNS42Mi0xLjY0LS4zODktMy44MjktLjkxLTEuMzEyLS4zMjloLS4xODJ2LjExbDEuMDkzIDEuMDY4IDIuMDA2IDEuODEgMi41MDkgMi4zMy4xMjcuNTc4LS4zMjIuNDU1LS4zNC0uMDQ5LTIuMjA1LTEuNjU3LS44NTEtLjc0Ny0xLjkyNi0xLjYyaC0uMTI4di4xN2wuNDQ0LjY0OSAyLjM0NSAzLjUyMS4xMjIgMS4wOC0uMTcuMzUzLS42MDguMjEzLS42NjgtLjEyMi0xLjM3NC0xLjkyNS0xLjQxNS0yLjE2Ny0xLjE0My0xLjk0My0uMTQuMDgtLjY3NCA3LjI1NC0uMzE2LjM3LS43MjkuMjgtLjYwNy0uNDYxLS4zMjItLjc0Ny4zMjItMS40NzYuMzg5LTEuOTI0LjMxNS0xLjUzLjI4Ni0xLjkuMTctLjYzMi0uMDEyLS4wNDItLjE0LjAxOC0xLjQzNCAxLjk2Ny0yLjE4IDIuOTQ1LTEuNzI2IDEuODQ1LS40MTQuMTY0LS43MTctLjM3LjA2Ny0uNjYyLjQwMS0uNTg5IDIuMzg4LTMuMDM2IDEuNDQtMS44ODIuOTMtMS4wODYtLjAwNi0uMTU4aC0uMDU1TDQuMTMyIDE4LjU2bC0xLjEzLjE0Ni0uNDg3LS40NTYuMDYxLS43NDYuMjMxLS4yNDMgMS45MDgtMS4zMTItLjAwNi4wMDZ6Ij48L3BhdGg+PC9zdmc+", "cursor": "data:image/svg+xml;base64,PHN2ZyBmaWxsPSJjdXJyZW50Q29sb3IiIGZpbGwtcnVsZT0iZXZlbm9kZCIgaGVpZ2h0PSIxZW0iIHN0eWxlPSJmbGV4Om5vbmU7bGluZS1oZWlnaHQ6MSIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMWVtIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0aXRsZT5DdXJzb3I8L3RpdGxlPjxwYXRoIGQ9Ik0yMi4xMDYgNS42OEwxMi41LjEzNWEuOTk4Ljk5OCAwIDAwLS45OTggMEwxLjg5MyA1LjY4YS44NC44NCAwIDAwLS40MTkuNzI2djExLjE4NmMwIC4zLjE2LjU3Ny40Mi43MjdsOS42MDcgNS41NDdhLjk5OS45OTkgMCAwMC45OTggMGw5LjYwOC01LjU0N2EuODQuODQgMCAwMC40Mi0uNzI3VjYuNDA3YS44NC44NCAwIDAwLS40Mi0uNzI2em0tLjYwMyAxLjE3NkwxMi4yMjggMjIuOTJjLS4wNjMuMTA4LS4yMjguMDY0LS4yMjgtLjA2MVYxMi4zNGEuNTkuNTkgMCAwMC0uMjk1LS41MWwtOS4xMS01LjI2Yy0uMTA3LS4wNjItLjA2My0uMjI4LjA2Mi0uMjI4aDE4LjU1Yy4yNjQgMCAuNDI4LjI4Ni4yOTYuNTE0eiI+PC9wYXRoPjwvc3ZnPg=="};

export const STUDIO_ASK_PROMPTS = [
  { label: "초안을 짧게", text: "초안을 짧게 해줘. 감상은 빼고 주장과 근거만 남겨." },
  { label: "근거에 타임스탬프", text: "근거마다 타임스탬프를 붙여줘." },
  { label: "제목만 다시", text: "제목만 영상 내용에 맞게 다시 써줘." },
  { label: "반례 찾아", text: "초안은 고치지 마. 약한 주장의 반례만 채팅으로 답해." },
  { label: "한 줄로", text: "초안은 고치지 마. 핵심을 한 줄로만 말해." },
] as const;

const STUDIO_CHAT_CHIPS: StudioAskChip[] = [
  ...STUDIO_ASK_PROMPTS,
  { label: "뭐가 바뀌었는지", local: "change" },
];

export default function KnowledgeStudioAgent({
  controlRef,
  onReviewChange,
  onClose,
  selection,
  onClearSelection,
  mutationBlocked = false,
  onApplyingChange,
  jobId,
  markdown,
  revision,
  canEdit,
  canAmend = false,
  sourceGuide,
  evidenceLines,
  className,
  paneWidth,
  askSeed,
  onAskSeedConsumed,
  onDraftApplied,
  onDraftConflict,
}: {
  controlRef?: Ref<StudioAgentControl>;
  onReviewChange?: (review: StudioReviewState) => void;
  onClose?: () => void;
  selection?: StudioParagraphSelection | null;
  onClearSelection?: () => void;
  mutationBlocked?: boolean;
  onApplyingChange?: (value: boolean) => void;
  jobId: string;
  markdown: string;
  revision: number;
  canEdit: boolean;
  canAmend?: boolean;
  sourceGuide: string;
  evidenceLines: string[];
  className: string;
  paneWidth?: number;
  askSeed?: string | null;
  onAskSeedConsumed?: () => void;
  onDraftApplied: (draft: KnowledgeStudioDraftView) => void;
  onDraftConflict: () => Promise<void>;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<KnowledgeAgentProvider>("claude");
  const [models, setModels] = useState<StudioAgentModels>(defaultModels);
  const [health, setHealth] = useState<KnowledgeAgentHealth | null>(null);
  const [healthState, setHealthState] = useState<"checking" | "up" | "down">("checking");
  const [message, setMessage] = useState("");
  const [thread, setThread] = useState<ThreadTurn[]>([]);
  const [references, setReferences] = useState<StudioReference[]>([]);
  const contextStart = useRef(0);
  const conversationKey = useRef("");
  const approvedVersion = useRef("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [proposal, setProposal] = useState<StudioProposal | null>(null);
  const [undoDraft, setUndoDraft] = useState<{ before: string; after: string; revision: number } | null>(null);
  const [applying, setApplying] = useState(false);
  const operation = useRef<"send" | "apply" | null>(null);
  const liveDraft = useRef({ markdown, revision });
  liveDraft.current = { markdown, revision };
  const applyProposal = async (undo = false) => {
    const candidate = undo ? undoDraft : proposal;
    if (!candidate || !canEdit || applying || sending || mutationBlocked || operation.current) return;
    const expected = undo ? candidate.after : candidate.before;
    if (liveDraft.current.markdown !== expected || liveDraft.current.revision !== candidate.revision) {
      setError("문서가 바뀌어 이 수정안을 적용할 수 없어요. 현재 문서로 다시 요청해 주세요.");
      return;
    }
    operation.current = "apply";
    setApplying(true); onApplyingChange?.(true); setError(null);
    try {
      const next = undo ? candidate.before : candidate.after;
      const response = await fetch(`/api/knowledge/jobs/${encodeURIComponent(jobId)}/studio`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: next, expectedRevision: candidate.revision }),
      });
      const data = await response.json();
      if (response.status === 409) { setProposal(null); setUndoDraft(null); await onDraftConflict(); throw new Error("다른 곳에서 문서가 바뀌었어요. 다시 비교해 주세요."); }
      if (!response.ok || !data.studioDraft) throw new Error(data.error ?? "수정안을 저장하지 못했어요.");
      // Do not replace new local typing that happened while the request was in flight.
      if (liveDraft.current.markdown !== expected || liveDraft.current.revision !== candidate.revision) {
        setProposal(null); setUndoDraft(null);
        throw new Error("저장하는 동안 문서가 바뀌었어요. 현재 편집을 보존했습니다. 저장 상태를 확인해 주세요.");
      }
      onDraftApplied(data.studioDraft);
      onClearSelection?.();
      setLastChange(summarizeStudioDraftChange(candidate.before, next));
      setUndoDraft(undo ? null : { ...candidate, revision: data.studioDraft.revision });
      setProposal(null); setStatus(undo ? "반영 전 문서로 되돌렸어요" : "문서에 반영했어요");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "반영하지 못했어요"); }
    finally { operation.current = null; setApplying(false); onApplyingChange?.(false); }
  };
  const sessions = useRef<Record<string, string>>({});
  const model = selectedModel(provider, models, health);
  const modelOptions = catalogFor(provider, health);
  const socketRef = useRef<WebSocket | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const connected = healthState === "up" && health?.providers[provider] === true;
  useEffect(() => {
    onReviewChange?.({ proposal, busy: sending || applying, connected, canUndo: !!undoDraft, error, status });
  }, [proposal, sending, applying, connected, undoDraft, error, status, onReviewChange]);

  const refreshHealth = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${knowledgeAgentBaseUrl()}/health`, {
        cache: "no-store",
        signal,
      });
      const data = parseKnowledgeAgentHealth(await response.json().catch(() => null));
      if (!response.ok || !data) throw new Error("down");
      setHealth(data);
      setHealthState("up");
    } catch {
      if (signal?.aborted) return;
      setHealth(null);
      setHealthState("down");
    }
  }, []);

  useEffect(() => {
    setModels(readStoredModels());
    try {
      const saved = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
      if (saved === "claude" || saved === "cursor" || saved === "codex") setProvider(saved);
    } catch {
      // 저장소 접근이 제한되어도 현재 세션의 선택은 사용할 수 있다.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshHealth(controller.signal);
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, healthState === "up" ? 20_000 : 4_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [healthState, refreshHealth]);

  useEffect(() => {
    if (healthState !== "up") {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }
    const socket = new WebSocket(knowledgeAgentWsUrl());
    socketRef.current = socket;
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [healthState]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [thread, sending, status]);

  useEffect(() => {
    if (!askSeed) return;
    setMessage(askSeed);
    onAskSeedConsumed?.();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [askSeed, onAskSeedConsumed]);

  const statusText = healthState === "checking"
    ? "이 PC 에이전트를 확인하는 중"
    : healthState === "down"
      ? `이 PC에서 ${KNOWLEDGE_AGENT_START_COMMAND} 를 켜세요.`
      : health?.providers[provider]
        ? `${providerLabel(provider)} · ${knowledgeAgentModelLabel(provider, model, modelOptions)} 실행 도구 확인됨`
        : `이 PC에 ${providerLabel(provider)}가 없어요. 구독 로그인 후 CLI를 설치하세요.`;

  const send = useCallback(async (override?: string) => {
    const nextMessage = parseStudioChatMessage(override ?? message);
    if (!nextMessage || sending || applying || operation.current) return;
    if (!connected) {
      setError(statusText);
      return;
    }

    operation.current = "send";
    setSending(true);
    setError(null);
    setLoginRequired(false);
    setStatus(references.length || canAmend ? "문서의 승인 버전을 확인하는 중" : `${providerLabel(provider)} 작성 중`);

    const target = selection;
    if (target && replaceStudioParagraph(markdown, revision, target, target.text) === undefined) {
      setError("선택 후 문서가 바뀌었어요. 문단을 다시 선택해 주세요.");
      operation.current = null;
      setSending(false);
      return;
    }
    const appliedDraft = false;
    let appended = false;
    try {
      async function loadApproved(ids: string[]): Promise<StudioReferenceDocument[]> {
        if (!ids.length) return [];
        const response = await fetch(`/api/knowledge/approved?ids=${ids.map(encodeURIComponent).join(",")}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
        const data = await response.json();
        if (!response.ok) throw approvedKnowledgeRequestError(response.status, data.error);
        if (!Array.isArray(data.sources) || data.sources.length !== ids.length || !ids.every((id) => data.sources.some((source: StudioReferenceDocument) => source.id === id && typeof source.markdown === "string"))) throw new Error("승인 문서를 확인하지 못했어요.");
        return data.sources;
      }
      const [documents, currentDocuments] = await Promise.all([
        loadApproved(references.map((source) => source.id)),
        loadApproved(canAmend && !canEdit ? [jobId] : []),
      ]);
      if (!referenceVersionsMatch(references, documents)) throw new Error("첨부 자료의 승인 버전이 달라졌어요. 자료를 다시 검색해 선택해 주세요.");
      const approvedDocument = currentDocuments[0];
      if (approvedDocument) {
        const versionKey = referenceVersionKey(approvedDocument);
        if (approvedVersion.current && approvedVersion.current !== versionKey) {
          contextStart.current = thread.length;
          conversationKey.current = "";
          sessions.current = {};
        }
        approvedVersion.current = versionKey;
      }
      const prompt = buildStudioAgentPrompt({
        scope: target ? "paragraph" : "document",
        markdown: target?.text ?? approvedDocument?.markdown ?? markdown,
        message: target ? `${nextMessage}\n편집 대상은 위의 선택 문단 하나뿐이다. 수정한다면 변경 이유 한 줄과 대체 문단을 markdown 펜스 하나로 반환한다. 제목이나 다른 문단을 추가하지 않는다.` : nextMessage,
        sourceGuide, evidenceLines,
        history: thread.slice(contextStart.current).filter((turn) => !turn.failed).slice(-6), references: documents,
        currentDocument: { id: jobId, revision },
        approvedDocument,
      });
      if (prompt.length > MAX_AGENT_PROMPT_CHARS) throw new Error("자료가 너무 길어요. 첨부 자료 수를 줄여 주세요.");
      setStatus(`${providerLabel(provider)} 작성 중`);
      setMessage("");
      setThread((current) => [...current, { role: "user", content: nextMessage }, { role: "assistant", content: "", references, approvedDocument }]);
      appended = true;
      if (!conversationKey.current) conversationKey.current = crypto.randomUUID();
      let assembled = "";
      const onEvent = (event: KnowledgeAgentSseEvent) => {
        if (event.type === "status") {
          setStatus(event.text);
          return;
        }
        if (event.type === "delta") {
          assembled += event.text;
          setThread((current) => {
            if (current.length === 0) return current;
            const next = current.slice();
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") return current;
            next[next.length - 1] = { ...last, role: "assistant", content: assembled };
            return next;
          });
          return;
        }
        if (event.type === "done") {
          assembled = event.text || assembled;
          if (event.sessionId) sessions.current[`${provider}:${model}`] = event.sessionId;
          setThread((current) => {
            if (current.length === 0) return current;
            const next = current.slice();
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") return current;
            next[next.length - 1] = { ...last, role: "assistant", content: assembled };
            return next;
          });
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
      };

      const payload = {
        type: "chat" as const,
        provider,
        jobId: conversationKey.current,
        prompt,
        model,
        sessionId: sessions.current[`${provider}:${model}`],
      };
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            socket.removeEventListener("message", onMessage);
            socket.removeEventListener("close", onClose);
          };
          const onMessage = (event: MessageEvent) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(String(event.data));
            } catch {
              return;
            }
            const agentEvent = parseKnowledgeAgentSocketEvent(parsed);
            if (!agentEvent) return;
            try {
              onEvent(agentEvent);
              if (agentEvent.type === "done") {
                cleanup();
                resolve();
              }
            } catch (cause) {
              cleanup();
              reject(cause);
            }
          };
          const onClose = () => {
            cleanup();
            reject(new Error("사이드카 소켓이 끊겼어요."));
          };
          socket.addEventListener("message", onMessage);
          socket.addEventListener("close", onClose);
          socket.send(JSON.stringify(payload));
        });
      } else {
        const response = await fetch(`${knowledgeAgentBaseUrl()}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(data?.error ?? "사이드카가 거절했어요.");
        }
        await readKnowledgeAgentSse(response, onEvent);
      }

      const replacement = target ? resolveStudioParagraphReply(nextMessage, assembled) : undefined;
      const nextMarkdown = target ? (replacement ? replaceStudioParagraph(markdown, revision, target, replacement) : undefined) : resolveStudioChatDraft(nextMessage, assembled);
      if (nextMarkdown && canAmend && !canEdit) {
        setThread((current) => current.map((turn, index) => index === current.length - 1 ? { ...turn, amendmentMarkdown: nextMarkdown } : turn));
      }
      if (nextMarkdown && canEdit) {
        setProposal({ before: markdown, after: nextMarkdown, revision, target: target ?? undefined, replacement });
        setUndoDraft(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "에이전트가 실패했어요.");
      setLoginRequired(cause instanceof KnowledgeLoginRequiredError);
      setThread((current) => {
        if (!appended) return current;
        const marked = current.map((turn, index) => index >= thread.length ? { ...turn, failed: true } : turn);
        if (marked.length === 0) return marked;
        const last = marked[marked.length - 1];
        if (last?.role === "assistant" && !last.content.trim()) {
          return marked.slice(0, -1);
        }
        return marked;
      });
    } finally {
      operation.current = null;
      setSending(false);
      if (!appliedDraft) setStatus(null);
      inputRef.current?.focus();
    }
  }, [
    applying,
    canEdit,
    selection,
    canAmend,
    connected,
    evidenceLines,
    jobId,
    markdown,
    message,
    model,
    provider,
    revision,
    references,
    sending,
    sourceGuide,
    statusText,
    thread,
  ]);

  const canSend = Boolean(parseStudioChatMessage(message)) && !sending && !applying && connected;
  useImperativeHandle(controlRef, () => ({ send, apply: () => applyProposal(), undo: () => applyProposal(true), cancel: () => setProposal(null) }));

  return (
    <section
      aria-label="에이전트"
      data-testid="studio-agent-panel"
      style={paneWidth ? { ["--studio-rail-now" as string]: `${paneWidth}px` } : undefined}
      className={`${className} studio-rail`}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-studio-pane">
        <div className="workspace-agent-heading flex shrink-0 items-center gap-2 px-3 py-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-(--playback-accent)" : "bg-(--text-secondary)"}`}
          />
              <Image unoptimized referrerPolicy="no-referrer" src={PROVIDER_ICONS[provider === "codex" ? "openai" : provider]} width={30} height={30} alt="" className="workspace-provider-icon" />
              <div className="workspace-models">
                <label className="shrink-0">
                  <span className="sr-only">에이전트</span>
                  <select
                    aria-label="에이전트"
                    value={provider}
                    disabled={sending || applying}
                    onChange={(event) => {
                      const nextProvider = event.target.value;
                      if (nextProvider === "claude" || nextProvider === "cursor" || nextProvider === "codex") {
                        setProvider(nextProvider);
                        try {
                          window.localStorage.setItem(PROVIDER_STORAGE_KEY, nextProvider);
                        } catch {
                          // 저장 실패가 에이전트 선택을 막지 않게 한다.
                        }
                      }
                    }}
                    className="max-w-[7.5rem] truncate border-0 bg-transparent text-sm text-(--text-secondary) focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <option value="claude">Claude Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="codex">Codex</option>
                  </select>
                </label>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">모델</span>
                  <select
                    aria-label="모델"
                    data-testid="studio-agent-model"
                    value={modelOptions.some((item) => item.id === model) ? model : (modelOptions[0]?.id ?? model)}
                    disabled={sending || applying}
                    onChange={(event) => {
                      const nextModel = resolveKnowledgeAgentModel(provider, event.target.value);
                      if (!nextModel) return;
                      const next = { ...models, [provider]: nextModel };
                      setModels(next);
                      writeStoredModels(next);
                    }}
                    className="w-full truncate border-0 bg-transparent text-sm text-(--text-secondary) focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {modelOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
              </div>
          <span className="sr-only">함께 다듬기</span>
          {onClose && <button type="button" className="workspace-close" aria-label="AI 닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>}
          <p data-testid="studio-agent-status" className="sr-only">{statusText}</p>
          <button
            type="button"
            aria-label="새 대화"
            disabled={sending || applying}
            onClick={() => {
              setProposal(null); setUndoDraft(null);
              setThread([]);
              setReferences([]);
              contextStart.current = 0;
              conversationKey.current = "";
              approvedVersion.current = "";
              sessions.current = {};
              setError(null);
              setStatus(null);
              inputRef.current?.focus();
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-(--text-secondary) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        {!connected && <p className="workspace-model-note">모델 목록 · 연결 확인 전</p>}
        {connected && <p className="workspace-model-note">로그인과 모델 사용 가능 여부는 요청할 때 확인해요.</p>}
        {canAmend && !canEdit && <p className="px-3 pb-2 text-xs text-(--text-secondary)">질문할 때 승인 버전을 다시 확인해요. Brain이 연결되어 있으면 최신 승인 수정안을 사용하며, 답변 아래에 기준 버전을 표시해요.</p>}

        <div className="workspace-conversation min-h-0 flex-1 overflow-y-auto px-3 py-2"><h2>{selection ? "문단 다듬기" : "함께 다듬기"}</h2>
          {selection && <details className="workspace-selection-context"><summary>선택한 문단</summary><blockquote>{selection.text}</blockquote><button type="button" disabled={sending || applying} onClick={onClearSelection}>전체 문서로 질문하기</button></details>}
          {thread.length === 0 && !connected && (
            <div className="px-1 text-sm leading-6 text-(--text-secondary)">
              <p>AI 연결을 기다리고 있어요. 문서는 계속 읽을 수 있습니다.</p>
              <details className="mt-2">
                <summary className="cursor-pointer">연결 방법</summary>
                <p className="mt-2 break-words">{statusText}</p>
              </details>
            </div>
          )}
          {thread.length > 0 && (
            <div className="space-y-3 py-1">
              {thread.map((turn, index) => (
                <div key={`${turn.role}-${index}`}>
                  {turn.role === "user" ? (
                    <p className="workspace-user-message ml-6 rounded-lg px-3 py-2 text-sm leading-6">
                      {turn.content}
                      {turn.failed && <span className="mt-1 block text-xs text-(--text-secondary)">처리 실패 · 다음 질문의 맥락에서 제외</span>}
                    </p>
                  ) : (
                    <div>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {(proposal && index === thread.length - 1 ? turn.content.replace(/```(?:markdown|md)\s*\n[\s\S]*?```/gi, "").trim() : turn.content) || (sending ? "작성 중…" : "수정안을 준비했어요.")}
                      </p>
                      {turn.approvedDocument && <p className="mt-2 text-xs text-(--text-secondary)">이 답변의 기준: <a className="underline" href={referenceDocumentUrl(turn.approvedDocument)} target="_blank" rel="noreferrer">{referenceVersionLabel(turn.approvedDocument)}</a></p>}
                      {turn.references && turn.references.length > 0 && <div className="mt-2 text-xs text-(--text-secondary)">
                        <p>전달한 승인 자료 · 긴 문서는 앞부분 최대 6,000자</p>
                        {turn.references.map((source) => <a key={source.id} className="block underline" href={referenceDocumentUrl(source)} target="_blank" rel="noreferrer">{source.title} · {referenceVersionLabel(source)}</a>)}
                      </div>}
                      {turn.amendmentMarkdown && <button type="button" disabled={sending || applying} className="mt-2 min-h-11 rounded border px-3 text-sm" onClick={() => {
                        try {
                          sessionStorage.setItem(`ff_amendment_seed:${jobId}`, JSON.stringify({ jobId, markdown: turn.amendmentMarkdown }));
                          router.push(`/knowledge/amendments/${encodeURIComponent(jobId)}`);
                        } catch { setError("수정안을 넘기지 못했어요. 답변 내용을 복사해 수정안 화면에 붙여 넣어 주세요."); }
                      }}>수정안으로 검토</button>}
                      {turn.applied && (
                        <p className="mt-1 text-xs text-(--text-secondary)">
                          {turn.change ? `초안에 넣음 · ${turn.change}` : "초안에 넣음"}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {proposal && mutationBlocked && <p role="status">현재 문서를 저장한 뒤 수정안을 반영할 수 있어요.</p>}
          {proposal && <section className="workspace-proposal" aria-label="수정안 검토">
            <p>{proposal.target ? "선택한 문단을 바꿉니다" : "전체 문서 수정안"}</p>
            <blockquote className="workspace-replacement">{proposal.replacement ?? proposal.after}</blockquote>
            <details><summary>변경 비교</summary><div className="workspace-diff"><div><strong>수정 전</strong><pre>{proposal.target?.text ?? proposal.before}</pre></div><div><strong>수정 후</strong><pre>{proposal.replacement ?? proposal.after}</pre></div></div></details>
            <div className="workspace-proposal-actions"><button type="button" disabled={applying || sending || !canEdit || mutationBlocked} onClick={() => void applyProposal()}>{proposal.target ? "이 문단 바꾸기" : "문서에 반영"}</button><button type="button" disabled={applying} onClick={() => setProposal(null)}>취소</button></div>
          </section>}
          {undoDraft && <button type="button" className="workspace-undo" disabled={applying || sending || mutationBlocked} onClick={() => void applyProposal(true)}>반영 되돌리기</button>}
          <div ref={threadEnd} />
        </div>

        {status && (
          <p role="status" className="px-3 text-xs text-(--text-secondary)">{status}</p>
        )}
        {error && (
          <p role="status" className="px-3 text-xs text-red-700 dark:text-red-300">{error}</p>
        )}
        {loginRequired && <a className="px-3 py-2 text-sm underline" href={knowledgeLoginUrl(jobId)} target="_blank" rel="noopener noreferrer">새 탭에서 로그인</a>}

        <div className="workspace-attachments"><KnowledgeReferencePicker jobId={jobId} selected={references} disabled={sending || applying} onChange={(sources) => {
          setReferences(sources);
          contextStart.current = thread.length;
          conversationKey.current = "";
          sessions.current = {};
        }} /></div>

        <details className="workspace-prompt-tools"><summary>빠른 요청</summary><div className="flex max-h-28 shrink-0 flex-wrap gap-2 overflow-y-auto px-3 pb-2">
          {STUDIO_CHAT_CHIPS.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={sending || applying}
              onClick={() => {
                if ("local" in item && item.local === "change") {
                  setThread((current) => [
                    ...current,
                    {
                      role: "assistant",
                      content: lastChange ?? "아직 이 대화에서 초안을 바꾼 적이 없어요.",
                    },
                  ]);
                  return;
                }
                if ("text" in item) {
                  setMessage(item.text);
                  inputRef.current?.focus();
                }
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-(--border-subtle) bg-(--surface-raised) px-3 text-sm text-(--text-secondary) hover:text-(--text-primary)"
            >
              {item.label}
            </button>
          ))}
        </div>

        </details>
        <div className="workspace-composer shrink-0 px-3 pb-3">
          <div className="rounded-[var(--studio-composer-radius)] border border-(--border-subtle) bg-(--surface-raised) px-3 py-2 focus-within:outline-2 focus-within:outline-offset-2">
            <label className="block min-w-0">
              <span className="sr-only">채팅 메시지</span>
              <textarea
                ref={inputRef}
                value={message}
                onChange={(event) => { setMessage(event.target.value); event.target.style.height = "24px"; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`; }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={sending || applying}
                rows={1}
                maxLength={500}
                placeholder="이어서 요청하기…"
                className="w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 focus-visible:outline-none disabled:opacity-70"
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="workspace-input-hint sr-only">Enter 보내기 · Shift+Enter 줄바꿈</span>
              <button
                type="button"
                aria-label="보내기"
                disabled={!canSend}
                onClick={() => void send()}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-(--text-primary) text-(--surface-canvas) focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
              >
                {sending
                  ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  : <CornerDownLeft size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
