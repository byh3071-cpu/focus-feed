"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { oauthSuccessUrl, sanitizeOAuthNext } from "@/lib/oauth-redirect";

/**
 * 서버 콜백에서 PKCE code_verifier를 읽지 못해 "Unable to exchange external code"가 났을 때
 * 브라우저(같은 기기)에서 코드 교환을 시도하는 폴백 페이지.
 */
function AuthCallbackClientContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"exchanging" | "success" | "error">("exchanging");

  useEffect(() => {
    const code = searchParams.get("code");
    const next = sanitizeOAuthNext(searchParams.get("next"));

    if (!code) {
      router.replace("/?auth_error=no_code");
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          setStatus("error");
          router.replace("/?auth_error=no_supabase");
          return;
        }
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;
        if (error) {
          console.error("Client auth exchange error:", error.message);
          setStatus("error");
          router.replace(`/?auth_error=exchange&auth_error_hint=${encodeURIComponent(error.message)}`);
          return;
        }
        setStatus("success");
        window.location.replace(oauthSuccessUrl(window.location.origin, next));
      } catch (e) {
        if (!mounted) return;
        console.error("Client auth exchange exception:", e);
        setStatus("error");
        router.replace("/?auth_error=exchange");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [searchParams, router]);

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-(--notion-fg)/70">
        로그인 처리에 실패했습니다. 메인으로 이동 중…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 text-sm text-(--notion-fg)/70">
      로그인 처리 중…
    </div>
  );
}

export default function AuthCallbackClientPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-(--notion-fg)/70">
        로그인 확인 중…
      </div>
    }>
      <AuthCallbackClientContent />
    </Suspense>
  );
}
