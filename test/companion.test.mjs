import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { rendererSource } from "../src/renderer-source.mjs";

const chrome = process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const run = promisify(execFile);

test("chat aliases, collapsed projects, navigation and composer switching", {
  skip: !existsSync(chrome) && "Set CHROME_BIN to run the browser test"
}, async t => {
  const root = await mkdtemp(join(tmpdir(), "wptest-"));
  t.after(() => rm(root, { recursive: true }));
  const fixture = join(root, "sidebar.html");
  const source = await rendererSource();
  await writeFile(fixture, `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div id="inactive" class="composer-surface-chrome" aria-hidden="true"
      style="position:absolute;left:20px;top:450px;width:400px;height:80px"></div>
    <div id="active" class="composer-surface-chrome"
      style="position:absolute;left:100px;top:450px;width:400px;height:80px"></div>
    <div id="project" data-app-action-sidebar-project-row data-app-action-sidebar-project-id="alpha">
      <div>Project Alpha</div><div></div>
    </div>
    <div data-app-action-sidebar-project-list-id="alpha">
      <div id="direct" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:existing">Existing</div>
      <div id="alias" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:client-new-thread:pending">Alias</div>
      <div id="other-alias" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:client-new-thread:other">Other alias</div>
    </div>
    <pre id="proof"></pre>
    <script>${source}</script>
    <script>
      const proof = document.getElementById("proof");
      function check(condition, message) { if (!condition) throw Error(message); }
      try {
        const tasks = [
          {id:"existing",title:"Same title",state:"coding",projectId:"alpha"},
          {id:"canonical",title:"Same title",state:"coding",fast:true,projectId:"alpha",aliases:["client-new-thread:pending"]},
          {id:"other",title:"Same title",state:"coding",projectId:"alpha",aliases:["client-new-thread:other"]}
        ];
        const project = document.getElementById("project");
        const alias = document.getElementById("alias");
        const otherAlias = document.getElementById("other-alias");
        const direct = document.getElementById("direct");
        const workshop = window.codexWorkshop;
        workshop.render(tasks);
        const panel = document.getElementById("codex-workshop");
        const pets = panel.querySelectorAll(".workshop-pet");
        check(panel.style.left === "100px", "The hidden composer won");
        [direct, alias, otherAlias].forEach((row, i) => {
          check(row.hasAttribute("data-workshop-mark"), "Missing task marker");
          const petMark = getComputedStyle(pets[i].querySelector(".workshop-pet-mark"));
          const rowMark = getComputedStyle(row, "::before");
          check(rowMark.backgroundColor === petMark.backgroundColor && rowMark.clipPath === petMark.clipPath, "Task marker differs");
        });
        check(pets[1].hasAttribute("data-fast"), "Fast state was lost");
        pets[1].dispatchEvent(new PointerEvent("pointerenter"));
        check(alias.hasAttribute("data-workshop-highlight") && !direct.hasAttribute("data-workshop-highlight") &&
          !otherAlias.hasAttribute("data-workshop-highlight"), "Highlight matched by title");
        pets[1].dispatchEvent(new PointerEvent("pointerleave"));
        pets[1].click();
        check(workshop.takeClicks().join() === "canonical", "Click used a client alias");
        direct.remove();
        alias.remove();
        otherAlias.remove();
        project.setAttribute("aria-expanded","false");
        document.getElementById("active").setAttribute("aria-hidden","true");
        document.getElementById("inactive").removeAttribute("aria-hidden");
        workshop.render(tasks);
        check(panel.style.left === "20px", "Overlay did not move with the active composer");
        check(project.querySelectorAll(".workshop-project-mark").length === 3, "Collapsed project lost its markers");
        workshop.render([]);
        check(!project.querySelector(".workshop-project-marks"), "Stale project markers");
        proof.dataset.passed = "true";
      } catch (error) { proof.textContent = error.message; }
      window.codexWorkshop.destroy();
    </script></body></html>`);
  const { stdout } = await run(chrome, [
    "--headless", "--no-first-run", "--disable-gpu", "--dump-dom", "--window-size=900,700",
    `--user-data-dir=${join(root, "chrome")}`, pathToFileURL(fixture).href
  ], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  const proof = stdout.match(/<pre id="proof"[^>]*>.*?<\/pre>/s)?.[0];
  assert.match(proof ?? "", /data-passed="true"/, proof);
});
