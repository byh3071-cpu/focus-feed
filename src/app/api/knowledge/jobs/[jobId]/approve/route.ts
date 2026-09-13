import { cookies } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/supabase-server-cookies";
import { getServerSupabaseClient } from "@/lib/supabase-server";
import {
  isKnowledgeJobsUnavailableError,
  knowledgeJobStatusLabel,
  normalizeYouTubeUrl,
  parseKnowledgeReviewDetail,
  type KnowledgeJobSummary,
} from "@/lib/knowledge-capture";
import {
  planStudioApproval,
  resolveStudioDraft,
  studioApprovalIntentHash,
  studioDraftFromResult,
} from "@/lib/knowledge-studio";

export const dynamic = "force-dynamic";

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUDIO_JOB_SELECT =
  "id, user_id, video_id, source_url, title, channel_name, source_guide, status, failure_code, capture_ready, created_at, updated_at, quality_score, quality_report, result";

type StudioRow = {
  id: string;
  user_id: string;
  video_id: string;
  source_url: string;
  title: string;
  channel_name: string | null;
  source_guide: string | null;
  status: KnowledgeJobSummary["status"];
  failure_code: string | null;
  capture_ready: boolean;
  created_at: string;
  updated_at: string;
  quality_score: number | null;
  quality_report: unknown;
  result: unknown;
};

