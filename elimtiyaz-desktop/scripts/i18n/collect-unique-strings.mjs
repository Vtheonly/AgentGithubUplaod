#!/usr/bin/env node
/**
 * collect-unique-strings.mjs — dedupe the scanner report into a translation
 * inventory: unique texts (with occurrence counts + files), matched against
 * the EXISTING fr dictionary values (for key reuse).
 *
 * Output: scripts/i18n/unique-strings.json
 *   { unique: [{ text, count, files: [...], kinds: [...], existingKey?: "common.edit" }] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const report = JSON.parse(
  readFileSync(join(__dirname, "hardcoded-strings-report.json"), "utf8"),
);

// --- load existing fr dictionary (run through vite-free TS strip) -------------
// fr.ts is `export const fr = {...} as const;` — evaluate it safely by
// transpiling with the installed typescript compiler.
import ts from "typescript";
const frSource = readFileSync(join(ROOT, "src/i18n/fr.ts"), "utf8");
const stripped = frSource
  .replace("export const", "const")
  .replace(/as const;/, ";");
const js = ts.transpileModule(stripped + "\nmodule.exports = fr;\n", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const frDict = mod.exports;

// flatten existing dictionary: { "common.edit": "Modifier", ... }
const flat = {};
function walk(obj, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") flat[key] = v;
    else walk(v, key);
  }
}
walk(frDict, "");

// reverse map: value -> key (first wins; collect collisions for review)
const valueToKey = new Map();
const collisions = [];
for (const [k, v] of Object.entries(flat)) {
  const norm = v.replace(/\s+/g, " ").trim();
  if (valueToKey.has(norm) && valueToKey.get(norm) !== k) collisions.push({ value: norm, keys: [valueToKey.get(norm), k] });
  else valueToKey.set(norm, k);
}

// --- dedupe findings ----------------------------------------------------------
const byText = new Map();
for (const f of report) {
  const norm = f.text.replace(/\s+/g, " ").trim();
  if (!byText.has(norm)) {
    byText.set(norm, { text: norm, count: 0, files: new Set(), kinds: new Set(), lines: [] });
  }
  const e = byText.get(norm);
  e.count++;
  e.files.add(f.file);
  e.kinds.add(f.kind);
  if (e.lines.length < 3) e.lines.push(`${f.file}:${f.line}`);
}

const unique = [...byText.values()].map((e) => ({
  text: e.text,
  count: e.count,
  files: [...e.files],
  kinds: [...e.kinds],
  existingKey: valueToKey.get(e.text) ?? null,
}));

unique.sort((a, b) => b.count - a.count);

writeFileSync(join(__dirname, "unique-strings.json"), JSON.stringify({
  totalFindings: report.length,
  totalFiles: new Set(report.map((r) => r.file)).size,
  uniqueCount: unique.length,
  reusableCount: unique.filter((u) => u.existingKey).length,
  collisions,
  unique,
}, null, 2));

// --- summary ------------------------------------------------------------------
const reusable = unique.filter((u) => u.existingKey);
const englishish = unique.filter((u) => /[a-zA-Z]/.test(u.text) && !/[àâäçéèêëîïôöùûüÿñæœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ]/.test(u.text));
const hasTemplate = unique.filter((u) => u.kinds.some((k) => k.includes("template")));

console.log(`findings: ${report.length}, unique texts: ${unique.length}`);
console.log(`reusable via existing keys: ${reusable.length}`);
console.log(`latin-only (likely EN source): ${englishish.length}`);
console.log(`with template interpolations: ${hasTemplate.length}`);
console.log(`existing-dict value collisions: ${collisions.length}`);
console.log(`\nTop 40 repeated:`);
for (const u of unique.slice(0, 40)) {
  console.log(`  ${String(u.count).padStart(4)}x  ${u.existingKey ? `[${u.existingKey}] ` : ""}${u.text.slice(0, 90)}`);
}
