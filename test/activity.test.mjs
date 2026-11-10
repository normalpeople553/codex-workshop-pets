import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { trackActivity } from "../src/activity.mjs";

test("tracks old and resumed chats from different projects in one row", async t => {
  const root = await mkdtemp(join(tmpdir(), "workshop-projects-"));
  const sessions = join(root, "sessions");
  const older = join(sessions, "2024", "01", "01");
  const newer = join(sessions, "2024", "02", "01");
  await mkdir(older, { recursive: true });
  await mkdir(newer, { recursive: true });
  const activity = await trackActivity(sessions);
  t.after(async () => {
    activity.close();
    await rm(root, { recursive: true });
  });

  const first = "11111111-1111-1111-1111-111111111111";
  const second = "22222222-2222-2222-2222-222222222222";
  const segment = "33333333-3333-3333-3333-333333333333";
  const now = Date.now();
  const entry = (type, payload, time) =>
    JSON.stringify({ type, payload, timestamp: new Date(time).toISOString() }) + "\n";
  const meta = (id, cwd) => entry("session_meta", { id, cwd, originator: "Codex Desktop" }, now - 60_000);
  const event = (type, time, extra) => entry("event_msg", { type, ...extra }, time);
  const oldRollout = join(older, `rollout-2024-01-01T00-00-00-${second}.jsonl`);
  const resumedRollout = join(newer, `rollout-2024-02-01T00-00-00-${second}_${segment}.jsonl`);
  await writeFile(join(root, ".codex-global-state.json"), JSON.stringify({
    "local-projects": {
      parent: { rootPaths: ["/project-a"] },
      alpha: { rootPaths: ["/project-a/src"] },
      beta: { rootPaths: ["/moved-project-b"] }
    },
    "thread-project-assignments": { [second]: { projectKind: "local", projectId: "beta" } }
  }));

  await writeFile(join(newer, `rollout-2024-02-01T00-00-00-${first}.jsonl`),
    meta(first, "/project-a/src/nested") + event("task_started", now - 1000));
  await writeFile(oldRollout, meta(second, "/project-b") + event("task_complete", now - 2000));
  await writeFile(resumedRollout, meta(second, "/project-b") +
    event("thread_settings_applied", now - 600, { thread_settings: { service_tier: "priority" } }) +
    event("task_started", now - 500));

  const bothWorking = [[first, "coding", false, "alpha"], [second, "coding", true, "beta"]];
  const readStates = async () => (await activity.read()).map(({ id, state, fast, projectId }) => [id, state, fast, projectId]);
  assert.deepEqual(await readStates(), bothWorking);

  await appendFile(oldRollout,
    event("thread_settings_applied", now - 900, { thread_settings: { service_tier: "default" } }) +
    event("task_complete", now - 700));
  await delay(450);
  assert.deepEqual(await readStates(), bothWorking);

  await appendFile(resumedRollout, event("task_complete", Date.now()));
  await delay(450);
  assert.deepEqual(await readStates(), [[first, "coding", false, "alpha"], [second, "done", true, "beta"]]);
});
