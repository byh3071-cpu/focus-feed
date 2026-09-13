import { cookies, headers } from "next/headers";
import { getCurrentUserFromCookies, type CookieStore } from "@/lib/supabase-server-cookies";
import { takeToken } from "@/lib/rate-limit";

function parsePositiveInt(raw: string | undefined, fallback: number, hardMax: number) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, hardMax);
}

async function geminiBurstKey(cookieStore: CookieStore): Promise<{ key: string; user: Awaited<ReturnType<typeof getCurrentUserFromCookies>> }> {
  const user = await getCurrentUserFromCookies(cookieStore);
  if (user?.id) return { key: `user:${user.id}`, user };
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    return { key: `ip:${ip}`, user };
  } catch {
    return { key: "ip:unknown", user };
  }
}

/**
 * Gemini 호출이 있는 서버 액션 진입 시 호출. 초과 시 사용자에게 보여줄 메시지 반환.
 */
export async function guardGeminiActionRateLimit(
  kind: "summary" | "insight" | "briefing" | "feed_qa" | "studio_chat"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cookieStore = await cookies();
  const { key, user } = await geminiBurstKey(cookieStore as CookieStore);
  const perMin = user
    ? parsePositiveInt(process.env.GEMINI_ACTIONS_PER_MINUTE, 36, 120)
    : parsePositiveInt(process.env.GEMINI_ANON_ACTIONS_PER_MINUTE, 24, 60);
  const r = takeToken(`gemini:${kind}:${key}`, perMin, 60_000);
  if (!r.ok) {
    return {
      ok: false,
      error: `요청이 너무 잦습니다. ${r.retryAfterSec}초 후 다시 시도해 주세요.`,
    };
  }
  return { ok: true };
}

/** 트렌드 레이더 Gemini 호출 직전 (IP 기준). */
export async function guardTrendGeminiRateLimit(): Promise<
  { ok: true } | { ok: false }
> {
  const perHour = parsePositiveInt(process.env.GEMINI_TREND_PER_HOUR_PER_IP, 40, 200);
  let ip = "unknown";
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    /* noop */
  }
  const r = takeToken(`gemini:trend:${ip}`, perHour, 3_600_000);
  return r.ok ? { ok: true } : { ok: false };
}
