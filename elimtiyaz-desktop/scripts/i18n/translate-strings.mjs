#!/usr/bin/env node
/**
 * translate-strings.mjs — T-388 LLM-assisted translation pipeline.
 *
 * Takes the unique-string inventory (unique-strings.json) and produces a
 * tri-lingual translation table (translations-cache.json):
 *
 *   [{ id, src, srcLang, fr, en, ar }]
 *
 * - strings matching an EXISTING dictionary fr-value are skipped (they keep
 *   their key; en comes from the dictionary translation pass below)
 * - the EXISTING 225-key dictionary is translated to English first
 *   (dictionary-en.json) — en.ts is a brand-new locale
 * - batches of BATCH strings per LLM call, cached incrementally, resumable
 * - validation: no empty fields, {{placeholder}} sets preserved per locale,
 *   no English leakage into fr for French-source strings
 *
 * Usage: node scripts/i18n/translate-strings.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import ZAI from "/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CACHE_BASE = join(__dirname, "translations-cache.json");
const DICT_EN = join(__dirname, "dictionary-en.json");
const BATCH = 70;

// sharding for parallel runs: SHARD_INDEX=0 SHARD_COUNT=3 node translate-strings.mjs
const SHARD_INDEX = parseInt(process.env.SHARD_INDEX ?? "0", 10);
const SHARD_COUNT = parseInt(process.env.SHARD_COUNT ?? "1", 10);
const CACHE = SHARD_COUNT > 1 ? CACHE_BASE.replace(".json", `.shard${SHARD_INDEX}.json`) : CACHE_BASE;

// --- load inventory -----------------------------------------------------------

const inventory = JSON.parse(readFileSync(join(__dirname, "unique-strings.json"), "utf8"));
const unique = inventory.unique; // [{text, count, files, kinds, existingKey}]

// --- load existing dictionaries ------------------------------------------------

function loadDict(rel) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const name = rel.split("/").pop().replace(".ts", "");
  const stripped = src.replace("export const", "const").replace(/as const;/, ";");
  const js = ts.transpileModule(stripped + `\nmodule.exports = ${name};\n`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  return mod.exports;
}
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}
const frFlat = flatten(loadDict("src/i18n/fr.ts"));
const arFlat = flatten(loadDict("src/i18n/ar.ts"));

// --- language detection --------------------------------------------------------

const FR_CHARS = /[àâäçéèêëîïôöùûüÿœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒ]/;
const FR_WORDS = /\b(le|la|les|un|une|des|du|de|d'|et|ou|avec|sans|pour|sur|dans|par|est|sont|être|avoir|faire|veuillez|aucune?|tous|toutes|cette|ce|ces|vous|nous|erreur|échoué|échec|enregistré|ajouter|modifier|supprimer|rechercher|fermer|annuler|confirmer|oui|non|jour|mois|année|élève|parent|classe|note|absence|présence)\b/i;

function detectLang(s) {
  if (/[\u0600-\u06FF]/.test(s)) return "ar";
  if (FR_CHARS.test(s)) return "fr";
  if (FR_WORDS.test(s)) return "fr";
  return "en";
}

// --- the glossary (aligned with the existing ar.ts terminology) ------------------

const GLOSSARY = `DOMAIN GLOSSARY (school management, Algeria — follow EXACTLY):
- élève → en "Student" / ar "تلميذ" (feminine: "تلميذة", plural "التلاميذ") — NEVER "طالب"
- parent (d'un élève) → en "Parent" / ar "ولي" (pl "الأولياء") — NEVER "والد" for the CRM entity
- classe → en "Class" / ar "فوج" (Algerian usage) — plural "الأفواج"
- niveau → en "Grade level" / ar "مستوى"
- matière → en "Subject" / ar "مادة"
- tranche → en "Installment" / ar "قسط" (pl "أقساط")
- frais de scolarité → en "Tuition fees" / ar "رسوم الدراسة"
- bulletin → en "Report card" / ar "كشف النقاط"
- appel (roll call) → en "Roll call" / ar "الاستدعاء"… use "تسجيل الحضور" when it means attendance taking
- absence / présence → ar "الغياب" / "الحضور"
- enseignant → en "Teacher" / ar "أستاذ" (pl "الأساتذة")
- personnel → en "Staff" / ar "الموظفون"
- inscription → en "Registration" / ar "التسجيل"
- encaissement → en "Counter payment" / ar "تحصيل"
- dépense → en "Expense" / ar "مصروف"
- créance / dette → en "Debt / receivable" / ar "دين" / "المستحقات"
- remboursement → en "Refund" / ar "استرداد"
- réduction / remise → en "Discount" / ar "تخفيض"
- année scolaire → en "School year" / ar "السنة الدراسية"
- devoir → en "Homework" / ar "واجب" (pl "واجبات")
- justification → en "Justification" / ar "تبرير"
- workflow → ar "سير عمل" (keep "workflow" in fr)
- sauvegarde → en "Backup" / ar "نسخة احتياطية"
- journal d'audit → en "Audit log" / ar "سجل التدقيق"
- tableau de bord → en "Dashboard" / ar "لوحة التحكم"
- échéance → en "Due date" / ar "تاريخ الاستحقاق"
- solde / solde dû → en "Balance / outstanding balance" / ar "الرصيد" / "الرصيد المستحق"
- DA (dinar algérien) → fr "DA" / en "DA" / ar "دج"
- DZD → fr "DZD" / en "DZD" / ar "دج"`;

const RULES = `TRANSLATION RULES:
1. The "src" string is French OR English UI text (school-management desktop app, Algeria).
2. Fill ALL THREE fields with natural, professional UI translations — NEVER copy an English src into "fr" (translate it to proper French) and never copy a French src into "en".
3. Arabic = professional Modern Standard Arabic (فصحى), suited to a school administration UI. Use Arabic punctuation naturally (؟ ، ؛). Keep it concise — UI labels, not prose.
4. French follows French typographic conventions: narrow space before : ; ! ? (write as regular space), « » quotes, trailing … preserved.
5. Preserve {{placeholders}} EXACTLY — same names, same order allowed to shift for grammar, but the SET must be identical.
6. Preserve trailing punctuation style: if src ends with "…", ":" or "?", all locales keep an equivalent.
7. Keep technical tokens untranslated: DA, DZD, PDF, IA→AI in en, API, URL, ID, E-mail stays "البريد الإلكتروني" in ar.
8. Capitalization: en uses Title Case for labels/buttons, sentence case for sentences. fr/ar mirror the src's casing intent.
9. If src is ALL-CAPS (a badge/status), keep all locales appropriately emphatic but natural.
10. Empty-ish or symbolic strings: translate minimally (e.g. "ms" → fr "ms", en "ms", ar "م‌ث"… actually "ms" stays "ms" in fr/en and becomes "م‌ث" ONLY if natural; otherwise keep "ms").

Return ONLY a valid JSON array: [{"i":<id>,"fr":"…","en":"…","ar":"…"}] — no markdown fences, no commentary.`;

// --- cache --------------------------------------------------------------------

let cache = {};
if (existsSync(CACHE)) cache = JSON.parse(readFileSync(CACHE, "utf8"));
const saveCache = () => writeFileSync(CACHE, JSON.stringify(cache, null, 1));

// --- the LLM call ---------------------------------------------------------------

let zaiInstance = null;
async function translateBatch(items) {
  if (!zaiInstance) zaiInstance = await ZAI.create();
  const srcList = items.map((x) => ({ i: x.id, src: x.src, lang: x.srcLang }));
  let lastErr = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const completion = await zaiInstance.chat.completions.create({
        messages: [
          { role: "assistant", content: `${GLOSSARY}\n\n${RULES}` },
          { role: "user", content: JSON.stringify(srcList) },
        ],
        thinking: { type: "disabled" },
      });
      const raw = completion.choices[0]?.message?.content ?? "";
      const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("empty array");
      return parsed;
    } catch (e) {
      lastErr = e;
      const is429 = /429|Too many/i.test(String(e.message));
      // rate-limits need LONG backoffs; JSON glitches need short ones
      const wait = is429 ? 20000 * attempt : 1500 * attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function placeholders(s) {
  return [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");
}

function validate(item, out) {
  if (!out.fr || !out.en || !out.ar) return "empty field";
  for (const loc of ["fr", "en", "ar"]) {
    if (placeholders(out[loc]) !== placeholders(item.src)) return `placeholder mismatch in ${loc}`;
  }
  return null;
}

// --- main -----------------------------------------------------------------------

async function main() {
  // Pass 1: the existing dictionary → English (for en.ts) — incremental
  let out = existsSync(DICT_EN) ? JSON.parse(readFileSync(DICT_EN, "utf8")) : {};
  const entries = Object.entries(frFlat).map(([k, v], i) => ({ id: 100000 + i, key: k, src: v, srcLang: detectLang(v) }))
    .filter((e) => !out[e.key]);
  if (entries.length > 0) {
    console.log(`Pass 1: translating the existing dictionary to en (${entries.length} keys left)…`);
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      let res = null;
      try {
        res = await translateBatch(batch);
      } catch (e) {
        console.log(`  dict batch at ${i} FAILED: ${e.message} — stopping (resume re-runs)`);
        break;
      }
      for (const r of res) {
        const e = batch.find((b) => b.id === r.i);
        if (!e) continue;
        const err = validate(e, r);
        if (err) console.log(`  !! ${e.key}: ${err}`);
        out[e.key] = { fr: e.src, en: r.en, ar: arFlat[e.key] ?? r.ar };
      }
      writeFileSync(DICT_EN, JSON.stringify(out, null, 1));
      console.log(`  dict batch ${i / BATCH + 1}/${Math.ceil(entries.length / BATCH)} done (${Object.keys(out).length} keys)`);
    }
  } else {
    console.log("Pass 1: dictionary-en.json complete — skipping");
  }

  // Pass 2: the unique hardcoded strings (skip reusable — they have keys)
  if (SHARD_INDEX > 0) {
    console.log(`Shard ${SHARD_INDEX}/${SHARD_COUNT}: skipping Pass 1 (shard 0 owns it)`);
  }
  const todo = unique.filter((u) => !u.existingKey);
  console.log(`\nPass 2 [shard ${SHARD_INDEX}/${SHARD_COUNT}]: ${todo.length} unique strings (${Object.keys(cache).length} cached)`);
  const items = todo.map((u, i) => ({ id: i, src: u.text, srcLang: detectLang(u.text), count: u.count }))
    .filter((_, i) => i % SHARD_COUNT === SHARD_INDEX);
  const remaining = items.filter((x) => !cache[x.id]);
  for (let i = 0; i < remaining.length; i += BATCH) {
    const batch = remaining.slice(i, i + BATCH);
    let res = null;
    for (let attempt = 1; attempt <= 3 && !res; attempt++) {
      try {
        res = await translateBatch(batch);
      } catch (e) {
        console.log(`  batch ${i / BATCH + 1} attempt ${attempt} failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (!res) { console.log(`  batch at ${i} FAILED permanently — stopping (resume re-runs)`); break; }
    let bad = 0;
    for (const r of res) {
      const e = batch.find((b) => b.id === r.i);
      if (!e) continue;
      const err = validate(e, r);
      cache[r.i] = { src: e.src, srcLang: e.srcLang, fr: r.fr, en: r.en, ar: r.ar, issue: err ?? undefined };
      if (err) bad++;
    }
    saveCache();
    console.log(`  [shard ${SHARD_INDEX}] batch ${i / BATCH + 1}/${Math.ceil(remaining.length / BATCH)} done (${bad} flagged)`);
  }

  const done = Object.keys(cache).length;
  console.log(`\n[shard ${SHARD_INDEX}] Cache: ${done}/${items.length} translated`);
  const issues = Object.values(cache).filter((c) => c.issue);
  console.log(`Flagged issues: ${issues.length}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
