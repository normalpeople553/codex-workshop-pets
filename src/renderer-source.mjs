import { readFile } from "node:fs/promises";

export async function rendererSource() {
  const files = ["./companion.js", "../art/pet.css", "../art/pet.svg"];
  const [renderer, css, artwork] = await Promise.all(
    files.map(file => readFile(new URL(file, import.meta.url), "utf8"))
  );
  return `(${renderer.trim()})(${JSON.stringify(css)}, ${JSON.stringify(artwork)});`;
}
