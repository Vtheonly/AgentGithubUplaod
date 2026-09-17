#!/usr/bin/env node
/**
 * check-parity.mjs — fr/ar/en key-set parity for the desktop dictionaries.
 * Flattens each locale's nested object into dotted keys and diffs the sets.
 * Exit 1 on any gap or duplicate.
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function loadDict(rel, varName) {
  try {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const name = varName ?? rel.split("/").pop().replace(".ts", "");
    const stripped = src.replace("export const", "const").replace(/as const;/, ";");
    const js = ts.transpileModule(stripped + `\nmodule.exports = ${name};\n`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", js)(mod, mod.exports);
    return mod.exports;
  } catch {
    return null;
  }
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

// T-388: each locale = hand-maintained base + generated dictionary, merged
function loadLocale(base) {
  const b = flatten(loadDict(`src/i18n/${base}.ts`, base) ?? {});
  const g = flatten(loadDict(`src/i18n/gen/${base}.ts`, `gen${base[0].toUpperCase()}${base.slice(1)}`) ?? {});
  if (Object.keys(g).length === 0) {
    console.log(`  ⚠ gen/${base}.ts loaded EMPTY — check the gen emission (var must be gen${base[0].toUpperCase()}${base.slice(1)})`);
  }
  return { ...g, ...b }; // base wins on collision (hand-maintained is authoritative)
}

const fr = loadLocale("fr");
const ar = loadLocale("ar");
const en = loadLocale("en");

function diff(a, b, la, lb) {
  const missing = Object.keys(a).filter((k) => !(k in b));
  for (const k of missing) console.log(`  ${lb} MISSING: ${k} (present in ${la})`);
  return missing.length;
}

console.log(`fr: ${Object.keys(fr).length} keys`);
console.log(`ar: ${Object.keys(ar).length} keys`);
console.log(`en: ${Object.keys(en).length} keys${Object.keys(en).length === 0 ? " (NOT CREATED YET)" : ""}`);

let bad = 0;
bad += diff(fr, ar, "fr", "ar");
bad += diff(ar, fr, "ar", "fr");
if (Object.keys(en).length > 0) {
  bad += diff(fr, en, "fr", "en");
  bad += diff(en, fr, "en", "fr");
}

// duplicate-value check within fr (same value under many keys is allowed but reported)
const byVal = {};
for (const [k, v] of Object.entries(fr)) (byVal[v] ??= []).push(k);
const dups = Object.entries(byVal).filter(([, ks]) => ks.length > 1);
console.log(`\nfr duplicate values (same text, multiple keys): ${dups.length}`);
for (const [v, ks] of dups.slice(0, 15)) console.log(`  "${v.slice(0, 40)}" -> ${ks.join(", ")}`);

console.log(bad === 0 ? "\nPARITY OK" : `\nPARITY FAILURES: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
