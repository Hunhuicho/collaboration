/**
 * passcode.mjs — set the passcode that guards the board.
 *
 *   node tools/passcode.mjs "my new passcode"
 *   node tools/passcode.mjs "my new passcode" "Workspace name"
 *
 * Writes the SHA-256 hash into public/assets/access.js. The passcode itself is
 * never stored anywhere in the repository — only its hash — so losing it means
 * setting a new one, not recovering the old.
 *
 * The hash is computed over "merp-board:" + passcode, matching sha256hex() in
 * board-core.js. Change one and you must change the other.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const pass = process.argv[2];
const label = process.argv[3];

if (!pass) {
  console.error('Usage: node tools/passcode.mjs "<passcode>" ["<workspace name>"]');
  process.exit(1);
}

const target = "public/assets/access.js";
const current = await readFile(target, "utf8");
const hash = createHash("sha256").update("merp-board:" + pass.trim()).digest("hex");

let next = current.replace(/passHash: "[^"]*"/, `passHash: "${hash}"`);
if (label) next = next.replace(/label: "[^"]*"/, `label: "${label.replace(/"/g, "'")}"`);

if (next === current) {
  console.error(`Could not find the fields to update in ${target}.`);
  process.exit(1);
}

await writeFile(target, next, "utf8");
console.log(`Passcode set. ${target} updated.`);
console.log("Share the passcode itself with reviewers — it is not stored in the repo.");
