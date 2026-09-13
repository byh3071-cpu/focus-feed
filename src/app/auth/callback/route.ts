import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  clearOAuthNextCookieOptions,
  OAUTH_NEXT_COOKIE,
  oauthNextFromRequest,
  oauthSuccessUrl,
  originFromRequest,
} from "@/lib/oauth-redirect";
import type { Database } from "@/lib/supabase-server";

function buildAuthRedirect(origin: string, params: Record<string, string | null | undefined>) {
  const url = new URL(origin);
  const searchParams = url.searchParams;

  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    searchParams.set(key, value);
  });

  url.search = searchParams.toString();
  return NextResponse.redirect(url.toString());
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = originFromRequest(request);
  const cookieStore = await cookies();
  const next = oauthNextFromRequest(
    requestUrl.searchParams.get("next"),
    cookieStore.get(OAUTH_NEXT_COOKIE)?.value,
  );
  const errorFromSupabase = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (process.env.NODE_ENV === "development") {
    console.log("[auth/callback]", {
      hasCode: !!code,
      error: errorFromSupabase ?? null,
      errorDescription: errorDescription ?? null,
      origin,
    });
  }

  if (!code) {
    if (errorFromSupabase) {
      console.error(
        "[auth/callback] Supabase → 앱 리다이렉트 (code 없음):",
        errorFromSupabase,
        errorDescription ?? ""
      );
    }
    const hint = errorDescription || errorFromSupabase || "";
    return buildAuthRedirect(origin, {
      auth_error: "no_code",
      auth_error_hint: hint || null,
    });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("Auth callback: NEXT_PUBLIC_SUPABASE_URL or ANON_KEY missing", {
      hasUrl: !!url,
      hasAnonKey: !!anonKey,
    });
    return buildAuthRedirect(origin, { auth_error: "config" });
  }

  const successUrl = oauthSuccessUrl(origin, next);
  const response = NextResponse.redirect(successUrl);
  response.cookies.set(OAUTH_NEXT_COOKIE, "", clearOAuthNextCookieOptions());

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          const opts = (options ?? {}) as Record<string, unknown>;
          response.cookies.set(name, value, opts);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Auth callback exchangeCodeForSession:", {
      message: error.message,
      name: error.name,
    });
    const useClientFallback =
      error.message.includes("Unable to exchange external code") ||
      error.message.includes("code_verifier");

    if (useClientFallback) {
      const clientCallbackUrl = `${origin}/auth/callback/client?code=${encodeURIComponent(
        code
      )}&next=${encodeURIComponent(next)}`;
      return NextResponse.redirect(clientCallbackUrl);
    }
    return buildAuthRedirect(origin, { auth_error: "exchange" });
  }

  // 쿠키가 브라우저에 확실히 설정될 시간을 더 줌 (최소 800ms 권장)
  await new Promise((r) => setTimeout(r, 800));
  return response;
}
