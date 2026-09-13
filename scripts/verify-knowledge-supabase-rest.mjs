import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

const p0Tables = ["knowledge_jobs"];
const p1Tables = ["knowledge_process_requests"];
const p0Rpcs = [
  "enqueue_knowledge_job",
  "enrich_knowledge_job",
  "claim_knowledge_jobs",
  "checkpoint_knowledge_job",
  "complete_knowledge_job",
  "begin_knowledge_approval",
  "patch_knowledge_studio_draft",
  "begin_knowledge_studio_approval",
  "complete_knowledge_approval",
  "retry_knowledge_job",
  "invalidate_knowledge_review",
];
const p1Rpcs = [
  "request_knowledge_processing",
  "claim_knowledge_process_request",
  "complete_knowledge_process_request",
];

function keyKind(value) {
  if (!value) return "missing";
  if (value.startsWith("sb_secret_")) return "secret";
  if (value.startsWith("sb_publishable_")) return "publishable";
  if (value.split(".").length === 3) return "legacy-jwt";
  return "unknown";
}

function safeError(error) {
  return String(error?.message ?? error)
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function fail(message, details = {}) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        readOnly: true,
        error: message,
        ...details,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (!url || !serviceKey || !anonKey) {
  fail("Required Supabase environment variables are missing", {
    environment: {
      url: Boolean(url),
      serviceKey: keyKind(serviceKey),
      anonKey: keyKind(anonKey),
    },
  });
}

const serviceKeyKind = keyKind(serviceKey);
const anonKeyKind = keyKind(anonKey);
const projectRef = new URL(url).hostname.split(".")[0] || "unknown";
const schemaKeyRole = serviceKeyKind === "secret" ? "service" : "anon";
const schemaKey = schemaKeyRole === "service" ? serviceKey : anonKey;

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const anonVisibility = {};
for (const table of [...p0Tables, ...p1Tables]) {
  const { data, error } = await anon.from(table).select("id").limit(1);
  if (error) {
    const message = safeError(error);
    anonVisibility[table] = /could not find.*table|schema cache|does not exist/i.test(message)
      ? "missing"
      : `blocked:${message}`;
  } else {
    anonVisibility[table] = Array.isArray(data) && data.length === 0
      ? "zero_rows"
      : `visible_rows:${data?.length ?? "unknown"}`;
  }
}

let openApiResponse;
try {
  openApiResponse = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: {
      Accept: "application/openapi+json, application/json",
      apikey: schemaKey,
    },
  });
} catch (error) {
  fail("Supabase REST preflight request failed", { detail: safeError(error) });
}

let schemaAvailable = openApiResponse.ok;
if (!openApiResponse.ok) {
  const detail = safeError(await openApiResponse.text());
  if (schemaKeyRole === "anon" && openApiResponse.status === 401 && /secret api key required/i.test(detail)) {
    schemaAvailable = false;
  } else {
    fail("Supabase REST preflight was rejected", {
      status: openApiResponse.status,
      detail,
      environment: {
        serviceKey: serviceKeyKind,
        anonKey: anonKeyKind,
        schemaKeyRole,
      },
    });
  }
}

let specification = null;
if (schemaAvailable) {
  try {
    specification = await openApiResponse.json();
  } catch (error) {
    fail("Supabase REST preflight returned invalid OpenAPI JSON", {
      detail: safeError(error),
    });
  }
}

const paths = specification?.paths && typeof specification.paths === "object"
  ? specification.paths
  : {};
const tablePresence = Object.fromEntries(
  [...p0Tables, ...p1Tables].map((name) => [
    name,
    schemaAvailable ? Boolean(paths[`/${name}`]) : anonVisibility[name] !== "missing",
  ]),
);
const rpcPresence = Object.fromEntries(
  [...p0Rpcs, ...p1Rpcs].map((name) => [
    name,
    schemaAvailable ? Boolean(paths[`/rpc/${name}`]) : "unknown",
  ]),
);

const knowledgeJobsExists = tablePresence.knowledge_jobs;
const processRequestsExists = tablePresence.knowledge_process_requests;
const visibleP0Rpcs = schemaKeyRole === "service"
  ? p0Rpcs
  : ["enqueue_knowledge_job", "enrich_knowledge_job"];
const visibleP1Rpcs = schemaKeyRole === "service"
  ? p1Rpcs
  : ["request_knowledge_processing"];
const missingP0Rpcs = schemaAvailable
  ? visibleP0Rpcs.filter((name) => !rpcPresence[name])
  : visibleP0Rpcs;
const p0ContractVerified = schemaKeyRole === "service"
  && schemaAvailable
  && knowledgeJobsExists
  && missingP0Rpcs.length === 0;
const partialP1 = schemaAvailable
  && processRequestsExists
  && visibleP1Rpcs.some((name) => !rpcPresence[name]);

const report = {
  ok: serviceKeyKind === "secret" && p0ContractVerified && !partialP1,
  readOnly: true,
  environment: {
    projectRef,
    serviceKey: serviceKeyKind,
    anonKey: anonKeyKind,
    schemaKeyRole,
  },
  migrationState: !knowledgeJobsExists
    ? "p0-missing"
    : !processRequestsExists
      ? "p0-present-p1-absent"
      : "p0-and-p1-present",
  tables: tablePresence,
  rpcs: rpcPresence,
  anonVisibility,
  serviceContractVerified: p0ContractVerified,
  missingP0Rpcs,
  openApiContractVerified: schemaAvailable,
  requiredAction: serviceKeyKind !== "secret"
    ? "Replace SUPABASE_SERVICE_ROLE_KEY with the current sb_secret_ key before worker or SQL postflight validation."
    : !knowledgeJobsExists
      ? "Apply and verify the P0 knowledge_jobs migrations before release."
      : missingP0Rpcs.length > 0
        ? `Apply the missing P0 RPC migrations: ${missingP0Rpcs.join(", ")}`
        : null,
  caveat: "An anon zero-row result is not proof of RLS. Run the SQL preflight for policies, grants, exact signatures, and legacy overloads.",
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
