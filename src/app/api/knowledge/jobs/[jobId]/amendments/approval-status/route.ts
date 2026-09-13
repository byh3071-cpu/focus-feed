import { cookies } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/supabase-server-cookies";
import { readBrainApprovalStatus } from "@/lib/knowledge-brain-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) return json({ error: "문서 ID가 올바르지 않아요." }, 400);
  const user = await getCurrentUserFromCookies(await cookies());
  if (!user) return json({ error: "로그인해야 승인 상태를 확인할 수 있어요." }, 401);
  const root = process.env.FOCUS_FEED_BRAIN_ROOT;
  if (!root) return json({ error: "이 서버에는 Brain 연결이 없어요. Brain이 연결된 PC에서 확인해 주세요." }, 503);
  try { return json(await readBrainApprovalStatus(jobId, user.id, root)); }
  catch { return json({ error: "Brain 승인 기록을 확인하지 못했어요. 연결 상태나 승인 문서를 점검해 주세요." }, 503); }
}
