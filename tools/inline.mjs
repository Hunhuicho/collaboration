/**
 * inline.mjs — bundle a document page into a single HTML file.
 *
 *   node tools/inline.mjs public/docs/s04-purchase-progress-status.html
 *
 * Inlines the CSS and JS and writes the result to dist/. Use it when a file
 * has to travel on its own — an email attachment, a shared drive.
 * The bundled copy runs in local-only mode, with no shared storage.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, basename, join } from "node:path";

const src = process.argv[2] || "public/docs/s04-purchase-progress-status.html";
const outDir = process.argv[3] || "dist";

let html = await readFile(src, "utf8");
const baseDir = dirname(resolve(src));

async function readAsset(href) {
  return readFile(resolve(baseDir, href), "utf8");
}

// <link rel="stylesheet" href="..."> → inline <style>
for (const m of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)]) {
  const css = await readAsset(m[1]);
  html = html.replace(m[0], `<style>\n${css}\n</style>`);
}

// <script src="..."></script> → <script>…</script>
for (const m of [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readAsset(m[1]);
  html = html.replace(m[0], `<script>\n${js}\n</script>`);
}

await mkdir(outDir, { recursive: true });
const out = join(outDir, basename(src));
await writeFile(out, html, "utf8");
console.log(`${src} → ${out}  (${(html.length / 1024).toFixed(1)} KB)`);
