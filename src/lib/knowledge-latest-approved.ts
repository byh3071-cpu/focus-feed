import { createHash } from "node:crypto";

import {
  readBrainApprovalStatus,
  type BrainApprovalStatus,
} from "@/lib/knowledge-brain-status";
import type { ApprovedKnowledgeSnapshot } from "./knowledge-approved";

const AMENDMENT_METADATA_SELECT = "id, user_id, job_id, amendment_revision, base_revision, base_intent_hash, created_at";
const AMENDMENT_BODY_SELECT = `${AMENDMENT_METADATA_SELECT}, markdown`;
const MAX_AMENDMENT_METADATA = 20_000;
const STATUS_CONCURRENCY = 4;
const VERIFICATION_BUDGET_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

interface AmendmentRow {
  id: string;
  userId: string;
  jobId: string;
  revision: number;
  baseRevision: number;
  baseIntentHash: string;
  markdown?: string;
}

interface AmendmentQueryResult {
  data: unknown[] | null;
  error: { message?: string | null } | null;
  count?: number | null;
}

interface AmendmentQuery {
  eq(column: string, value: string): AmendmentQuery;
  in(column: string, values: string[]): AmendmentQuery;
  limit(value: number): PromiseLike<AmendmentQueryResult>;
}

interface AmendmentTable {
  select(columns: string, options?: { count: "exact" }): AmendmentQuery;
}

interface AmendmentClient {
  from(table: "knowledge_amendments"): AmendmentTable;
}

export type ApprovedKnowledgeVersionScope = "original-only" | "brain-verified";

export type LatestApprovedKnowledgeSnapshot = ApprovedKnowledgeSnapshot & {
  amendmentId?: string;
  baseRevision?: number;
  versionScope: ApprovedKnowledgeVersionScope;
};

export class LatestApprovedKnowledgeUnavailableError extends Error {
  constructor() {
    super("Latest approved knowledge unavailable");
    this.name = "LatestApprovedKnowledgeUnavailableError";
  }
}

function parseAmendment(value: unknown, requireMarkdown = false): AmendmentRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" || !UUID.test(row.id)
    || typeof row.user_id !== "string" || !UUID.test(row.user_id)
    || typeof row.job_id !== "string" || !UUID.test(row.job_id)
    || !Number.isSafeInteger(row.amendment_revision) || Number(row.amendment_revision) < 1
    || !Number.isSafeInteger(row.base_revision) || Number(row.base_revision) < 1
    || typeof row.base_intent_hash !== "string" || !SHA256.test(row.base_intent_hash)
    || (requireMarkdown && (typeof row.markdown !== "string" || !row.markdown.trim()))
    || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
  ) return null;
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    revision: Number(row.amendment_revision),
    baseRevision: Number(row.base_revision),
    baseIntentHash: row.base_intent_hash,
    ...(typeof row.markdown === "string" ? { markdown: row.markdown } : {}),
  };
}

