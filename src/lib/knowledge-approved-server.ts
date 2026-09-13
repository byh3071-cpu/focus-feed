import { createHash } from "node:crypto";
import { parseApprovedKnowledgeSnapshot, type ApprovedKnowledgeSnapshot } from "./knowledge-approved";

export const APPROVED_KNOWLEDGE_SELECT: string = "id, title, source_url, video_id, approval_intent_hash, studio_draft:result->studio_draft, approved_at:result->>approved_at, result_approval_intent_hash:result->>approval_intent_hash";

export function verifyApprovedKnowledge(value: unknown): ApprovedKnowledgeSnapshot | null {
  const snapshot = parseApprovedKnowledgeSnapshot(value);
  if (!snapshot) return null;
  const digest = createHash("sha256").update(`v1\n${snapshot.id}\n${snapshot.revision}\n${snapshot.markdown}`, "utf8").digest("hex");
  return digest === snapshot.approvalIntentHash && digest === snapshot.resultApprovalIntentHash ? snapshot : null;
}
