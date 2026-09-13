import { cookies } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/supabase-server-cookies";
import { getServerSupabaseClient, type Database } from "@/lib/supabase-server";
import { APPROVED_KNOWLEDGE_SELECT, verifyApprovedKnowledge } from "@/lib/knowledge-approved-server";
import { KNOWLEDGE_JOB_ID_PATTERN } from "@/lib/knowledge-studio-agent";
import { parseAmendmentInput } from "@/lib/knowledge-amendments";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ jobId: string }> };
type Row = Database["public"]["Tables"]["knowledge_amendments"]["Row"];
const missingStorage = (code?: string) => ["42P01", "42883", "PGRST202", "PGRST205"].includes(code ?? "");
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const version = (row: Row) => ({ id: row.id, revision: row.amendment_revision, baseRevision: row.base_revision, createdAt: row.created_at });

async function loadBase(context: Context) {
  const { jobId } = await context.params;
  if (!KNOWLEDGE_JOB_ID_PATTERN.test(jobId)) return { error: json({ error: "문서 ID가 올바르지 않아요." }, 400) };
  const user = await getCurrentUserFromCookies(await cookies());
  if (!user) return { error: json({ error: "로그인해야 수정안을 볼 수 있어요." }, 401) };
  const client = getServerSupabaseClient();
  if (!client) return { error: json({ error: "서버 연결이 준비되지 않았어요." }, 503) };
  const result = await client.from("knowledge_jobs").select(APPROVED_KNOWLEDGE_SELECT).eq("user_id", user.id).eq("status", "completed").eq("id", jobId).maybeSingle();
  if (result.error) return { error: json({ error: "승인 문서를 불러오지 못했어요." }, 503) };
  const base = verifyApprovedKnowledge(result.data);
  if (!base) return { error: json({ error: "승인 문서를 찾지 못했어요." }, 404) };
  return { client, user, jobId, base };
}

export async function GET(request: Request, context: Context) {
  const loaded = await loadBase(context);
  if (loaded.error) return loaded.error;
  const { client, user, jobId, base } = loaded;
  const requested = new URL(request.url).searchParams.get("revision");
  if (requested !== null && (!/^\d+$/.test(requested) || !Number.isSafeInteger(Number(requested)) || Number(requested) < 1)) return json({ error: "수정안 버전이 올바르지 않아요." }, 400);
  const publicBase = { id: base.id, title: base.title, revision: base.revision, markdown: base.markdown };
  const list = await client.from("knowledge_amendments").select("id, amendment_revision, base_revision, created_at")
    .eq("user_id", user.id).eq("job_id", jobId).order("amendment_revision", { ascending: false }).limit(50);
  if (list.error) {
    if (missingStorage(list.error.code)) return json({ storageReady: false, base: publicBase, history: [], current: null });
    return json({ error: "수정안 이력을 불러오지 못했어요." }, 503);
  }
  const history = (list.data ?? []).map((row) => version(row as Row));
  const selected = requested ? Number(requested) : history[0]?.revision;
  if (!selected) return json({ storageReady: true, base: publicBase, history, current: null });
  const current = await client.from("knowledge_amendments").select("id, amendment_revision, base_revision, markdown, created_at")
    .eq("user_id", user.id).eq("job_id", jobId).eq("amendment_revision", selected).maybeSingle();
  if (current.error) return json({ error: "수정안을 불러오지 못했어요." }, 503);
  if (!current.data) return json({ error: "수정안을 찾지 못했어요." }, 404);
  return json({ storageReady: true, base: publicBase, history, current: { ...version(current.data as Row), markdown: current.data.markdown } });
}

async function readLimitedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512_000) { await reader.cancel(); throw new RangeError("too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

export async function POST(request: Request, context: Context) {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const publicHost = request.headers.get("host");
  const publicOrigin = publicHost ? `${requestUrl.protocol}//${publicHost}` : requestUrl.origin;
  if (origin && origin !== publicOrigin) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const loaded = await loadBase(context);
  if (loaded.error) return loaded.error;
  let input;
  try { input = parseAmendmentInput(await readLimitedJson(request)); }
  catch (error) { return json({ error: "수정안 요청이 올바르지 않거나 너무 커요." }, error instanceof RangeError ? 413 : 400); }
  if (!input) return json({ error: "수정안 본문이나 버전이 올바르지 않아요." }, 400);
  const { client, user, jobId, base } = loaded;
  if (base.revision !== input.baseRevision) return json({ error: "기준 승인본이 달라졌어요. 작성 중인 내용을 보관하고 다시 열어 주세요." }, 409);
  const result = await client.rpc("save_knowledge_amendment", {
    p_user_id: user.id, p_job_id: jobId, p_expected_revision: input.expectedRevision,
    p_base_revision: input.baseRevision, p_base_intent_hash: base.approvalIntentHash, p_markdown: input.markdown,
  });
  if (result.error) {
    if (missingStorage(result.error.code)) return json({ error: "수정안 저장소가 아직 준비되지 않았어요. 작성한 내용을 보관해 주세요." }, 503);
    if (["40001", "22023"].includes(result.error.code)) return json({ error: "수정안 이력이나 기준 문서가 달라졌어요. 작성한 내용은 유지했으니 최신 상태를 다시 확인해 주세요." }, 409);
    if (result.error.code === "P0002") return json({ error: "승인 문서를 찾지 못했어요." }, 404);
    return json({ error: "수정안을 저장하지 못했어요. 작성한 내용은 그대로 남아 있어요." }, 500);
  }
  if (!result.data) return json({ error: "저장 결과를 확인하지 못했어요." }, 500);
  return json({ amendment: { ...version(result.data), markdown: result.data.markdown } });
}
