import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Resolve supported vendor launchers without passing request arguments through cmd.exe.
export function resolveWindowsCli(command, candidates, exists = existsSync) {
  for (const candidate of candidates) {
    if (/\.exe$/i.test(candidate) && exists(candidate)) return { command: candidate, args: [] };
    if (!/\.cmd$/i.test(candidate)) continue;
    const directory = dirname(candidate);
    const node = join(directory, "node.exe");
    if (command === "claude") {
      const native = join(directory, "node_modules/@anthropic-ai/claude-code/bin/claude.exe");
      if (exists(native)) return { command: native, args: [] };
      const script = join(directory, "node_modules/@anthropic-ai/claude-code/cli.js");
      if (exists(script)) return { command: exists(node) ? node : process.execPath, args: [script] };
    }
    if (command === "codex") {
      const script = join(directory, "node_modules/@openai/codex/bin/codex.js");
      if (exists(script)) return { command: exists(node) ? node : process.execPath, args: [script] };
    }
    if (command === "agent") {
      const script = join(directory, "cursor-agent.ps1");
      if (exists(script)) return {
        command: join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        env: { CURSOR_INVOKED_AS: "agent.cmd" },
      };
    }
  }
  return null;
}

export function findWindowsCli(command) {
  // where.exe output uses the console code page when hidden; PATH keeps Unicode intact.
  const paths = (process.env.PATH ?? process.env.Path ?? "").split(";")
    .map((directory) => directory.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .flatMap((directory) => [join(directory, `${command}.exe`), join(directory, `${command}.cmd`)])
    .filter((candidate) => existsSync(candidate));
  return resolveWindowsCli(command, paths);
}

export function spawnCli(command, args, options = {}) {
  const target = process.platform === "win32" ? findWindowsCli(command) : null;
  return spawn(target?.command ?? command, [...(target?.args ?? []), ...args], {
    ...options,
    env: { ...(options.env ?? process.env), ...target?.env },
    shell: false,
    windowsHide: true,
  });
}
