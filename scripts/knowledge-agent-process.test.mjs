import { expect, it, vi } from "vitest";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFileSync: vi.fn(() => "") }));
vi.mock("node:child_process", () => mocks);
import { resolveWindowsCli, spawnCli } from "./knowledge-agent-process.mjs";

it("resolves a Node launcher in a path with spaces without interpreting cmd", () => {
  const script = join("C:/test tools", "node_modules/@openai/codex/bin/codex.js");
  const target = resolveWindowsCli("codex", ["C:/test tools/codex.cmd"], (path) => path === script);
  expect(target).toEqual({ command: process.execPath, args: [script] });
});
it("never enables a shell, even when the caller requests it", () => {
  const values = ["left&right", "two words", "a|b", "quote\"value"];
  spawnCli("test-missing-command", values, { shell: true });
  expect(mocks.spawn).toHaveBeenLastCalledWith("test-missing-command", values,
    expect.objectContaining({ shell: false, windowsHide: true }));
});
it("does not interpret unknown cmd wrappers", () => {
  expect(resolveWindowsCli("unknown", ["C:/tools/unknown.cmd"], () => true)).toBeNull();
});
it("resolves Cursor through PowerShell File, never Command", () => {
  const target = resolveWindowsCli("agent", ["C:/tools/agent.cmd"], () => true);
  expect(target.args).toContain("-File");
  expect(target.args).not.toContain("-Command");
});
