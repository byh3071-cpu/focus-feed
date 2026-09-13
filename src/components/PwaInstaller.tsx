"use client";

import { useEffect } from "react";
import { rewriteBindAddressLocation } from "@/lib/oauth-redirect";

export default function PwaInstaller() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (rewriteBindAddressLocation()) return;
    if (!("serviceWorker" in navigator)) return;

    // 개발 환경에서는 서비스워커를 등록하지 않는다.
    // sw.js 가 /_next/static 청크를 cache-first 로 캐싱하는데, dev 빌드는 URL 이 비교적 고정이라
    // 새로 추가한 Tailwind 유틸(예: bg-purple-600)이 옛 CSS 청크에 없어 "스타일 없는 흰 버튼"으로 보이는 등
    // 변경이 반영되지 않는 stale 문제가 생긴다. 그래서 dev 에서는 등록을 막고,
    // 이미 등록돼 있던 SW 와 캐시를 정리해 다음 로드부터 항상 최신 자산을 받게 한다.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then(async (regs) => {
          await Promise.all(regs.map((r) => r.unregister()));
          // 캐시 삭제까지 await 한 뒤 reload — reload 시점에 stale 자산이 확실히 비워져 있도록 순차 보장(SW unregister → cache 삭제 → reload).
          if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
          // stale SW 가 실제로 있었을 때만(regs.length > 0) 이번 세션에서 즉시 정리된 자산을 받도록 1회 강제 새로고침.
          // 무한 루프 방지: sessionStorage 플래그를 reload 전에 세팅하고, 이미 세팅돼 있으면 reload 하지 않는다.
          if (regs.length > 0 && sessionStorage.getItem("ff_dev_sw_cleaned") === null) {
            sessionStorage.setItem("ff_dev_sw_cleaned", "1");
            location.reload();
          }
        })
        .catch(() => {});
      return;
    }

    // 프로덕션: 정상 등록. updateViaCache:"none" — sw.js 자체가 HTTP 캐시에 묶여 새 배포가 늦게 반영되는 것 방지.
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      } catch (e) {
        console.error("[PWA] service worker register failed", e);
      }
    };

    register();
  }, []);

  return null;
}
