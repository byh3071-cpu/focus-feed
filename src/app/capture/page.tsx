import { Suspense } from "react";
import type { Metadata } from "next";
import CaptureDeepLinkClient from "./CaptureDeepLinkClient";

export const metadata: Metadata = {
  title: "지식으로 담기 — Focus Feed",
  robots: { index: false },
};

// 공유 링크는 GET으로 확인 화면만 연다. 실제 접수는 클라이언트의 POST 버튼에서만 일어난다.
export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureDeepLinkClient />
    </Suspense>
  );
}
