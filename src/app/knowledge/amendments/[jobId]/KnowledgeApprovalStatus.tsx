"use client";

import { useState } from "react";
import type { BrainApprovalStatus } from "@/lib/knowledge-brain-status";
import type { AmendmentDocument } from "@/lib/knowledge-amendments";

export default function KnowledgeApprovalStatus({ jobId, disabled, onBusy, onLoad }: { jobId: string; disabled: boolean; onBusy: (busy: boolean) => void; onLoad: (document: AmendmentDocument) => void }) {
  const [status, setStatus] = useState<BrainApprovalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/api/knowledge/jobs/${encodeURIComponent(jobId)}/amendments`;
  async function check(load: boolean) {
    if (busy || disabled) return;
    setBusy(true); onBusy(true); setError(null); setStatus(null);
    try {
      const response = await fetch(`${endpoint}/approval-status`, { cache: "no-store", signal: AbortSignal.timeout(35_000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "승인 상태를 확인하지 못했어요.");
      const verified = body as BrainApprovalStatus;
      if (verified.jobId !== jobId) throw new Error("승인 문서가 요청과 달라요.");
      const latest = verified.latestApproved;
      if (load && latest) {
        const docResponse = await fetch(`${endpoint}?revision=${latest.revision}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const document = await docResponse.json();
        if (!docResponse.ok || document.current?.id !== latest.id || document.current.revision !== latest.revision || typeof document.current.markdown !== "string") throw new Error("승인된 수정안을 불러오지 못했어요.");
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.current.markdown));
        const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
        if (digest !== latest.bodySha256) throw new Error("승인 확인 후 본문이 달라졌어요. 다시 확인해 주세요.");
        onLoad(document.current);
      }
      setStatus(verified);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Brain에 연결하지 못했어요."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="space-y-2 rounded border border-(--border-subtle) p-3" aria-label="Brain 승인 기록">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-semibold">Brain 승인 기록</h2>
      <button type="button" disabled={disabled || busy} onClick={() => void check(false)} className="min-h-11 rounded border px-3 disabled:opacity-40">{busy ? "확인 중" : "Brain 승인 상태 확인"}</button>
      {status?.latestApproved && <button type="button" disabled={disabled || busy} onClick={() => void check(true)} className="min-h-11 rounded border px-3 disabled:opacity-40">최신 승인본 불러오기</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {!status && !busy && !error && <p className="text-sm">연결된 Brain의 실제 승인 문서를 확인할 수 있어요.</p>}
    {status && <>
      <p role="status">{status.latestApproved ? `최신 승인 수정안 v${status.latestApproved.revision} · ${new Date(status.latestApproved.approvedAt!).toLocaleString("ko-KR")}` : "승인된 수정안이 없어요. 기준 승인본은 유지됩니다."}</p>
      <p className="text-xs">{new Date(status.checkedAt).toLocaleString("ko-KR")} 확인 · 승인 여부는 확인 시점의 기록입니다.</p>
      <p className="text-sm">{status.versions.map(v => `v${v.revision}: ${v.approved ? "승인 완료" : "미승인"}`).join(" · ")}</p>
    </>}
    {disabled && <p className="text-sm">작성 중인 내용을 먼저 저장한 뒤 확인하거나 불러와 주세요.</p>}
  </section>;
}
