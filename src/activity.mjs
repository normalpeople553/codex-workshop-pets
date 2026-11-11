import { watch } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const threadPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const rolloutPattern = /^rollout-.+\.jsonl$/;
const activeTimeout = 15 * 60_000;
const doneDuration = 10_000;

function readClientBindings(atoms) {
  const bindings = new Map();
  for (const [alias, id] of Object.entries(atoms["client-thread-bindings-v1"] ?? {})) {
    if (typeof id === "string" && threadPattern.test(id)) bindings.set(alias, id);
  }
  for (const [key, alias] of Object.entries(atoms)) {
    const id = key.match(/^thread-client-id-v1:local(?:%3A|:)(.+)$/i)?.[1];
    if (threadPattern.test(id) && typeof alias === "string" && !bindings.has(alias)) {
      bindings.set(alias, id);
    }
  }
  return bindings;
}

function readThreadAliases(state) {
  const bindings = new Map();
  for (const [key, atoms] of Object.entries(state)) {
    if (!key.startsWith("electron-owner-atoms:") || !atoms) continue;
    for (const [alias, id] of readClientBindings(atoms)) {
      // A shared sidebar ID cannot safely identify two different chats.
      bindings.set(alias, bindings.has(alias) && bindings.get(alias) !== id ? null : id);
    }
  }
  for (const [alias, id] of readClientBindings(state["electron-persisted-atom-state"] ?? {})) {
    if (!bindings.has(alias)) bindings.set(alias, id);
  }
  const aliases = new Map();
  for (const [alias, id] of bindings) {
    if (id === null) continue;
    if (!aliases.has(id)) aliases.set(id, []);
    aliases.get(id).push(alias);
  }
  return aliases;
}

function consume(reader, chats, { type, payload, timestamp }) {
  if (!payload) return;
  if (type === "session_meta") {
    reader.chat = undefined;
    if (payload.originator !== "Codex Desktop" || payload.thread_source === "subagent" ||
        !threadPattern.test(payload.id)) return;
    if (!chats.has(payload.id)) chats.set(payload.id, { updated: 0, settingsAt: 0, lifecycleAt: 0 });
    reader.chat = chats.get(payload.id);
    if (typeof payload.cwd === "string") reader.chat.cwd = payload.cwd;
    return;
  }
  const chat = reader.chat;
  if (!chat) return;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return;
  chat.updated = Math.max(chat.updated, time);
  if (type !== "event_msg") return;

  if (payload.type === "thread_settings_applied") {
    if (time >= chat.settingsAt) {
      chat.settingsAt = time;
      chat.fast = payload.thread_settings?.service_tier === "priority";
    }
    return;
  }
  // Resumed chats can append to more than one rollout file.
  if (time < chat.lifecycleAt) return;
  if (payload.type === "task_started") {
    chat.lifecycleAt = time;
    chat.started = time;
    chat.turnId = payload.turn_id;
    chat.running = true;
    chat.finished = 0;
  } else if (payload.type === "task_complete" || payload.type === "turn_aborted") {
    if (chat.turnId && payload.turn_id && chat.turnId !== payload.turn_id) {
      const otherStarted = typeof payload.started_at === "number" ? payload.started_at * 1000 : 0;
      if (otherStarted <= chat.started) return;
      chat.started = otherStarted;
      chat.turnId = payload.turn_id;
    }
    chat.lifecycleAt = time;
    chat.running = false;
    chat.finished = payload.type === "task_complete" ? time : 0;
  }
}

async function tail(file, reader, chats) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    if (size < reader.offset) {
      reader.offset = 0;
      reader.partial = "";
      reader.decoder = new TextDecoder();
      reader.chat = undefined;
    }
    const length = Math.min(size - reader.offset, 512 * 1024);
    if (length <= 0) return false;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, reader.offset);
    reader.offset += bytesRead;
    const lines = (reader.partial + reader.decoder.decode(buffer.subarray(0, bytesRead), { stream: true })).split("\n");
    reader.partial = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // Skip a damaged line and keep reading the rest of this chunk.
        continue;
      }
      if (event) consume(reader, chats, event);
    }
    return reader.offset < size;
  } finally {
    await handle.close();
  }
}

