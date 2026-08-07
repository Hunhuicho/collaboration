/**
 * inline.mjs — bundle a document page into a single HTML file.
 *
 *   node tools/inline.mjs public/docs/s04-purchase-progress-status.html
 *   node tools/inline.mjs public/docs/data-requests.html --artifact
 *
 * Inlines the CSS and JS and writes the result to dist/. Use it when a file
 * has to travel on its own — an email attachment, a shared drive.
 * The bundled copy runs in local-only mode, with no shared storage.
 *
 * --artifact writes a preview copy instead, for review before deploying:
 * page content only with no document shell, no passcode gate, and no
 * Firebase keys. Nothing typed into a preview is saved anywhere shared.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, basename, join } from "node:path";

const args = process.argv.slice(2).filter(a => a !== "--artifact");
const artifact = process.argv.includes("--artifact");

const src = args[0] || "public/docs/s04-purchase-progress-status.html";
const outDir = args[1] || "dist";

let html = await readFile(src, "utf8");
const baseDir = dirname(resolve(src));

async function readAsset(href) {
  return readFile(resolve(baseDir, href), "utf8");
}

// The rail links to sibling pages that do not travel with a single file.
html = html
  .replace(/<div class="shell">\s*/, "")
  .replace(/<aside id="navMount"><\/aside>\s*/, "")
  .replace(/<script src="[^"]*nav\.js"><\/script>\s*/, "")
  .replace(/<script src="[^"]*docs\.js"><\/script>\s*/, "")
  .replace(/<\/div>\n<\/div>\n\n<script/, "</div>\n\n<script");

/* Asset text is substituted through a replacer function, never a replacement
   string: a "$&" or "$1" inside the CSS or JS would otherwise be read as a
   backreference and splice the matched tag into the code. */
// <link rel="stylesheet" href="..."> → inline <style>
for (const m of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)]) {
  const css = await readAsset(m[1]);
  html = html.replace(m[0], () => `<style>\n${css}\n</style>`);
}

// <script src="..."></script> → <script>…</script>
for (const m of [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readAsset(m[1]);
  html = html.replace(m[0], () => `<script>\n${js}\n</script>`);
}

/* Preview copy: the artifact host supplies <!doctype>, <head> and <body>, so
   emit page content only. The gate and the project keys come out with it —
   a preview is for reading the wording, not for entering anything. */
if (artifact) {
  html = html
    .replace(/<script>document\.documentElement\.classList\.add\("gating"\);<\/script>\s*/, "")
    .replace(/passHash:\s*"[^"]*"/, 'passHash: ""')
    .replace(/window\.FIREBASE_CONFIG\s*=\s*\{[\s\S]*?\};/, 'window.FIREBASE_CONFIG = { apiKey: "", projectId: "" };');

  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ["", ""])[1];
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || ["", ""])[1];
  html = head.replace(/<meta[^>]*>\s*/gi, "").trim() + "\n\n" + body.trim() + "\n";
}

await mkdir(outDir, { recursive: true });
const out = join(outDir, (artifact ? "preview-" : "") + basename(src));
await writeFile(out, html, "utf8");
console.log(`${src} → ${out}  (${(html.length / 1024).toFixed(1)} KB)`);
