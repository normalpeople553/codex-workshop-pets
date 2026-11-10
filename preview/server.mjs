import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { rendererSource } from "../src/renderer-source.mjs";

const html = await readFile(new URL("index.html", import.meta.url));
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
      return;
    }
    if (request.url === "/pet.js") {
      const source = await rendererSource();
      new Function(source);
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      }).end(source);
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    console.error(error.message);
    response.writeHead(500).end("Preview renderer could not be loaded.");
  }
});
server.listen(0, "127.0.0.1", () => {
  console.log(`宠物预览 http://127.0.0.1:${server.address().port}/`);
});