async function beforeDeadline<T>(operation: PromiseLike<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new LatestApprovedKnowledgeUnavailableError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new LatestApprovedKnowledgeUnavailableError()), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapConcurrent<T, R>(values: T[], limit: number, deadline: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && cursor < values.length) {
      if (Date.now() >= deadline) throw new LatestApprovedKnowledgeUnavailableError();
      const index = cursor++;
      try {
        output[index] = await beforeDeadline(mapper(values[index]), deadline);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

export async function resolveLatestApprovedKnowledge(options: {
  snapshots: ApprovedKnowledgeSnapshot[];
  userId: string;
  brainRoot: string | undefined;
  supabase: unknown;
  readStatus?: (jobId: string, ownerUserId: string, root: string) => Promise<BrainApprovalStatus>;
}): Promise<LatestApprovedKnowledgeSnapshot[]> {
  const { snapshots, userId, brainRoot, readStatus = readBrainApprovalStatus } = options;
  const supabase = options.supabase as AmendmentClient;
  if (!brainRoot) return snapshots.map((snapshot) => ({ ...snapshot, versionScope: "original-only" }));
  if (snapshots.length === 0) return [];

  try {
    const deadline = Date.now() + VERIFICATION_BUDGET_MS;
    const result = await beforeDeadline(supabase.from("knowledge_amendments")
      .select(AMENDMENT_METADATA_SELECT, { count: "exact" })
      .eq("user_id", userId)
      .in("job_id", snapshots.map((snapshot) => snapshot.id))
      .limit(MAX_AMENDMENT_METADATA + 1), deadline);
    if (
      result.error || !Array.isArray(result.data)
      || !Number.isSafeInteger(result.count) || Number(result.count) !== result.data.length
      || result.data.length > MAX_AMENDMENT_METADATA
    ) {
      throw new LatestApprovedKnowledgeUnavailableError();
    }

    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const byJob = new Map<string, AmendmentRow[]>();
    const seenIds = new Set<string>();
    const seenRevisions = new Set<string>();
    for (const value of result.data) {
      const row = parseAmendment(value);
      const base = row ? snapshotById.get(row.jobId) : undefined;
      const revisionKey = row ? `${row.jobId}:${row.revision}` : "";
      if (
        !row || !base || row.userId !== userId
        || row.baseRevision !== base.revision
        || row.baseIntentHash !== base.approvalIntentHash
        || seenIds.has(row.id) || seenRevisions.has(revisionKey)
      ) throw new LatestApprovedKnowledgeUnavailableError();
      seenIds.add(row.id);
      seenRevisions.add(revisionKey);
      const rows = byJob.get(row.jobId) ?? [];
      rows.push(row);
      byJob.set(row.jobId, rows);
    }
    const statuses = await mapConcurrent([...byJob.keys()], STATUS_CONCURRENCY, deadline, (jobId) => readStatus(jobId, userId, brainRoot));
    const statusByJob = new Map(statuses.map((status) => [status.jobId, status]));

    const approvedIds = statuses.flatMap((status) => status.latestApproved ? [status.latestApproved.id] : []);
    const approvedBodies = new Map<string, AmendmentRow>();
    if (approvedIds.length > 0) {
      const bodyResult = await beforeDeadline(supabase.from("knowledge_amendments")
        .select(AMENDMENT_BODY_SELECT)
        .eq("user_id", userId)
        .in("id", approvedIds)
        .limit(approvedIds.length + 1), deadline);
      if (bodyResult.error || !Array.isArray(bodyResult.data) || bodyResult.data.length !== approvedIds.length) {
        throw new LatestApprovedKnowledgeUnavailableError();
      }
      for (const value of bodyResult.data) {
        const row = parseAmendment(value, true);
        if (!row || approvedBodies.has(row.id)) throw new LatestApprovedKnowledgeUnavailableError();
        approvedBodies.set(row.id, row);
      }
    }

    return snapshots.map((base) => {
      const candidates = byJob.get(base.id);
      if (!candidates) return { ...base, versionScope: "brain-verified" };
      const status = statusByJob.get(base.id);
      if (!status || status.jobId !== base.id) throw new LatestApprovedKnowledgeUnavailableError();
      if (!status.latestApproved) return { ...base, versionScope: "brain-verified" };
      const metadata = candidates.find((row) => row.id === status.latestApproved!.id && row.revision === status.latestApproved!.revision);
      const candidate = approvedBodies.get(status.latestApproved.id);
      if (!candidate || !status.latestApproved.approvedAt) throw new LatestApprovedKnowledgeUnavailableError();
      if (
        !metadata || candidate.userId !== userId || candidate.jobId !== base.id
        || candidate.id !== metadata.id || candidate.revision !== metadata.revision
        || candidate.baseRevision !== metadata.baseRevision || candidate.baseIntentHash !== metadata.baseIntentHash
      ) throw new LatestApprovedKnowledgeUnavailableError();
      const digest = createHash("sha256").update(candidate.markdown!, "utf8").digest("hex");
      if (digest !== status.latestApproved.bodySha256) throw new LatestApprovedKnowledgeUnavailableError();
      return {
        ...base,
        markdown: candidate.markdown!,
        revision: candidate.revision,
        approvedAt: status.latestApproved.approvedAt,
        amendmentId: candidate.id,
        baseRevision: candidate.baseRevision,
        versionScope: "brain-verified",
      };
    });
  } catch (error) {
    if (error instanceof LatestApprovedKnowledgeUnavailableError) throw error;
    throw new LatestApprovedKnowledgeUnavailableError();
  }
}
