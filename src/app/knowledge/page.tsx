import { Suspense } from "react";
import type { Metadata } from "next";
import KnowledgeQueueClient from "./KnowledgeQueueClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "지식함 — Focus Feed",
  robots: { index: false },
};

export default function KnowledgePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center text-sm text-(--text-secondary)">불러오는 중</div>
    }>
      <KnowledgeQueueClient />
    </Suspense>
  );
}
