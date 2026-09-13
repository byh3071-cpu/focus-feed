import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { cookies } from "next/headers";
import { getKnowledgeAuth } from "@/lib/knowledge-auth";
import { getServerSupabaseClient } from "@/lib/supabase-server";
import { APPROVED_KNOWLEDGE_SELECT, verifyApprovedKnowledge } from "@/lib/knowledge-approved-server";
import { resolveLatestApprovedKnowledge } from "@/lib/knowledge-latest-approved";
import { parseUsageContent, parseUsageVersion } from "@/lib/knowledge-usage-context";
import { readUsageContext, saveUsageContext, UsageContextConflictError } from "@/lib/knowledge-usage-context-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ jobId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function load(context: Context) {
  const { jobId } = await context.params;
  if (!UUID.test(jobId)) return { error: json({ error: "문서 주소가 올바르지 않아요." }, 400) };
  const auth = await getKnowledgeAuth(await cookies());
  if (auth.status !== "authenticated") return { error: json({ error: auth.status === "login_required" ? "로그인 후 다시 열어 주세요." : "로그인 상태를 확인할 수 없어요." }, auth.status === "login_required" ? 401 : 503) };
  const root = process.env.FOCUS_FEED_USAGE_ROOT?.trim();
  const brainRoot = process.env.FOCUS_FEED_BRAIN_ROOT?.trim();
  if (!root || !isAbsolute(root) || !brainRoot || !isAbsolute(brainRoot)) return { error: json({ error: "활용 메모는 로컬 저장소와 Brain이 연결된 서버에서 사용할 수 있어요." }, 503) };
  const client = getServerSupabaseClient();
  if (!client) return { error: json({ error: "문서 서버에 연결할 수 없어요." }, 503) };
  const result = await client.from("knowledge_jobs").select(APPROVED_KNOWLEDGE_SELECT)
    .eq("user_id", auth.user.id).eq("status", "completed").eq("id", jobId).maybeSingle();
  if (result.error) return { error: json({ error: "승인 문서를 확인할 수 없어요." }, 503) };
  const base = verifyApprovedKnowledge(result.data);
  if (!base) return { error: json({ error: "승인 문서를 찾지 못했어요." }, 404) };
  const [latest] = await resolveLatestApprovedKnowledge({ snapshots: [base], userId: auth.user.id, brainRoot, supabase: client });
  const version = parseUsageVersion({ kind: latest.amendmentId ? "amendment" : "original", revision: latest.revision,
    amendmentId: latest.amendmentId ?? null, bodySha256: createHash("sha256").update(latest.markdown, "utf8").digest("hex") });
  return { root, userId: auth.user.id, jobId, title: latest.title, version };
}

export async function GET(_request: Request, context: Context) {
  try {
    const loaded = await load(context);
    if (loaded.error) return loaded.error;
    const record = await readUsageContext(loaded.root, loaded.userId, loaded.jobId, loaded.version);
    return json({ title: loaded.title, version: loaded.version, record });
  } catch { return json({ error: "활용 메모나 승인 버전을 확인할 수 없어요. 잠시 후 다시 시도해 주세요." }, 503); }
}

async function readInput(request: Request) {
  if (!request.body) throw new Error("missing body");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 32_768) { await reader.cancel(); throw new RangeError("size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("input");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["version", "expectedRevision", "content"].includes(key)) || !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0) throw new Error("input");
  return { version: parseUsageVersion(row.version), content: parseUsageContent(row.content), expectedRevision: Number(row.expectedRevision) };
}

export async function PUT(request: Request, context: Context) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const expectedOrigin = request.headers.get("host") ? `${url.protocol}//${request.headers.get("host")}` : url.origin;
  if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "허용되지 않은 요청입니다." }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "JSON 형식으로 보내 주세요." }, 415);
  try {
    const loaded = await load(context);
    if (loaded.error) return loaded.error;
    let input;
    try { input = await readInput(request); }
    catch (error) { return json({ error: "메모 입력이나 버전이 올바르지 않아요." }, error instanceof RangeError ? 413 : 400); }
    if (JSON.stringify(input.version) !== JSON.stringify(loaded.version)) return json({ error: "승인 버전이 바뀌었어요. 작성한 내용을 보관하고 최신 버전을 다시 확인해 주세요." }, 409);
    const record = await saveUsageContext(loaded.root, loaded.userId, loaded.jobId, loaded.version, input.content, input.expectedRevision);
    return json({ title: loaded.title, version: loaded.version, record });
  } catch (error) {
    return json({ error: error instanceof UsageContextConflictError ? "다른 곳에서 메모를 수정했어요. 작성한 내용을 보관하고 다시 열어 주세요." : "메모를 저장하지 못했어요. 작성한 내용은 그대로 남아 있어요." }, error instanceof UsageContextConflictError ? 409 : 503);
  }
}
