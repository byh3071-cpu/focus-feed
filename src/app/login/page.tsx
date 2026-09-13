import Link from "next/link";
import LoginForm from "./LoginForm";
import { sanitizeOAuthNext } from "@/lib/oauth-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams ?? {};
  const next = sanitizeOAuthNext(params.next);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-(--notion-bg) px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold text-(--notion-fg)">
          Focus Feed
        </Link>
        <div className="rounded-2xl border border-(--notion-border) bg-(--notion-bg) p-8 shadow-sm">
          <h1 className="mb-2 text-center text-lg font-semibold text-(--notion-fg)">
            로그인
          </h1>
          <p className="mb-6 text-center text-sm text-(--notion-fg)/60">
            피드·북마크·지식함을 쓰려면 로그인하세요.
          </p>
          <LoginForm next={next} />
        </div>
        <p className="mt-6 text-center text-sm text-(--notion-fg)/50">
          <Link href="/" className="underline hover:text-(--notion-fg)/70">
            홈으로
          </Link>
          {" · "}
          <Link href="/landing" className="underline hover:text-(--notion-fg)/70">
            소개
          </Link>
        </p>
      </div>
    </main>
  );
}
