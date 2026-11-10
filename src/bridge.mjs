import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { threadPattern, trackActivity } from "./activity.mjs";
import { rendererSource } from "./renderer-source.mjs";

const [profile, sessions] = process.argv.slice(2);
if (!profile || !sessions) {
  throw new Error("Usage: node bridge.mjs PROFILE SESSIONS");
}
const openApp = promisify(execFile);
const activity = await trackActivity(sessions);
const clients = new Map();
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function connect(page, port) {
  const url = new URL(page.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" ||
      Number(url.port) !== port || url.pathname !== `/devtools/page/${page.id}`) {
    throw new Error("Unexpected debug target");
  }
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Debug connection timed out")), 1500);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Cannot connect to Codex")); }, { once: true });
    });
  } catch (error) {
    socket.close();
    throw error;
  }
  return { socket, sequence: 0, source: null, displayed: null };
}

async function discover() {
  for (const [id, client] of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) clients.delete(id);
  }
  const port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid debug port");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1000)
  })).json();
  const pages = targets.filter(target => {
    if (target.type !== "page" || !target.webSocketDebuggerUrl) return false;
    const url = new URL(target.url);
    if (url.protocol !== "app:" || url.hostname !== "-") return false;
    if (url.pathname === "/detached-window.html") return true;
    return url.pathname === "/index.html" && !url.searchParams.has("initialRoute");
  });
  const ids = new Set(pages.map(page => page.id));
  for (const [id, client] of clients) {
    if (ids.has(id) && client.socket.readyState === WebSocket.OPEN) continue;
    client.socket.close();
    clients.delete(id);
  }
  for (const page of pages) {
    if (!clients.has(page.id)) clients.set(page.id, await connect(page, port));
  }
  if (!clients.size) throw new Error("Waiting for a Codex window");
}

async function evaluate(client, expression) {
  const { socket } = client;
  const id = ++client.sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", receive);
      reject(new Error("Renderer did not respond"));
    }, 1500);
    function receive({ data }) {
      const response = JSON.parse(data);
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
      if (response.error || response.result?.exceptionDetails) reject(new Error("Renderer evaluation failed"));
      else resolve(response.result.result.value);
    }
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}

async function show(client, source, items) {
  if (source !== client.source || !await evaluate(client, "Boolean(window.codexWorkshop)")) {
    await evaluate(client, `{ const source = ${JSON.stringify(source)}; new Function(source);
      window.codexWorkshop?.destroy(); (0, eval)(source); }`);
    client.source = source;
    client.displayed = null;
  }
  const value = JSON.stringify(items);
  if (value !== client.displayed) {
    await evaluate(client, `window.codexWorkshop.render(${value})`);
    client.displayed = value;
  }
  const clicks = await evaluate(client, "window.codexWorkshop.takeClicks()");
  for (const id of clicks) {
    if (!threadPattern.test(id) || !items.some(item => item.id === id)) continue;
    await openApp("/usr/bin/open", ["-a", "/Applications/ChatGPT.app", `codex://threads/${id}`]);
  }
}

const started = Date.now();
let connected = false;
let discoverAfter = 0;
let lastError;
try {
  while (!stopping) {
    try {
      if (Date.now() >= discoverAfter) {
        discoverAfter = Date.now() + 1500;
        await discover();
        connected = true;
      }
      const [source, items] = await Promise.all([rendererSource(), activity.read()]);
      const results = await Promise.allSettled([...clients.values()].map(client => show(client, source, items)));
      const failure = results.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
      lastError = undefined;
    } catch (error) {
      if (lastError !== error.message) console.error(error.message);
      lastError = error.message;
      if ((!connected && Date.now() - started > 45_000) || (connected && !clients.size)) break;
    }
    await delay(180);
  }
} finally {
  activity.close();
  await Promise.all([...clients.values()].map(async client => {
    if (client.socket.readyState === WebSocket.OPEN) {
      await evaluate(client, "window.codexWorkshop?.destroy()").catch(() => {});
    }
    client.socket.close();
  }));
}
