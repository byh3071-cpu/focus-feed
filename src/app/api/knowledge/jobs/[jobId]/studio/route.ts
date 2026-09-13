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
  applyStudioDraftPatch,
  resolveStudioDraft,
  sanitizeSourceGuide,
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

async function loadStudioRow(jobId: string, userId: string) {
  const supabase = getServerSupabaseClient();
  if (!supabase) {
    return { errorResponse: Response.json({ error: "지식 작업실 서버 설정이 아직 준비되지 않았어요." }, { status: 503 }) };
  }

  const { data, error } = await supabase.from("knowledge_jobs")
    .select(STUDIO_JOB_SELECT)
    .eq("user_id", userId)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isKnowledgeJobsUnavailableError(error)) {
      return { errorResponse: Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 }) };
    }
    console.error("[knowledge studio]", error.message);
    return { errorResponse: Response.json({ error: "작업실을 불러오지 못했어요." }, { status: 500 }) };
  }
  if (!data) {
    return { errorResponse: Response.json({ error: "검토 항목을 찾지 못했어요." }, { status: 404 }) };
  }
  return { row: data as StudioRow, supabase };
}

function jsonPrivate(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    return Response.json({ error: "검토 항목 ID가 올바르지 않아요." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) return Response.json({ error: "로그인해야 작업실을 볼 수 있어요." }, { status: 401 });

  const loaded = await loadStudioRow(jobId, user.id);
  if ("errorResponse" in loaded && loaded.errorResponse) return loaded.errorResponse;
  const row = loaded.row;
  if (!row) return Response.json({ error: "작업실을 불러오지 못했어요." }, { status: 500 });

  const job = serializeJob(row);
  const review = parseKnowledgeReviewDetail({
    status: row.status,
    result: row.result,
    qualityScore: row.quality_score,
    qualityReport: row.quality_report,
  });

  if (!review) {
    return jsonPrivate({
      studioAvailable: false,
      job,
      statusLabel: knowledgeJobStatusLabel(row.status),
      sourceGuide: sanitizeSourceGuide(row.source_guide),
    });
  }

  return jsonPrivate({
    studioAvailable: true,
    job,
    statusLabel: knowledgeJobStatusLabel(row.status),
    sourceGuide: sanitizeSourceGuide(row.source_guide),
    review,
    studioDraft: resolveStudioDraft({
      result: row.result,
      title: row.title,
      review,
    }),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    return Response.json({ error: "검토 항목 ID가 올바르지 않아요." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) return Response.json({ error: "로그인해야 초안을 저장할 수 있어요." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "저장할 초안이 올바르지 않아요." }, { status: 400 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  if (!record) return Response.json({ error: "저장할 초안이 올바르지 않아요." }, { status: 400 });

  const loaded = await loadStudioRow(jobId, user.id);
  if ("errorResponse" in loaded && loaded.errorResponse) return loaded.errorResponse;
  const { row, supabase } = loaded;
  if (!row || !supabase) return Response.json({ error: "작업실을 불러오지 못했어요." }, { status: 500 });

  if (row.status !== "review_required") {
    return Response.json({ error: "지금은 초안을 고칠 수 없어요." }, { status: 409 });
  }

  const applied = applyStudioDraftPatch({
    result: row.result,
    markdown: record.markdown,
    expectedRevision: record.expectedRevision,
  });
  if (!applied.ok) {
    if (applied.code === "conflict") {
      return Response.json({ error: "다른 곳에서 초안이 바뀌었어요. 다시 불러온 뒤 저장해 주세요." }, { status: 409 });
    }
    return Response.json({ error: "저장할 초안이 올바르지 않아요." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("patch_knowledge_studio_draft", {
    p_user_id: user.id,
    p_job_id: jobId,
    p_expected_result: row.result,
    p_result: applied.result,
  });

  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return Response.json({ error: "작업실 저장 연결이 아직 준비되지 않았어요." }, { status: 503 });
    }
    if (isKnowledgeJobsUnavailableError(error)) {
      return Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 });
    }
    console.error("[PATCH /api/knowledge/jobs/:jobId/studio]", error.message);
    return Response.json({ error: "초안을 저장하지 못했어요." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "초안이나 승인 상태가 바뀌었어요. 다시 불러온 뒤 저장해 주세요." }, { status: 409 });

  return jsonPrivate({
    studioDraft: { ...applied.draft, seeded: false },
  });
}
