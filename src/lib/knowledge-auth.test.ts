import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./supabase-server-cookies", () => ({ createServerSupabaseFromCookies: mocks.create }));
import { classifyKnowledgeAuth, getKnowledgeAuth } from "./knowledge-auth";
import { approvedKnowledgeRequestError, KnowledgeLoginRequiredError, knowledgeLoginUrl } from "./knowledge-recovery";

beforeEach(() => vi.resetAllMocks());
describe("knowledge authentication recovery", () => {
  it.each(["bad_jwt", "session_expired", "session_not_found", "refresh_token_not_found", "refresh_token_already_used"])("requires login only for recognized session error %s", (code) => {
    expect(classifyKnowledgeAuth(null, { code, status: 400 })).toEqual({ status: "login_required" });
  });
  it.each([{ status: 503 }, { status: 429 }, { name: "AuthRetryableFetchError" }, new Error("private auth details"), { code: "unknown" }])("keeps outages and unknown errors retryable", (error) => {
    expect(classifyKnowledgeAuth(null, error)).toEqual({ status: "unavailable" });
  });
  it("returns only server-verified user identity", () => {
    expect(classifyKnowledgeAuth({ id: "owner" }, null)).toEqual({ status: "authenticated", user: { id: "owner" } });
    expect(classifyKnowledgeAuth(null, null)).toEqual({ status: "login_required" });
    expect(classifyKnowledgeAuth(null, { name: "AuthSessionMissingError" })).toEqual({ status: "login_required" });
  });
  it("does not treat missing config or thrown network failures as logout", async () => {
    mocks.create.mockReturnValue(null);
    expect(await getKnowledgeAuth({ getAll: () => [] })).toEqual({ status: "unavailable" });
    mocks.create.mockReturnValue({ auth: { getUser: vi.fn().mockRejectedValue(new Error("network")) } });
    expect(await getKnowledgeAuth({ getAll: () => [] })).toEqual({ status: "unavailable" });
  });
  it("builds a local return link and keeps 503 out of the login path", () => {
    const url = new URL(knowledgeLoginUrl("job-id"), "http://127.0.0.1:3000");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/knowledge?job=job-id");
    expect(approvedKnowledgeRequestError(401)).toBeInstanceOf(KnowledgeLoginRequiredError);
    expect(approvedKnowledgeRequestError(503)).not.toBeInstanceOf(KnowledgeLoginRequiredError);
  });
});
