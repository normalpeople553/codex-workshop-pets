import { watch } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const threadPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const rolloutPattern = /^rollout-[^_]+-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i;
const activeTimeout = 15 * 60_000;
const doneDuration = 10_000;

function consume(chat, { type, payload, timestamp }) {
  if (!payload) return;
  if (type === "session_meta") {
    chat.desktop = payload.originator === "Codex Desktop" && payload.thread_source !== "subagent";
    return;
  }
  if (!chat.desktop) return;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return;
  chat.updated = time;
  if (type !== "event_msg") return;

  if (payload.type === "thread_settings_applied") {
    chat.fast = payload.thread_settings?.service_tier === "priority";
  } else if (payload.type === "task_started") {
    chat.started = time;
    chat.running = true;
    chat.finished = 0;
  } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
    chat.running = false;
    chat.finished = payload.type === "task_complete" ? time : 0;
  }
}

async function tail(file, chat) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size < chat.offset) {
      chat.offset = 0;
      chat.partial = "";
      chat.decoder = new TextDecoder();
    }
    const length = Math.min(size - chat.offset, 512 * 1024);
    if (length <= 0) return false;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, chat.offset);
    chat.offset += bytesRead;
    const lines = (chat.partial + chat.decoder.decode(buffer.subarray(0, bytesRead), { stream: true })).split("\n");
    chat.partial = lines.pop();
    for (const line of lines) {
      if (line) consume(chat, JSON.parse(line));
    }
    return chat.offset < size;
  } finally {
    await handle.close();
  }
}

export async function trackActivity(sessions) {
  const chats = new Map();
  const dirty = new Set();
  const index = join(dirname(sessions), "session_index.jsonl");
  let titleVersion;
  let nextCatchUp = 0;
  let nextScan = 0;
  const titles = new Map();
  function mark(file) {
    if (file && rolloutPattern.test(basename(file))) dirty.add(join(sessions, file));
  }
  const watcher = watch(sessions, { recursive: true }, (_event, file) => mark(file));
  watcher.on("error", error => console.error("Session watcher:", error.message));

  // Discover recently active chats. The watcher also covers chats created before this date range.
  async function scanRecent() {
    for (const day of [new Date(), new Date(Date.now() - 86_400_000)]) {
      const relative = day.toLocaleDateString("sv-SE").replaceAll("-", "/");
      const directory = join(sessions, relative);
      const files = await readdir(directory).catch(error => {
        if (error.code !== "ENOENT") throw error;
        return [];
      });
      for (const file of files.filter(file => rolloutPattern.test(file))) {
        const info = await stat(join(directory, file)).catch(() => null);
        if (info && Date.now() - info.mtimeMs < activeTimeout) mark(join(relative, file));
      }
    }
  }

  async function refreshTitles() {
    const version = await stat(index).then(info => info.mtimeMs).catch(() => null);
    if (version === titleVersion) return;
    titleVersion = version;
    if (version === null) return;
    titles.clear();
    for (const line of (await readFile(index, "utf8")).split("\n")) {
      if (!line) continue;
      try {
        const { id, thread_name: title } = JSON.parse(line);
        if (threadPattern.test(id) && typeof title === "string") titles.set(id, title);
      } catch {
        // The app can still be appending the last index entry.
      }
    }
  }

  return {
    async read() {
      const now = Date.now();
      if (now >= nextScan) {
        nextScan = now + 2000;
        await scanRecent();
      }
      if (now >= nextCatchUp) {
        nextCatchUp = now + 400;
        for (const chat of chats.values()) {
          if (chat.running) dirty.add(chat.file);
        }
      }
      for (const file of [...dirty]) {
        dirty.delete(file);
        const [, id] = basename(file).match(rolloutPattern);
        let chat = chats.get(id);
        if (!chat || chat.file !== file) {
          chat = { file, offset: 0, partial: "", decoder: new TextDecoder(),
            finished: 0 };
          chats.set(id, chat);
        }
        try {
          if (await tail(file, chat)) dirty.add(file);
        } catch (error) {
          if (error.code !== "ENOENT") console.error("Session read:", error.message);
        }
      }
      await refreshTitles();
      const renderedAt = Date.now();
      const active = [];
      for (const [id, chat] of chats) {
        if (!chat.desktop || renderedAt - chat.updated > activeTimeout) continue;
        const state = chat.running ? "coding" : renderedAt < chat.finished + doneDuration ? "done" : null;
        if (state) active.push({ id, state, fast: chat.fast === true,
          title: titles.get(id) || "Codex " + id.slice(-5), started: chat.started ?? chat.updated });
      }
      active.sort((left, right) => left.started - right.started || left.id.localeCompare(right.id));
      return active;
    },
    close() { watcher.close(); }
  };
}
