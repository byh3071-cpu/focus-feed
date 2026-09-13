import { cookies } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/supabase-server-cookies";
import { getServerSupabaseClient } from "@/lib/supabase-server";
import { generateGeminiTextResult, geminiFailureMessage } from "@/lib/gemini";
import { guardGeminiActionRateLimit } from "@/lib/gemini-rate-limit";
import {
  isKnowledgeJobsUnavailableError,
  parseKnowledgeReviewDetail,
} from "@/lib/knowledge-capture";
import {
  applyStudioDraftPatch,
  buildStudioAgentPrompt,
  parseStudioChatMessage,
  resolveStudioChatDraft,
  resolveStudioDraft,
  sanitizeSourceGuide,
  studioChatEvidenceLines,
  studioDraftFromResult,
} from "@/lib/knowledge-studio";

export const dynamic = "force-dynamic";

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUDIO_JOB_SELECT =
  "id, user_id, video_id, source_url, title, channel_name, source_guide, status, failure_code, capture_ready, created_at, updated_at, quality_score, quality_report, result";

function jsonPrivate(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
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
  if (!user) return Response.json({ error: "로그인해야 대화로 초안을 고칠 수 있어요." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청이 올바르지 않아요." }, { status: 400 });
  }
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const message = parseStudioChatMessage(record?.message);
  if (!record || !message) {
    return Response.json({ error: "메시지를 2자 이상 입력해 주세요." }, { status: 400 });
  }
  if (typeof record.markdown !== "string" || !record.markdown.trim()) {
    return Response.json({ error: "현재 초안이 없어요." }, { status: 400 });
  }
  if (!Number.isInteger(record.expectedRevision) || (record.expectedRevision as number) < 0) {
    return Response.json({ error: "초안 버전이 올바르지 않아요." }, { status: 400 });
  }

  const burst = await guardGeminiActionRateLimit("studio_chat");
  if (!burst.ok) {
    return Response.json({ error: burst.error }, { status: 429 });
  }

  const supabase = getServerSupabaseClient();
  if (!supabase) {
    return Response.json({ error: "지식 작업실 서버 설정이 아직 준비되지 않았어요." }, { status: 503 });
  }

  const { data, error } = await supabase.from("knowledge_jobs")
    .select(STUDIO_JOB_SELECT)
    .eq("user_id", user.id)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isKnowledgeJobsUnavailableError(error)) {
      return Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 });
    }
    console.error("[POST /api/knowledge/jobs/:jobId/studio-chat]", error.message);
    return Response.json({ error: "작업실을 불러오지 못했어요." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "검토 항목을 찾지 못했어요." }, { status: 404 });
  if (data.status !== "review_required") {
    return Response.json({ error: "지금은 대화로 초안을 고칠 수 없어요." }, { status: 409 });
  }

  const review = parseKnowledgeReviewDetail({
    status: data.status,
    result: data.result,
    qualityScore: data.quality_score,
    qualityReport: data.quality_report,
  });
  if (!review) {
    return Response.json({ error: "아직 검토할 수 있는 상태가 아니에요." }, { status: 409 });
  }

  const storedRevision = studioDraftFromResult(data.result)?.revision ?? 0;
  if (record.expectedRevision !== storedRevision) {
    return Response.json({ error: "다른 곳에서 초안이 바뀌었어요. 다시 불러온 뒤 보내 주세요." }, { status: 409 });
  }

  const history = Array.isArray(record.history)
    ? record.history.flatMap((item): { role: "user" | "assistant"; content: string }[] => {
      const turn = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : null;
      if (!turn || (turn.role !== "user" && turn.role !== "assistant")) return [];
      if (typeof turn.content !== "string" || !turn.content.trim()) return [];
      return [{ role: turn.role, content: turn.content }];
    })
    : [];

  const prompt = buildStudioAgentPrompt({
    markdown: record.markdown,
    message,
    sourceGuide: sanitizeSourceGuide(data.source_guide),
    evidenceLines: studioChatEvidenceLines(review),
    history,
  });

  const generated = await generateGeminiTextResult(prompt, "StudioChat");
  if (!generated.ok) {
    return Response.json({ error: geminiFailureMessage(generated.kind) }, { status: 502 });
  }
  const nextMarkdown = resolveStudioChatDraft(message, generated.text);
  if (!nextMarkdown) {
    return jsonPrivate({
      notice: "초안은 그대로 두었어요",
      studioDraft: resolveStudioDraft({
        result: data.result,
        title: data.title,
        review,
      }),
    });
  }

  const applied = applyStudioDraftPatch({
    result: data.result,
    markdown: nextMarkdown,
    expectedRevision: record.expectedRevision,
  });
  if (!applied.ok) {
    if (applied.code === "conflict") {
      return Response.json({ error: "다른 곳에서 초안이 바뀌었어요. 다시 불러온 뒤 보내 주세요." }, { status: 409 });
    }
    return Response.json({ error: "고친 초안을 저장하지 못했어요." }, { status: 400 });
  }

  const updated = await supabase.rpc("patch_knowledge_studio_draft", {
    p_user_id: user.id,
    p_job_id: jobId,
    p_expected_result: data.result,
    p_result: applied.result,
  });

  if (updated.error) {
    if (updated.error.code === "PGRST202" || updated.error.code === "42883") {
      return Response.json({ error: "작업실 저장 연결이 아직 준비되지 않았어요." }, { status: 503 });
    }
    if (isKnowledgeJobsUnavailableError(updated.error)) {
      return Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 });
    }
    console.error("[POST /api/knowledge/jobs/:jobId/studio-chat]", updated.error.message);
    return Response.json({ error: "고친 초안을 저장하지 못했어요." }, { status: 500 });
  }
  if (!updated.data) return Response.json({ error: "초안이나 승인 상태가 바뀌었어요. 다시 불러온 뒤 보내 주세요." }, { status: 409 });

  const studioDraft = resolveStudioDraft({
    result: applied.result,
    title: data.title,
    review,
  });

  return jsonPrivate({
    notice: "초안을 고쳤어요",
    studioDraft,
  });
}
