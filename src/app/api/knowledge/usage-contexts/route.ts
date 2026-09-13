import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { cookies } from "next/headers";
import { getKnowledgeAuth } from "@/lib/knowledge-auth";
import { getServerSupabaseClient } from "@/lib/supabase-server";
import { APPROVED_KNOWLEDGE_SELECT, verifyApprovedKnowledge } from "@/lib/knowledge-approved-server";
import { resolveLatestApprovedKnowledge } from "@/lib/knowledge-latest-approved";
import { readUsageContext } from "@/lib/knowledge-usage-context-store";
import { listUsageJobIds, usageHasContent, usageMatches } from "@/lib/knowledge-usage-search";
import type { UsageVersion } from "@/lib/knowledge-usage-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PAGE_SIZE = 20;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const pageText = params.get("page") ?? "0";
  if (query.length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(query) || !/^(0|[1-9]\d*)$/.test(pageText) || Number(pageText) > 49) return json({ error: "검색어나 페이지가 올바르지 않아요." }, 400);
  const page = Number(pageText);
  try {
    const auth = await getKnowledgeAuth(await cookies());
    if (auth.status !== "authenticated") return json({ error: auth.status === "login_required" ? "로그인 후 메모를 찾아보세요." : "로그인 상태를 확인할 수 없어요." }, auth.status === "login_required" ? 401 : 503);
    const root = process.env.FOCUS_FEED_USAGE_ROOT?.trim(); const brainRoot = process.env.FOCUS_FEED_BRAIN_ROOT?.trim();
    if (!root || !isAbsolute(root) || !brainRoot || !isAbsolute(brainRoot)) return json({ error: "활용 메모의 로컬 저장소와 Brain 연결이 필요해요." }, 503);
    const client = getServerSupabaseClient();
    if (!client) return json({ error: "문서 서버에 연결할 수 없어요." }, 503);
    const ids = await listUsageJobIds(root, auth.user.id);
    const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) => ids.slice(i * 100, (i + 1) * 100));
    const batches = await Promise.all(chunks.map(chunk => client.from("knowledge_jobs").select(APPROVED_KNOWLEDGE_SELECT)
      .eq("user_id", auth.user.id).eq("status", "completed").in("id", chunk)));
    if (batches.some(batch => batch.error || !Array.isArray(batch.data))) throw new Error("document lookup failed");
    const knownIds = new Set(ids); const seen = new Set<string>();
    const snapshots = batches.flatMap(batch => batch.data ?? []).map(row => {
      const snapshot = verifyApprovedKnowledge(row);
      if (!snapshot || !knownIds.has(snapshot.id) || seen.has(snapshot.id)) throw new Error("invalid approval");
      seen.add(snapshot.id); return snapshot;
    });
    const latest = await resolveLatestApprovedKnowledge({ snapshots, userId: auth.user.id, brainRoot, supabase: client });
    const items: { jobId: string; title: string; version: UsageVersion; record: Awaited<ReturnType<typeof readUsageContext>> }[] = [];
    let noCurrentMemo = 0;
    // Bound concurrent filesystem work while preserving all-or-error semantics.
    for (let start = 0; start < latest.length; start += 8) {
      const group = await Promise.all(latest.slice(start, start + 8).map(async source => {
        const version: UsageVersion = { kind: source.amendmentId ? "amendment" : "original", revision: source.revision, amendmentId: source.amendmentId ?? null, bodySha256: createHash("sha256").update(source.markdown, "utf8").digest("hex") };
        const record = await readUsageContext(root, auth.user.id, source.id, version);
        return { jobId: source.id, title: source.title, version, record };
      }));
      for (const item of group) {
        if (!usageHasContent(item.record)) { noCurrentMemo++; continue; }
        if (!query || usageMatches(item.record, query)) items.push(item);
      }
    }
    items.sort((a, b) => (b.record.updatedAt ?? "").localeCompare(a.record.updatedAt ?? "") || a.jobId.localeCompare(b.jobId));
    return json({ items: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), total: items.length, page, pageSize: PAGE_SIZE, noCurrentMemo, unavailableDocuments: ids.length - snapshots.length });
  } catch { return json({ error: "메모를 모두 확인하지 못했어요. 로컬 저장소·승인 연결이나 자료 수 제한(1,000개)을 확인하고 다시 시도해 주세요." }, 503); }
}
