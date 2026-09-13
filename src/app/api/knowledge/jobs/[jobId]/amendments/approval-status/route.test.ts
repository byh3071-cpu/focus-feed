import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), read: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/supabase-server-cookies", () => ({ getCurrentUserFromCookies: mocks.user }));
vi.mock("@/lib/knowledge-brain-status", () => ({ readBrainApprovalStatus: mocks.read }));
import { GET } from "./route";
const job = "11111111-1111-4111-8111-111111111111";
const call = () => GET(new Request("http://localhost"), { params: Promise.resolve({ jobId: job }) });
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); mocks.user.mockResolvedValue({ id: "owner" }); });
it("requires login before invoking the local reader", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("reports disconnected configuration without claiming unapproved", async () => {
  vi.stubEnv("FOCUS_FEED_BRAIN_ROOT", "");
  expect((await call()).status).toBe(503);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("binds lookup to the authenticated owner and hides subprocess errors", async () => {
  vi.stubEnv("FOCUS_FEED_BRAIN_ROOT", "C:/brain");
  mocks.read.mockRejectedValue(new Error("secret local path"));
  const response = await call();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret local path");
  expect(mocks.read).toHaveBeenCalledWith(job, "owner", "C:/brain");
});
