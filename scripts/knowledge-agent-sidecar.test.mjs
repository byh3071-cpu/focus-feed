import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";

let child;
let base;
beforeAll(async () => {
  const reservation = createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["scripts/knowledge-agent-sidecar.mjs"], {
    env: { ...process.env, PATH: "", Path: "", KNOWLEDGE_AGENT_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sidecar did not start")), 8000);
    child.once("error", reject);
    child.stdout.on("data", (data) => {
      if (String(data).includes("knowledge agent sidecar")) { clearTimeout(timer); resolve(); }
    });
  });
});
afterAll(async () => {
  if (child && child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; }
});

it.each([undefined, "https://evil.example", "null"])("rejects POST origin %s before parsing the body", async (origin) => {
  const headers = { "content-type": "text/plain" };
  if (origin) headers.origin = origin;
  const response = await fetch(`${base}/chat`, { method: "POST", headers, body: "{}" });
  expect(response.status).toBe(403);
});
it("requires JSON even from an allowed origin", async () => {
  const response = await fetch(`${base}/chat`, { method: "POST", headers: {
    origin: "http://localhost:3000", "content-type": "text/plain",
  }, body: "{}" });
  expect(response.status).toBe(415);
});
it("accepts JSON transport and reaches request validation", async () => {
  const response = await fetch(`${base}/chat`, { method: "POST", headers: {
    origin: "http://localhost:3000", "content-type": "application/json; charset=utf-8",
  }, body: "{}" });
  expect(response.status).toBe(400);
});
it.each(["x&echo INJECTED", "x|echo nope", "--help", "x\nother", "x".repeat(129), 42])("rejects invalid session %s", async (sessionId) => {
  const response = await fetch(`${base}/chat`, { method: "POST", headers: {
    origin: "http://localhost:3000", "content-type": "application/json",
  }, body: JSON.stringify({ provider: "claude", jobId: "123e4567-e89b-42d3-a456-426614174000", prompt: "test", sessionId }) });
  expect(response.status).toBe(400);
});
it.each([undefined, "https://evil.example"])("rejects WebSocket origin %s", async (origin) => {
  const socket = new WebSocket(base.replace("http:", "ws:") + "/ws", { origin });
  await new Promise((resolve, reject) => {
    socket.once("error", resolve);
    socket.once("open", () => { socket.close(); reject(new Error("untrusted connection opened")); });
  });
});
it("accepts a trusted WebSocket and validates messages", async () => {
  const socket = new WebSocket(base.replace("http:", "ws:") + "/ws", { origin: "http://localhost:3000" });
  await once(socket, "open");
  const received = once(socket, "message");
  socket.send("{}");
  const [raw] = await received;
  expect(JSON.parse(String(raw)).type).toBe("error");
  socket.close();
});
