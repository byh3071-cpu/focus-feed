export type UsageVersion = {
  kind: "original" | "amendment";
  revision: number;
  amendmentId: string | null;
  bodySha256: string;
};

export type UsageContextLink = {
  kind: "project" | "question" | "document";
  ref: string;
  label?: string;
};

export type UsageContent = { savedReason: string; links: UsageContextLink[] };
export type UsageContextRecord = UsageContent & { revision: number; updatedAt: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const TEXT_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string" || CONTROL.test(value) || value !== value.trim() || value.length > max) return null;
  if (!allowEmpty && value.length === 0) return null;
  return value;
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === "string" && !TEXT_CONTROL.test(value) && value.length <= max ? value : null;
}

export function isUsageContextUuid(value: string): boolean { return UUID.test(value); }

export function parseUsageVersion(value: unknown): UsageVersion {
  const item = record(value);
  if (!item || !exactKeys(item, ["kind", "revision", "amendmentId", "bodySha256"])) throw new Error("invalid usage context version");
  if (item.kind !== "original" && item.kind !== "amendment") throw new Error("invalid usage context version");
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1) throw new Error("invalid usage context version");
  if (typeof item.bodySha256 !== "string" || !SHA256.test(item.bodySha256)) throw new Error("invalid usage context version");
  if (item.kind === "original" ? item.amendmentId !== null : typeof item.amendmentId !== "string" || !UUID.test(item.amendmentId)) throw new Error("invalid usage context version");
  return { kind: item.kind, revision: item.revision as number, amendmentId: item.amendmentId as string | null, bodySha256: item.bodySha256 };
}

function parseLink(value: unknown): UsageContextLink | null {
  const item = record(value);
  if (!item || !exactKeys(item, ["kind", "ref"], ["label"])) return null;
  if (!['project', 'question', 'document'].includes(item.kind as string)) return null;
  const ref = boundedString(item.ref, 500);
  const label = item.label === undefined ? undefined : boundedString(item.label, 120);
  if (!ref || (item.label !== undefined && !label)) return null;
  if (item.kind === "document") {
    try {
      const url = new URL(ref);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    } catch { return null; }
  }
  return { kind: item.kind as UsageContextLink['kind'], ref, ...(label ? { label } : {}) };
}

export function parseUsageContent(value: unknown): UsageContent {
  const item = record(value);
  if (!item || !exactKeys(item, ["savedReason", "links"])) throw new Error("invalid usage context content");
  const savedReason = boundedText(item.savedReason, 2_000);
  if (savedReason === null || !Array.isArray(item.links) || item.links.length > 8) throw new Error("invalid usage context content");
  const links = item.links.map(parseLink);
  if (links.some((link) => !link)) throw new Error("invalid usage context content");
  return { savedReason, links: links as UsageContextLink[] };
}

export function parseUsageContextRecord(value: unknown): UsageContextRecord {
  const item = record(value);
  if (!item || !exactKeys(item, ["revision", "updatedAt", "savedReason", "links"])) throw new Error("invalid usage context record");
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1) throw new Error("invalid usage context record");
  if (typeof item.updatedAt !== "string" || CONTROL.test(item.updatedAt) || new Date(item.updatedAt).toISOString() !== item.updatedAt) throw new Error("invalid usage context record");
  const content = parseUsageContent({ savedReason: item.savedReason, links: item.links });
  return { revision: item.revision as number, updatedAt: item.updatedAt, ...content };
}
