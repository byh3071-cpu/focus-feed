import { cookies } from "next/headers";
import { getCurrentUserFromCookies } from "@/lib/supabase-server-cookies";
import {
  isKnowledgeJobsUnavailableError,
  normalizeYouTubeUrl,
  type KnowledgeJobSummary,
} from "@/lib/knowledge-capture";
import { getServerSupabaseClient, type Database } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type JobRow = Pick<Database["public"]["Tables"]["knowledge_jobs"]["Row"],
  | "id" | "video_id" | "source_url" | "title" | "channel_name"
  | "status" | "failure_code" | "capture_ready" | "created_at" | "updated_at"
>;

const serialize = (job: JobRow): KnowledgeJobSummary => ({
  id: job.id,
  videoId: job.video_id,
  sourceUrl: normalizeYouTubeUrl(job.source_url)
    ?? `https://www.youtube.com/watch?v=${encodeURIComponent(job.video_id)}`,
  title: job.title,
  channelName: job.channel_name,
  status: job.status,
  failureCode: job.failure_code,
  captureReady: job.capture_ready,
  createdAt: job.created_at,
  updatedAt: job.updated_at,
  reviewAvailable: job.status === "review_required" || job.status === "approving",
});

export async function GET() {
  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) return Response.json({ error: "로그인해야 지식함을 볼 수 있어요." }, { status: 401 });
  const supabase = getServerSupabaseClient();
  if (!supabase) return Response.json({ error: "지식 대기열 서버 설정이 아직 준비되지 않았어요." }, { status: 503 });

  const { data, error } = await supabase
    .from("knowledge_jobs")
    .select("id, video_id, source_url, title, channel_name, status, failure_code, capture_ready, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (isKnowledgeJobsUnavailableError(error)) return Response.json({ error: "지식 대기열 DB가 아직 준비되지 않았어요." }, { status: 503 });
    console.error("[GET /api/knowledge/jobs]", error.message);
    return Response.json({ error: "지식 대기열을 불러오지 못했어요." }, { status: 500 });
  }
  return Response.json({ jobs: (data ?? []).map(serialize) }, { headers: { "Cache-Control": "private, no-store" } });
}
