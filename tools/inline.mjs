/**
 * inline.mjs — 문서 페이지를 단일 HTML 파일로 묶습니다.
 *
 *   node tools/inline.mjs public/docs/s04-purchase-progress-status.html
 *
 * CSS와 JS를 본문에 넣어 dist/ 에 저장합니다. 메일 첨부나 사내 공유 폴더처럼
 * 서버 없이 파일 하나만 전달해야 할 때 쓰세요.
 * 이렇게 만든 파일은 공유 저장이 꺼진 "로컬 저장 모드"로 동작합니다.
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

// <link rel="stylesheet" href="..."> → <style>
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
