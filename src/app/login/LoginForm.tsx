"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  oauthAuthorizeUrlReturnsToOrigin,
  oauthCallbackUrl,
  rememberOAuthNext,
  sanitizeOAuthNext,
} from "@/lib/oauth-redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeNext = sanitizeOAuthNext(next);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        router.replace(safeNext);
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, safeNext]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const origin = window.location.origin;
      rememberOAuthNext(safeNext);
      const redirectTo = oauthCallbackUrl(origin);
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        return;
      }
      if (!data.url) {
        setError("로그인 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (!oauthAuthorizeUrlReturnsToOrigin(data.url, origin)) {
        setError(
          `구글 로그인 후 ${origin} 으로 돌아오지 않습니다. Supabase Redirect URLs에 ${redirectTo} 를 추가하세요.`,
        );
        return;
      }
      window.location.assign(data.url);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
      type="button"
      onClick={handleGoogleLogin}
      disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-full border border-(--notion-border) bg-(--notion-bg) py-3 px-4 text-sm font-medium text-(--notion-fg) hover:bg-(--notion-hover) disabled:opacity-60"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      {loading ? "연결 중…" : "Google로 로그인"}
      </button>
      {error ? (
        <p className="mt-3 text-center text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
