#!/usr/bin/env node
/**
 * translate-templates.mjs — T-388 supplementary pipeline.
 *
 * The scanner emitted template literals as CHUNKS (per the report), but the
 * codemod rewrites templates/concats as ONE full text with {{placeholders}}
 * (grammatical translations). Those reconstructed full-texts are NOT in
 * unique-strings.json — this script translates exactly the codemod's
 * templateKeyMap texts into translations-templates.json (keyed by TEXT).
 *
 * Imports the key maps from apply-i18n.mjs (main-guarded — no file rewrites),
 * so the reconstruction can never drift from the codemod.
 *
 * Usage: node scripts/i18n/translate-templates.mjs [--batch=50]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ZAI from "/home/z/.bun/install/global/node_modules/z-ai-web-dev-sdk/dist/index.js";
import { templateKeyMap } from "./apply-i18n.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, "translations-templates.json");
const BATCH = parseInt((process.argv.find((a) => a.startsWith("--batch=")) ?? "--batch=50").replace("--batch=", ""), 10);

const FR_CHARS = /[àâäçéèêëîïôöùûüÿœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒ]/;
const FR_WORDS = /\b(le|la|les|un|une|des|du|de|d'|et|ou|avec|sans|pour|sur|dans|par|est|sont|être|avoir|faire|veuillez|aucune?|tous|toutes|cette|ce|ces|vous|nous|erreur|échoué|échec|enregistré|ajouter|modifier|supprimer|rechercher|fermer|annuler|confirmer|oui|non|jour|mois|année|élève|parent|classe|note|absence|présence)\b/i;
function detectLang(s) {
  if (/[\u0600-\u06FF]/.test(s)) return "ar";
  if (FR_CHARS.test(s)) return "fr";
  if (FR_WORDS.test(s)) return "fr";
  return "en";
}

const GLOSSARY = `DOMAIN GLOSSARY (school management, Algeria — follow EXACTLY):
- élève → en "Student" / ar "تلميذ" (feminine: "تلميذة", plural "التلاميذ") — NEVER "طالب"
- parent (d'un élève) → en "Parent" / ar "ولي" (pl "الأولياء") — NEVER "والد" for the CRM entity
- classe → en "Class" / ar "فوج" (Algerian usage) — plural "الأفواج"
- niveau → en "Grade level" / ar "مستوى"
- matière → en "Subject" / ar "مادة"
- tranche → en "Installment" / ar "قسط" (pl "أقساط")
- frais de scolarité → en "Tuition fees" / ar "رسوم الدراسة"
- bulletin → en "Report card" / ar "كشف النقاط"
- absence / présence → ar "الغياب" / "الحضور"
- enseignant → en "Teacher" / ar "أستاذ" (pl "الأساتذة")
- personnel → en "Staff" / ar "الموظفون"
- inscription → en "Registration" / ar "التسجيل"
- encaissement → en "Counter payment" / ar "تحصيل"
- dépense → en "Expense" / ar "مصروف"
- réduction / remise → en "Discount" / ar "تخفيض"
- année scolaire → en "School year" / ar "السنة الدراسية"
- devoir → en "Homework" / ar "واجب" (pl "واجبات")
- tableau de bord → en "Dashboard" / ar "لوحة التحكم"
- échéance → en "Due date" / ar "تاريخ الاستحقاق"
- solde / solde dû → en "Balance / outstanding balance" / ar "الرصيد" / "الرصيد المستحق"
- DA (dinar algérien) → fr "DA" / en "DA" / ar "دج"`;

const RULES = `TRANSLATION RULES:
1. Each "src" is a FULL interpolated UI string from a school-management desktop app. {{name}} tokens are LIVE runtime values (student names, counts, dates…).
2. Fill ALL THREE fields with natural, professional UI translations. NEVER copy an English src into "fr" (translate to proper French) and never copy a French src into "en".
3. Arabic = professional Modern Standard Arabic (فصحى) for a school administration UI. Use Arabic punctuation naturally (؟ ،).
4. French follows French typographic conventions: space before : ; ! ?, « » quotes.
5. CRITICAL: preserve the {{placeholder}} SET exactly — same names, order may shift for grammar. Never translate, rename, drop or add a placeholder.
6. Keep technical tokens untranslated: DA, DZD, PDF, API, URL, ID.
7. en: Title Case for labels, sentence case for sentences.

Return ONLY a valid JSON array: [{"i":<id>,"fr":"…","en":"…","ar":"…"}] — no markdown fences, no commentary.`;

let cache = {};
if (existsSync(CACHE)) cache = JSON.parse(readFileSync(CACHE, "utf8"));
const saveCache = () => writeFileSync(CACHE, JSON.stringify(cache, null, 1));

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
      const wait = is429 ? 20000 * attempt : 1500 * attempt;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function placeholders(s) {
  return [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");
}

async function main() {
  const texts = [...templateKeyMap.keys()];
  const items = texts.map((text, i) => ({ id: i, src: text, srcLang: detectLang(text) }));
  const remaining = items.filter((x) => !cache[x.src] || cache[x.src].issue);
  console.log(`template full-texts: ${texts.length} (${Object.keys(cache).length} cached, ${remaining.length} to translate)`);
  for (let i = 0; i < remaining.length; i += BATCH) {
    const batch = remaining.slice(i, i + BATCH);
    let res = null;
    for (let attempt = 1; attempt <= 3 && !res; attempt++) {
      try {
        res = await translateBatch(batch);
      } catch (e) {
        console.log(`  batch ${i / BATCH + 1} attempt ${attempt} failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (!res) { console.log(`  batch at ${i} FAILED permanently — stopping (resume re-runs)`); break; }
    let bad = 0;
    for (const r of res) {
      const e = batch.find((b) => b.id === r.i);
      if (!e) continue;
      let issue = null;
      if (!r.fr || !r.en || !r.ar) issue = "empty field";
      else for (const loc of ["fr", "en", "ar"]) {
        if (placeholders(r[loc]) !== placeholders(e.src)) { issue = `placeholder mismatch in ${loc}`; break; }
      }
      cache[e.src] = { srcLang: e.srcLang, fr: r.fr, en: r.en, ar: r.ar, issue: issue ?? undefined };
      if (issue) bad++;
    }
    saveCache();
    console.log(`  batch ${i / BATCH + 1}/${Math.ceil(remaining.length / BATCH)} done (${bad} flagged)`);
  }
  const issues = Object.values(cache).filter((c) => c.issue);
  console.log(`\ntemplate cache: ${Object.keys(cache).length}/${texts.length} translated, ${issues.length} flagged`);
  for (const v of issues.slice(0, 10)) console.log("  !", v.issue, "—", v.src?.slice(0, 70));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