export async function trackActivity(sessions) {
  sessions = resolve(sessions);
  const chats = new Map();
  const readers = new Map();
  const dirty = new Set();
  const index = join(dirname(sessions), "session_index.jsonl");
  const desktopState = join(dirname(sessions), ".codex-global-state.json");
  let titleVersion;
  let desktopVersion;
  let projectAssignments = {};
  let projectless = new Set();
  let projectRoots = [];
  let threadAliases = new Map();
  let nextCatchUp = 0;
  let nextScan = 0;
  const titles = new Map();
  function mark(file) {
    if (file && rolloutPattern.test(basename(file))) dirty.add(join(sessions, file));
  }
  const watcher = watch(sessions, { recursive: true }, (_event, file) => mark(file));
  watcher.on("error", error => console.error("Session watcher:", error.message));

  // The date in a rollout path is its creation date, even after a chat resumes.
  async function scanRecent() {
    const cutoff = Date.now() - activeTimeout;
    const entries = await readdir(sessions, { recursive: true, withFileTypes: true });
    const rollouts = entries.filter(entry => entry.isFile() && rolloutPattern.test(entry.name));
    await Promise.all(rollouts.map(async entry => {
      const file = join(entry.parentPath, entry.name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs >= cutoff && info.size !== readers.get(file)?.offset) dirty.add(file);
    }));
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

  async function refreshDesktopState() {
    const version = await stat(desktopState).then(info => info.mtimeMs).catch(() => null);
    if (version === desktopVersion) return;
    try {
      const state = version === null ? {} : JSON.parse(await readFile(desktopState, "utf8"));
      projectAssignments = state["thread-project-assignments"] ?? {};
      projectless = new Set(state["projectless-thread-ids"] ?? []);
      projectRoots = Object.entries(state["local-projects"] ?? {}).flatMap(([id, project]) =>
        (project.rootPaths ?? []).filter(path => typeof path === "string" && isAbsolute(path))
          .map(path => ({ id, path: resolve(path) }))
      ).sort((left, right) => right.path.length - left.path.length);
      threadAliases = readThreadAliases(state);
      desktopVersion = version;
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== "ENOENT") throw error;
    }
  }

  function findProject(id, cwd) {
    const assignment = projectAssignments[id];
    if (assignment) return assignment.projectKind === "local" ? assignment.projectId : undefined;
    if (projectless.has(id) || !cwd || !isAbsolute(cwd)) return undefined;
    const match = projectRoots.find(({ path }) => {
      const fromRoot = relative(path, cwd);
      return !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
    });
    return match?.id;
  }

  return {
    async read() {
      const now = Date.now();
      if (now >= nextScan) {
        nextScan = now + 2000;
        await Promise.all([scanRecent(), refreshDesktopState()]);
      }
      if (now >= nextCatchUp) {
        nextCatchUp = now + 400;
        for (const [file, reader] of readers) {
          if (reader.chat?.running) dirty.add(file);
        }
      }
      for (const file of [...dirty]) {
        dirty.delete(file);
        let reader = readers.get(file);
        if (!reader) {
          reader = { offset: 0, partial: "", decoder: new TextDecoder() };
          readers.set(file, reader);
        }
        try {
          if (await tail(file, reader, chats)) dirty.add(file);
        } catch (error) {
          if (error.code !== "ENOENT") console.error("Session read:", error.message);
        }
      }
      await refreshTitles();
      const renderedAt = Date.now();
      const active = [];
      for (const [id, chat] of chats) {
        if (renderedAt - chat.updated > activeTimeout) continue;
        const state = chat.running ? "coding" : renderedAt < chat.finished + doneDuration ? "done" : null;
        if (state) active.push({ id, state, fast: chat.fast === true,
          title: titles.get(id) || "Codex " + id.slice(-5), started: chat.started ?? chat.updated,
          projectId: findProject(id, chat.cwd), aliases: threadAliases.get(id) });
      }
      active.sort((left, right) => left.started - right.started || left.id.localeCompare(right.id));
      return active;
    },
    close() { watcher.close(); }
  };
}
