import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const payload = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8'));
if (process.argv[3] === '--supervise') {
  const child = spawn(payload.filePath, payload.arguments, {
    cwd: payload.workingDirectory,
    env: { ...process.env, ...payload.environment },
    windowsHide: true,
    stdio: 'inherit',
  });
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
const stdout = fs.openSync(payload.stdoutPath, 'a');
const stderr = fs.openSync(payload.stderrPath, 'a');
try {
  const powershell = /^(powershell|pwsh)(\.exe)?$/i.test(basename(payload.filePath));
  const child = spawn(powershell ? process.execPath : payload.filePath,
    powershell ? [fileURLToPath(import.meta.url), process.argv[2], '--supervise'] : payload.arguments, {
    cwd: payload.workingDirectory,
    env: { ...process.env, ...payload.environment },
    // PowerShell needs a surviving console parent; a detached Node supervisor
    // owns that lifetime without keeping the short launcher open.
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdout, stderr],
  });
  child.unref();
  process.stdout.write(JSON.stringify({ Id: child.pid }));
} finally {
  fs.closeSync(stdout);
  fs.closeSync(stderr);
}
}
