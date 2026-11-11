import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("a bad debugger target does not block chat windows or reconnection", async t => {
  const profile = await mkdtemp(join(tmpdir(), "workshop-debugger-"));
  const sessions = join(profile, "sessions");
  await mkdir(sessions);
  const sockets = new Set();
  const connected = new Set();
  let targets = [];
  let lists = 0;
  const server = createServer((_request, response) => {
    lists++;
    response.end(JSON.stringify(targets));
  });
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    connected.add(request.url.split("/").at(-1));
    const accept = createHash("sha1")
      .update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const page = (id, route = "") => ({
    id, type: "page", url: `app://-/index.html${route}`,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`
  });
  targets = [
    { ...page("bad"), webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/bad" },
    page("main"), page("chat", "?initialRoute=%2Flocal%2Fclient-new-thread%3Aexample"),
    page("avatar", "?initialRoute=%2Favatar-overlay")
  ];
  await writeFile(join(profile, "DevToolsActivePort"), port + "\n");
  const script = fileURLToPath(new URL("../src/bridge.mjs", import.meta.url));
  const child = spawn(process.execPath, [script, profile, sessions], { stdio: "ignore" });
  const stopped = new Promise(resolve => child.once("exit", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    child.kill("SIGTERM");
    await stopped;
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true });
  });

  async function until(condition) {
    for (let attempt = 0; attempt < 80 && !condition(); attempt++) await delay(75);
    assert.ok(condition());
  }
  await until(() => connected.has("main") && connected.has("chat"));
  assert.equal(connected.has("avatar"), false);

  targets = [];
  for (const socket of sockets) socket.destroy();
  const listedAt = lists;
  await until(() => lists > listedAt);
  targets = [page("replacement")];
  await until(() => connected.has("replacement"));
});
