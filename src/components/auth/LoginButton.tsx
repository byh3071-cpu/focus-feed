"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  oauthAuthorizeUrlReturnsToOrigin,
  oauthCallbackUrl,
  rememberOAuthNext,
} from "@/lib/oauth-redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

interface UserInfo {
  email?: string;
}

export function LoginButton() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [supabaseReady, setSupabaseReady] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setSupabaseReady(false);
      setLoading(false);
      return;
    }
    let mounted = true;

    async function checkSession() {
      if (!supabase) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted) {
          setUser(session?.user ? { email: session.user.email ?? undefined } : null);
        }
      } catch (err) {
        console.error("LoginButton checkSession error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (mounted) {
        setUser(session?.user ? { email: session.user.email ?? undefined } : null);
        setLoading(false);
        if (event === "SIGNED_OUT") {
          // 다른 탭 로그아웃·세션 만료도 사용자별 client state를 남기지 않는다.
          // Auth 경계에서는 Next client state까지 폐기해야 하므로 hard navigation이 필요하다.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/");
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // 구글 로그인 콜백 직후: URL에 auth_success가 있으면 세션을 강제로 다시 확인
  useEffect(() => {
    if (!searchParams.get("auth_success")) return;
    
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const t = setTimeout(async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) setUser({ email: u.email ?? undefined });
    }, 500);
    
    return () => clearTimeout(t);
  }, [searchParams]);

  const handleLogin = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const origin = window.location.origin;
    rememberOAuthNext(`${window.location.pathname}${window.location.search}`);
    const redirectTo = oauthCallbackUrl(origin);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      console.error("LoginButton signInWithOAuth error:", error);
      return;
    }
    if (!oauthAuthorizeUrlReturnsToOrigin(data.url, origin)) {
      console.error("LoginButton OAuth redirect_to is not this origin", { redirectTo, url: data.url });
      return;
    }
    window.location.assign(data.url);
  };

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("LoginButton signOut error:", error);
      return;
    }
    // 북마크·처리 상태처럼 사용자별 클라이언트 메모리를 다른 계정에 남기지 않는다.
    // Auth 경계에서는 Next client state까지 폐기해야 하므로 hard navigation이 필요하다.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  };

  if (loading) {
    return (
      <button
        data-testid="login-control"
        type="button"
        className="rounded-full bg-(--notion-gray)/30 px-2.5 py-1 text-[11px] text-(--notion-fg)/60"
        disabled
      >
        로그인 확인 중…
      </button>
    );
  }

  if (!supabaseReady) {
    return (
      <button
        data-testid="login-control"
        type="button"
        className="rounded-full bg-(--notion-gray)/20 px-3 py-2 text-[11px] font-medium text-(--notion-fg)/55 min-h-[32px] touch-manipulation whitespace-nowrap"
        disabled
        title="Supabase 환경변수가 설정되지 않아 로그인이 비활성화되어 있습니다."
      >
        로그인(설정 필요)
      </button>
    );
  }

  if (!user) {
    return (
      <button
        data-testid="login-control"
        type="button"
        onClick={handleLogin}
        className="rounded-full bg-(--notion-gray)/30 px-4 py-2 text-[11px] font-medium text-(--notion-fg)/85 transition-colors hover:bg-(--notion-hover) min-h-[44px] sm:min-h-[32px] touch-manipulation whitespace-nowrap"
      >
        Google로 로그인
      </button>
    );
  }

  return (
    <div data-testid="login-control" className="inline-flex items-center gap-2 rounded-full bg-(--notion-gray)/20 pl-2.5 pr-1 py-1 text-[11px] text-(--notion-fg)/85">
      <span className="max-w-[120px] truncate" title={user.email}>
        {user.email ?? "로그인됨"}
      </span>
      <span className="text-(--notion-fg)/40" aria-hidden>|</span>
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-full bg-(--notion-fg) px-3 py-1.5 text-[11px] font-semibold text-(--notion-bg) transition-colors hover:bg-(--notion-fg)/90 min-h-[32px] touch-manipulation whitespace-nowrap leading-none"
      >
        로그아웃
      </button>
    </div>
  );
}

