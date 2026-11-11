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
const connectionErrors = new Map();
const debuggerTimeout = 45_000;
let debuggerSeenAt = Date.now();
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
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1000)
  });
  if (!response.ok) throw new Error(`Codex debugger returned HTTP ${response.status}`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error("Invalid Codex window list");
  debuggerSeenAt = Date.now();
  const pages = targets.filter(target => {
    if (target.type !== "page" || !target.webSocketDebuggerUrl || !URL.canParse(target.url)) return false;
    const url = new URL(target.url);
    if (url.protocol !== "app:" || url.hostname !== "-") return false;
    if (url.pathname === "/detached-window.html") return true;
    if (url.pathname !== "/index.html") return false;
    const route = url.searchParams.get("initialRoute");
    return !route || route === "/local" || /^\/local\/[^/?#]+$/.test(route);
  });
  const ids = new Set(pages.map(page => page.id));
  for (const [id, client] of clients) {
    if (ids.has(id) && client.socket.readyState === WebSocket.OPEN) continue;
    client.socket.close();
    clients.delete(id);
  }
  for (const id of connectionErrors.keys()) {
    if (!ids.has(id)) connectionErrors.delete(id);
  }
  await Promise.all(pages.filter(page => !clients.has(page.id)).map(async page => {
    try {
      clients.set(page.id, await connect(page, port));
      connectionErrors.delete(page.id);
    } catch (error) {
      if (connectionErrors.get(page.id) !== error.message) console.error(error.message);
      connectionErrors.set(page.id, error.message);
    }
  }));
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

let discoverAfter = 0;
let lastError;
try {
  while (!stopping) {
    try {
      if (Date.now() >= discoverAfter) {
        discoverAfter = Date.now() + 1500;
        await discover();
      }
      if (!clients.size) {
        await delay(180);
        continue;
      }
      const [source, items] = await Promise.all([rendererSource(), activity.read()]);
      const results = await Promise.allSettled([...clients.values()].map(client => show(client, source, items)));
      const failure = results.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
      lastError = undefined;
    } catch (error) {
      if (lastError !== error.message) console.error(error.message);
      lastError = error.message;
      if (Date.now() - debuggerSeenAt >= debuggerTimeout) break;
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