function jsonPrivate(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function serializeJob(row: StudioRow): KnowledgeJobSummary {
  return {
    id: row.id,
    videoId: row.video_id,
    sourceUrl: normalizeYouTubeUrl(row.source_url)
      ?? `https://www.youtube.com/watch?v=${encodeURIComponent(row.video_id)}`,
    title: row.title,
    channelName: row.channel_name,
    status: row.status,
    failureCode: row.failure_code,
    captureReady: row.capture_ready,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewAvailable: row.status === "review_required" || row.status === "approving",
  };
}

function approvalRpcError(message: string): { status: number; error: string } | null {
  if (message.includes("knowledge job not found")) {
    return { status: 404, error: "검토 항목을 찾지 못했어요." };
  }
  if (message.includes("approval already in progress with different intent")) {
    return { status: 409, error: "다른 초안으로 승인이 진행 중이에요. 다시 불러온 뒤 승인해 주세요." };
  }
  if (message.includes("studio draft changed")) {
    return { status: 409, error: "다른 곳에서 초안이 바뀌었어요. 다시 불러온 뒤 승인해 주세요." };
  }
  if (message.includes("knowledge job is not reviewable") || message.includes("approval claim lost")) {
    return { status: 409, error: "다시 불러온 뒤 승인해 주세요." };
  }
  if (message.includes("invalid approval intent")) {
    return { status: 400, error: "승인 토큰이 올바르지 않아요." };
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    return Response.json({ error: "검토 항목 ID가 올바르지 않아요." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) return Response.json({ error: "로그인해야 승인할 수 있어요." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "승인 요청이 올바르지 않아요." }, { status: 400 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  if (!record) return Response.json({ error: "승인 요청이 올바르지 않아요." }, { status: 400 });

  const supabase = getServerSupabaseClient();
  if (!supabase) {
    return Response.json({ error: "지식 작업실 서버 설정이 아직 준비되지 않았어요." }, { status: 503 });
  }

  const loaded = await supabase.from("knowledge_jobs")
    .select(STUDIO_JOB_SELECT)
    .eq("user_id", user.id)
    .eq("id", jobId)
    .maybeSingle();

  if (loaded.error) {
    if (isKnowledgeJobsUnavailableError(loaded.error)) {
      return Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 });
    }
    console.error("[POST /api/knowledge/jobs/:jobId/approve]", loaded.error.message);
    return Response.json({ error: "승인을 시작하지 못했어요." }, { status: 500 });
  }
  if (!loaded.data) {
    return Response.json({ error: "검토 항목을 찾지 못했어요." }, { status: 404 });
  }

  const row = loaded.data as StudioRow;
  if (row.status === "completed") {
    return Response.json({ error: "이미 적재된 항목이에요." }, { status: 409 });
  }
  if (row.status !== "review_required" && row.status !== "approving") {
    return Response.json({ error: "아직 검토할 수 없어요." }, { status: 409 });
  }

  const review = parseKnowledgeReviewDetail({
    status: row.status,
    result: row.result,
    qualityScore: row.quality_score,
    qualityReport: row.quality_report,
  });
  if (!review) {
    return Response.json({ error: "아직 검토할 수 없어요." }, { status: 409 });
  }

  let draft = studioDraftFromResult(row.result);
  let resultToStore: Record<string, unknown> | null = null;

  if (row.status === "approving") {
    if (!draft) {
      return Response.json({ error: "다시 불러온 뒤 승인해 주세요." }, { status: 409 });
    }
    if (record.expectedRevision !== draft.revision || record.markdown !== draft.markdown) {
      return Response.json({ error: "다시 불러온 뒤 승인해 주세요." }, { status: 409 });
    }
  } else {
    const planned = planStudioApproval({
      result: row.result,
      markdown: record.markdown,
      expectedRevision: record.expectedRevision,
    });
    if (!planned.ok) {
      if (planned.code === "conflict") {
        return Response.json({ error: "다른 곳에서 초안이 바뀌었어요. 다시 불러온 뒤 승인해 주세요." }, { status: 409 });
      }
      return Response.json({ error: "승인할 초안이 올바르지 않아요." }, { status: 400 });
    }
    draft = planned.draft;
    if (planned.persist) resultToStore = planned.result;
  }

  if (resultToStore) {
    const updated = await supabase.rpc("patch_knowledge_studio_draft", {
      p_user_id: user.id,
      p_job_id: jobId,
      p_expected_result: row.result,
      p_result: resultToStore,
    });
    if (updated.error) {
      if (updated.error.code === "PGRST202" || updated.error.code === "42883") {
        return Response.json({ error: "작업실 승인 연결이 아직 준비되지 않았어요." }, { status: 503 });
      }
      if (isKnowledgeJobsUnavailableError(updated.error)) {
        return Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 });
      }
      console.error("[POST /api/knowledge/jobs/:jobId/approve persist]", updated.error.message);
      return Response.json({ error: "초안을 저장하지 못했어요." }, { status: 500 });
    }
    if (!updated.data) {
      return Response.json({ error: "다시 불러온 뒤 승인해 주세요." }, { status: 409 });
    }
  }

  const intentHash = await studioApprovalIntentHash(jobId, draft.revision, draft.markdown);
  const rpc = await supabase.rpc("begin_knowledge_studio_approval", {
    p_user_id: user.id,
    p_job_id: jobId,
    p_revision: draft.revision,
    p_markdown: draft.markdown,
    p_intent_hash: intentHash,
  });

  if (rpc.error) {
    if (rpc.error.code === "PGRST202" || rpc.error.code === "42883") {
      return Response.json({ error: "작업실 승인 연결이 아직 준비되지 않았어요." }, { status: 503 });
    }
    const mapped = approvalRpcError(rpc.error.message);
    if (mapped) return Response.json({ error: mapped.error }, { status: mapped.status });
    console.error("[POST /api/knowledge/jobs/:jobId/approve rpc]", rpc.error.message);
    return Response.json({ error: "승인을 시작하지 못했어요." }, { status: 500 });
  }

  const rpcRow = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as StudioRow | null;
  if (!rpcRow || rpcRow.id !== jobId || rpcRow.user_id !== user.id
    || (rpcRow.status !== "approving" && rpcRow.status !== "completed")) {
    return Response.json({ error: "승인을 시작하지 못했어요." }, { status: 500 });
  }

  const nextRow = rpcRow;
  const approvedDraft = studioDraftFromResult(nextRow.result);
  if (!approvedDraft || approvedDraft.revision !== draft.revision || approvedDraft.markdown !== draft.markdown) {
    return Response.json({ error: "승인된 초안이 요청과 다릅니다. 다시 불러와 주세요." }, { status: 409 });
  }
  const studioDraft = resolveStudioDraft({
    result: nextRow.result,
    title: nextRow.title,
    review,
  });

  return jsonPrivate({
    job: serializeJob(nextRow),
    statusLabel: knowledgeJobStatusLabel(nextRow.status),
    studioDraft,
  });
}
