#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin } from "node:process";

const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STUDIO_MARKDOWN_CHARS = 80_000;
const STUDIO_SELECT = "id, user_id, title, status, result";
const STATUS_LABELS = {
  queued: "담김",
  processing: "처리 중",
  review_required: "검토 필요",
  approving: "승인 적재 중",
  completed: "적재됨",
  action_required: "조치 필요",
  failed: "처리 실패",
  cancelled: "처리 취소",
};

const USAGE = [
  "Usage:",
  "  npm run knowledge:draft -- get <jobId> [--markdown]",
  "  npm run knowledge:draft -- patch <jobId> --file <path.md> [--revision N]",
  "",
  "Reads/writes result.studio_draft only. Never writes Brain files or calls approval RPCs.",
  "Auth: FOCUS_FEED_COOKIE + running app, or local SUPABASE_SERVICE_ROLE_KEY.",
].join("\n");

function loadDotEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgv(argv) {
  const args = argv.filter((part) => part !== "--");
  const action = args[0];
  if (action !== "get" && action !== "patch") {
    return { ok: false, error: USAGE };
  }
  const jobId = args[1] ?? "";
  if (!JOB_ID_PATTERN.test(jobId)) {
    return { ok: false, error: "검토 항목 ID가 올바르지 않아요." };
  }

  let markdownOnly = false;
  let filePath = null;
  let expectedRevision = null;

  for (let index = 2; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--markdown") {
      markdownOnly = true;
      continue;
    }
    if (flag === "--file" || flag === "-f") {
      filePath = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (flag === "--revision") {
      const parsed = Number(args[index + 1]);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, error: "revision이 올바르지 않아요." };
      }
      expectedRevision = parsed;
      index += 1;
      continue;
    }
    return { ok: false, error: `알 수 없는 옵션: ${flag}` };
  }

  if (action === "get") {
    if (filePath !== null || expectedRevision !== null) {
      return { ok: false, error: "get은 --file/--revision을 쓰지 않아요." };
    }
    return { ok: true, action: "get", jobId, markdownOnly };
  }
  if (!filePath) {
    return { ok: false, error: "patch는 --file <path.md>가 필요해요. 표준 입력은 --file -" };
  }
  if (markdownOnly) {
    return { ok: false, error: "patch는 --markdown을 쓰지 않아요." };
  }
  return { ok: true, action: "patch", jobId, filePath, expectedRevision };
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function studioDraftFromResult(result) {
  const record = asRecord(result);
  const draft = asRecord(record?.studio_draft);
  if (!draft || typeof draft.markdown !== "string" || !draft.markdown.trim()) return null;
  if (!Number.isInteger(draft.revision) || draft.revision < 1) return null;
  return {
    markdown: draft.markdown,
    revision: draft.revision,
    updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : null,
  };
}

function seedMarkdown(title, result) {
  const heading = String(title ?? "").trim() || "제목 없음";
  const draft = asRecord(asRecord(result)?.draft);
  const summary = typeof draft?.summary === "string" ? draft.summary.trim() : "";
  return summary ? `# ${heading}\n\n${summary}\n` : `# ${heading}\n`;
}

