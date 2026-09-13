import { APPROVED_KNOWLEDGE_SELECT as APPROVED_SELECT, verifyApprovedKnowledge as verifiedSnapshot } from "@/lib/knowledge-approved-server";
import { cookies } from "next/headers";

import { isKnowledgeJobsUnavailableError } from "@/lib/knowledge-capture";
import {
  APPROVED_KNOWLEDGE_RECENT_LIMIT,
  approvedKnowledgeExcerpt,
  approvedKnowledgeMatches,
  parseApprovedKnowledgeQuery,
  type ApprovedKnowledgeSnapshot,
} from "@/lib/knowledge-approved";
import { getServerSupabaseClient } from "@/lib/supabase-server";
import { getKnowledgeAuth } from "@/lib/knowledge-auth";
import { KnowledgeSemanticUnavailableError, searchSemanticKnowledge } from "@/lib/knowledge-semantic-search";
import {
  LatestApprovedKnowledgeUnavailableError,
  resolveLatestApprovedKnowledge,
  type LatestApprovedKnowledgeSnapshot,
} from "@/lib/knowledge-latest-approved";

export const dynamic = "force-dynamic";

function jsonPrivate(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function publicSource(snapshot: LatestApprovedKnowledgeSnapshot, includeMarkdown: boolean) {
  return {
    id: snapshot.id,
    title: snapshot.title,
    sourceUrl: snapshot.sourceUrl,
    revision: snapshot.revision,
    approvedAt: snapshot.approvedAt,
    versionScope: snapshot.versionScope,
    ...(snapshot.amendmentId ? { amendmentId: snapshot.amendmentId, baseRevision: snapshot.baseRevision } : {}),
    excerpt: approvedKnowledgeExcerpt(snapshot.markdown),
    ...(includeMarkdown ? { markdown: snapshot.markdown } : {}),
  };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const auth = await getKnowledgeAuth(cookieStore);
  if (auth.status === "unavailable") return jsonPrivate({ code: "auth_unavailable", error: "로그인 상태를 확인하는 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  if (auth.status !== "authenticated") return jsonPrivate({ code: "login_required", error: "로그인해야 승인된 지식을 볼 수 있어요." }, 401);
  const user = auth.user;

  const params = new URL(request.url).searchParams;
  const searchMode = params.get("search") ?? "keyword";
  const query = parseApprovedKnowledgeQuery(params);
  if (!query) return jsonPrivate({ error: "지식 문서 조회 조건이 올바르지 않아요." }, 400);
  if (!["keyword", "semantic"].includes(searchMode) || (searchMode === "semantic" && (query.mode !== "search" || !query.query))) {
    return jsonPrivate({ error: "자연어 검색에는 검색할 내용을 입력해 주세요." }, 400);
  }

  const supabase = getServerSupabaseClient();
  if (!supabase) return jsonPrivate({ error: "지식 문서 서버 설정이 아직 준비되지 않았어요." }, 503);

  let result: { data: unknown[] | null; error: { code?: string | null; message?: string | null } | null };
  if (query.mode === "ids") {
    result = await supabase.from("knowledge_jobs")
      .select(APPROVED_SELECT)
      .eq("user_id", user.id)
      .eq("status", "completed")
      .in("id", query.ids);
  } else {
    result = await supabase.from("knowledge_jobs")
      .select(APPROVED_SELECT)
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(APPROVED_KNOWLEDGE_RECENT_LIMIT + 1);
  }

  if (result.error) {
    if (isKnowledgeJobsUnavailableError(result.error)) {
      return jsonPrivate({ error: "승인된 지식 문서를 일시적으로 확인할 수 없어요." }, 503);
    }
    console.error("[GET /api/knowledge/approved]", result.error.message);
    return jsonPrivate({ error: "승인된 지식 문서를 불러오지 못했어요." }, 500);
  }

  const rows = result.data ?? [];
  if (query.mode === "ids") {
    const byId = new Map(rows.flatMap((value) => {
      const snapshot = verifiedSnapshot(value);
      return snapshot ? [[snapshot.id, snapshot] as const] : [];
    }));
    const snapshots = query.ids.map((id) => byId.get(id));
    if (snapshots.some((snapshot) => !snapshot)) {
      return jsonPrivate({ error: "승인된 지식 문서를 찾지 못했어요." }, 404);
    }
    try {
      const latest = await resolveLatestApprovedKnowledge({
        snapshots: snapshots as ApprovedKnowledgeSnapshot[],
        userId: user.id,
        brainRoot: process.env.FOCUS_FEED_BRAIN_ROOT,
        supabase,
      });
      return jsonPrivate({ sources: latest.map((snapshot) => publicSource(snapshot, true)) });
    } catch (error) {
      if (error instanceof LatestApprovedKnowledgeUnavailableError) {
        return jsonPrivate({ error: "최신 승인본을 일시적으로 확인할 수 없어요." }, 503);
      }
      throw error;
    }
  }

  const hasMore = rows.length > APPROVED_KNOWLEDGE_RECENT_LIMIT;
  const snapshots = rows.slice(0, APPROVED_KNOWLEDGE_RECENT_LIMIT)
    .flatMap((value) => {
      const snapshot = verifiedSnapshot(value);
      return snapshot ? [snapshot] : [];
    });
  try {
    const latest = await resolveLatestApprovedKnowledge({
      snapshots,
      userId: user.id,
      brainRoot: process.env.FOCUS_FEED_BRAIN_ROOT,
      supabase,
    });
    if (searchMode === "semantic") {
      const result = await searchSemanticKnowledge({ query: query.query, snapshots: latest, brainRoot: process.env.FOCUS_FEED_BRAIN_ROOT, mcpRoot: process.env.FOCUS_FEED_MCP_ROOT });
      return jsonPrivate({ sources: result.sources.map((snapshot) => publicSource(snapshot, false)), hasMore, scope: "recent-100", searchMode, unindexedCount: result.unindexedCount });
    }
    const sources = latest
      .filter((snapshot) => approvedKnowledgeMatches(snapshot, query.query))
      .map((snapshot) => publicSource(snapshot, false));
    return jsonPrivate({ sources, hasMore, scope: "recent-100" as const });
  } catch (error) {
    if (error instanceof KnowledgeSemanticUnavailableError) return jsonPrivate({ error: error.message }, 503);
    if (error instanceof LatestApprovedKnowledgeUnavailableError) {
      return jsonPrivate({ error: "최신 승인본을 일시적으로 확인할 수 없어요." }, 503);
    }
    throw error;
  }
}