function publicView(input) {
  return {
    jobId: input.jobId,
    revision: input.revision,
    status: input.status,
    statusLabel: input.statusLabel,
    markdown: input.markdown,
    updatedAt: input.updatedAt,
    seeded: input.seeded === true,
  };
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

function applyStudioDraftPatch(result, markdown, expectedRevision, now = new Date()) {
  if (typeof markdown !== "string" || !markdown.trim() || markdown.length > MAX_STUDIO_MARKDOWN_CHARS) {
    return { ok: false, code: "invalid" };
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, code: "invalid" };
  }
  const current = studioDraftFromResult(result);
  const currentRevision = current?.revision ?? 0;
  if (expectedRevision !== currentRevision) {
    return { ok: false, code: "conflict" };
  }
  const draft = {
    markdown,
    revision: currentRevision + 1,
    updatedAt: now.toISOString(),
  };
  const base = asRecord(result) ?? {};
  return { ok: true, result: { ...base, studio_draft: draft }, draft };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readMarkdown(filePath) {
  if (filePath === "-") return readStdin();
  const absolute = resolve(process.cwd(), filePath);
  if (!existsSync(absolute)) fail(`파일을 찾지 못했어요: ${filePath}`);
  return readFileSync(absolute, "utf8");
}

function printView(view, markdownOnly) {
  if (markdownOnly) {
    process.stdout.write(view.markdown.endsWith("\n") ? view.markdown : `${view.markdown}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
}

function studioUrl(origin, jobId) {
  return `${origin.replace(/\/$/, "")}/api/knowledge/jobs/${encodeURIComponent(jobId)}/studio`;
}

async function viaHttp(command, origin, cookie) {
  const headers = {
    cookie,
    accept: "application/json",
  };
  const getResponse = await fetch(studioUrl(origin, command.jobId), { headers });
  const getBody = await getResponse.json().catch(() => null);
  if (getResponse.status === 401) fail("로그인 쿠키가 없거나 만료됐어요. FOCUS_FEED_COOKIE를 확인해 주세요.");
  if (!getResponse.ok || !getBody?.job) {
    fail(getBody?.error ?? `작업실을 불러오지 못했어요. (${getResponse.status})`);
  }

  const draft = getBody.studioDraft;
  const current = {
    jobId: command.jobId,
    revision: Number.isInteger(draft?.revision) ? draft.revision : 0,
    status: getBody.job.status,
    statusLabel: getBody.statusLabel ?? statusLabel(getBody.job.status),
    markdown: typeof draft?.markdown === "string" ? draft.markdown : "",
    updatedAt: typeof draft?.updatedAt === "string" ? draft.updatedAt : null,
    seeded: draft?.seeded === true,
  };

  if (command.action === "get") {
    if (!current.markdown) fail("아직 작업실에서 고칠 초안이 없어요.");
    printView(publicView(current), command.markdownOnly);
    return;
  }

  if (getBody.job.status !== "review_required") {
    fail("지금은 초안을 고칠 수 없어요.");
  }
  const markdown = await readMarkdown(command.filePath);
  const expectedRevision = command.expectedRevision ?? current.revision;
  const patchResponse = await fetch(studioUrl(origin, command.jobId), {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ markdown, expectedRevision }),
  });
  const patchBody = await patchResponse.json().catch(() => null);
  if (!patchResponse.ok || !patchBody?.studioDraft) {
    fail(patchBody?.error ?? `초안을 저장하지 못했어요. (${patchResponse.status})`);
  }
  printView(publicView({
    jobId: command.jobId,
    revision: patchBody.studioDraft.revision,
    status: "review_required",
    statusLabel: statusLabel("review_required"),
    markdown: patchBody.studioDraft.markdown,
    updatedAt: patchBody.studioDraft.updatedAt ?? null,
    seeded: false,
  }), false);
}

function createServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || url.startsWith("your_") || serviceKey.startsWith("your_")) {
    return null;
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function ownerUserId() {
  return process.env.FOCUS_FEED_DRAFT_OWNER_USER_ID
    || process.env.KNOWLEDGE_CANARY_OWNER_USER_ID
    || "";
}

async function loadJobRow(supabase, jobId) {
  let query = supabase.from("knowledge_jobs").select(STUDIO_SELECT).eq("id", jobId);
  const owner = ownerUserId();
  if (JOB_ID_PATTERN.test(owner)) query = query.eq("user_id", owner);
  const { data, error } = await query.maybeSingle();
  if (error) fail("작업실을 불러오지 못했어요.");
  if (!data) fail("검토 항목을 찾지 못했어요.");
  return data;
}

function viewFromRow(row) {
  const stored = studioDraftFromResult(row.result);
  if (stored) {
    return publicView({
      jobId: row.id,
      revision: stored.revision,
      status: row.status,
      statusLabel: statusLabel(row.status),
      markdown: stored.markdown,
      updatedAt: stored.updatedAt,
      seeded: false,
    });
  }
  return publicView({
    jobId: row.id,
    revision: 0,
    status: row.status,
    statusLabel: statusLabel(row.status),
    markdown: seedMarkdown(row.title, row.result),
    updatedAt: null,
    seeded: true,
  });
}

async function viaDatabase(command, supabase) {
  const row = await loadJobRow(supabase, command.jobId);
  if (command.action === "get") {
    printView(viewFromRow(row), command.markdownOnly);
    return;
  }
  if (row.status !== "review_required") fail("지금은 초안을 고칠 수 없어요.");
  const markdown = await readMarkdown(command.filePath);
  const current = viewFromRow(row);
  const expectedRevision = command.expectedRevision ?? current.revision;
  const applied = applyStudioDraftPatch(row.result, markdown, expectedRevision);
  if (!applied.ok) {
    if (applied.code === "conflict") fail("다른 곳에서 초안이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.");
    fail("저장할 초안이 올바르지 않아요.");
  }
  const { data, error } = await supabase.rpc("patch_knowledge_studio_draft", {
    p_user_id: row.user_id,
    p_job_id: row.id,
    p_expected_result: row.result,
    p_result: applied.result,
  });
  if (error?.code === "PGRST202" || error?.code === "42883") {
    fail("작업실 저장 연결이 아직 준비되지 않았어요.");
  }
  if (error) fail("초안을 저장하지 못했어요.");
  if (!data) fail("초안이나 승인 상태가 바뀌었어요. 다시 불러온 뒤 저장해 주세요.");
  printView(publicView({
    jobId: row.id,
    revision: applied.draft.revision,
    status: "review_required",
    statusLabel: statusLabel("review_required"),
    markdown: applied.draft.markdown,
    updatedAt: applied.draft.updatedAt,
    seeded: false,
  }), false);
}

const command = parseArgv(process.argv.slice(2));
if (!command.ok) fail(command.error);

loadDotEnvLocal();

const origin = process.env.FOCUS_FEED_ORIGIN || "http://127.0.0.1:3000";
const cookie = process.env.FOCUS_FEED_COOKIE || "";
const supabase = cookie ? null : createServiceClient();

if (cookie) {
  await viaHttp(command, origin, cookie);
} else if (supabase) {
  await viaDatabase(command, supabase);
} else {
  fail("FOCUS_FEED_COOKIE(실행 중인 앱) 또는 로컬 SUPABASE_SERVICE_ROLE_KEY가 필요해요.");
}
