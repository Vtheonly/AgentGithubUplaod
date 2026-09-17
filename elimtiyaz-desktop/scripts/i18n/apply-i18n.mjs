#!/usr/bin/env node
/**
 * apply-i18n.mjs — T-388 codemod: rewrite every hardcoded user-visible string
 * to a t("key") call, inject useTranslation where missing, and emit the
 * generated dictionaries (fr/ar/en).
 *
 * Modes:
 *   node apply-i18n.mjs plan                    — audit only (writes codemod-plan.json)
 *   node apply-i18n.mjs apply [--area=crm,…]     — apply (default: all areas)
 *   node apply-i18n.mjs dict                     — (re)generate src/i18n/gen/*.ts only
 *   node apply-i18n.mjs base-en                  — (re)generate src/i18n/en.ts (the base) only
 *
 * IMPORTABLE: `import { literalKeyMap, templateKeyMap, templateTexts, areaOf } from "./apply-i18n.mjs"`
 * — the run sections are guarded by the main-module check, so importing builds the
 * key maps WITHOUT rewriting any file (translate-templates.mjs + the emitter use this).
 *
 * The detection logic MIRRORS scan-hardcoded-strings.mjs exactly (same
 * visitor, same filters) so node positions align with the frozen report.
 *
 * Replacements:
 *   jsx-text "Foo"                    → {t("k")}
 *   attr label="Foo" / label={"Foo"}  → label={t("k")}
 *   jsx-expression {"Foo"}            → {t("k")}
 *   ternary branch "Foo"              → t("k")
 *   fallback {x || "Foo"}             → t("k") on the right operand
 *   concat part "Foo"                 → t("k") on the literal part
 *   toast.showX("Foo", …)             → t("k") on the string arg
 *   toast.showX(`${a} Foo ${b}`)      → t("k", {p1: a, p2: b}) — full-text
 *   concat exprs "Foo" + x            → t("k", {p1: x}) as a WHOLE — full-text
 *
 * Full-text reconstruction: templates and concats become ONE key with
 * {{placeholders}} (i18next interpolation), so translations are grammatical.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");

const mode = process.argv[2] ?? "plan";
const areaArg = (process.argv.find((a) => a.startsWith("--area=")) ?? "").replace("--area=", "");
const areaFilter = areaArg ? new Set(areaArg.split(",").map((s) => s.trim())) : null;

// --- shared config (mirrors the scanner) ---------------------------------------

const minChars = 2;
const VISIBLE_PROPS = new Set([
  "label", "title", "placeholder", "aria-label", "aria-description", "aria-placeholder",
  "aria-roledescription", "aria-valuetext", "alt", "description", "emptyText",
  "emptyMessage", "helperText", "hint", "text", "message", "subtitle", "caption",
  "confirmText", "cancelText", "okText",
]);
const VISIBLE_CALLS = new Set([
  "toast", "success", "error", "info", "warning", "message", "alert", "confirm", "prompt",
  "showSuccess", "showError", "showWarning", "showInfo",
]);
const EXCLUDE_FILES = ["src/app/providers/toast-provider.tsx"];
const BRAND_STRINGS = new Set(["El-Imtiyaz", "EI", "El-Imtiyaz Educational & Operational Management Platform"]);

function shouldExcludeFile(fp) {
  const rel = relative(ROOT, fp).split("/").join("/");
  if (EXCLUDE_FILES.includes(rel)) return true;
  if (/\.test\.[jt]sx?$/.test(rel)) return true;
  if (rel.startsWith("src/tests/")) return true;
  if (rel.startsWith("src/test/")) return true;
  if (rel.endsWith(".d.ts")) return true;
  if (rel.startsWith("src/shared/particle-engine/")) return true;
  return false;
}
function looksLikeTechnical(s) {
  if (!s) return true;
  const trimmed = s.trim();
  if (trimmed.length === 0) return true;
  if (/^[0-9\s.,:/%°+-]+$/.test(trimmed)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return true;
  if (/^https?:\/\//.test(trimmed)) return true;
  if (/^[a-z0-9_.-]+$/i.test(trimmed) && trimmed.length <= 4 && !/[àâçéèêëîïôûùüÿñæœ]/i.test(trimmed)) {
    if (!trimmed.includes(" ")) return true;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return true;
  if (/^[A-Z]{2,3}-\d+$/.test(trimmed)) return true;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(trimmed)) return true;
  return false;
}
function hasLetters(s) {
  return /[a-zA-ZàâäçéèêëîïôöùûüÿñæœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸÑÆŒ\u0600-\u06FF]/.test(s);
}
const norm = (s) => s.replace(/\s+/g, " ").trim();

// --- key assignment ------------------------------------------------------------

function areaOf(rel) {
  // rel like src/features/crm/parent-detail-drawer.tsx or src/app/app-shell.tsx
  if (rel.startsWith("src/features/")) {
    const seg = rel.split("/")[2];
    return { auth: "auth", dashboard: "dashboard", crm: "crm", financials: "financials",
      academics: "academics", personnel: "personnel", workflow: "workflow", routing: "routing",
      settings: "settings", profile: "profile", ai: "ai" }[seg] ?? "misc";
  }
  if (rel.startsWith("src/app/")) return "app";
  if (rel.startsWith("src/shared/")) return "shared";
  return "misc";
}
function slugOf(rel) {
  const parts = rel.replace(/^src\/(features|app|shared)\//, "").replace(/\.tsx?$/, "").split("/");
  return parts.map((p, i) => (i === 0 ? p : p.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase())))
    .join(".").replace(/[^a-zA-Z0-9.]/g, "");
}

// --- load report + build the key maps -------------------------------------------

const report = JSON.parse(readFileSync(join(__dirname, "hardcoded-strings-report.json"), "utf8"));
const unique = JSON.parse(readFileSync(join(__dirname, "unique-strings.json"), "utf8")).unique;

// literal text → existing key (72 reusable)
const literalToExistingKey = new Map(
  unique.filter((u) => u.existingKey).map((u) => [u.text, u.existingKey]),
);

// primary file per text (most occurrences, then first)
// NOTE: chunk texts from template findings are included so that plain-string
// texts deduped against them (same normalized text) still receive a key.
const textAreas = new Map(); // text -> { areas:Set, files: [] }
for (const f of report) {
  if (!textAreas.has(f.text)) textAreas.set(f.text, { areas: new Set(), files: [] });
  const e = textAreas.get(f.text);
  e.areas.add(areaOf(f.file));
  e.files.push(f.file);
}

// assign keys deterministically
const literalKeyMap = new Map(); // text -> new key (for non-existing-key texts)
{
  const texts = [...textAreas.keys()].filter((t) => !literalToExistingKey.has(t));
  const firstSeen = new Map();
  for (const f of report) {
    if (firstSeen.has(f.text)) continue;
    firstSeen.set(f.text, f);
  }
  const ordered = texts.sort((a, b) => {
    const fa = firstSeen.get(a), fb = firstSeen.get(b);
    return fa.file.localeCompare(fb.file) || fa.line - fb.line;
  });
  const counters = new Map(); // section.fileSlug -> n
  const commonCounter = { n: 0 };
  for (const text of ordered) {
    const meta = textAreas.get(text);
    const primary = meta.files[0];
    const area = areaOf(primary);
    if (meta.areas.size >= 3) {
      commonCounter.n += 1;
      literalKeyMap.set(text, `common.m${commonCounter.n}`);
    } else {
      const slug = `${area}.${slugOf(primary)}`;
      const n = (counters.get(slug) ?? 0) + 1;
      counters.set(slug, n);
      literalKeyMap.set(text, `${slug}.k${n}`);
    }
  }
}

// --- template/concat reconstruction ---------------------------------------------

function paramNameFor(exprText, used) {
  // m.studentName -> studentName ; formatX(a) -> formatX ; else v1,v2…
  let name = null;
  const prop = exprText.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (prop) name = prop[1];
  let base = name && /^[a-z][\w$]*$/.test(name) ? name : "v";
  let candidate = base, i = 2;
  while (used.has(candidate)) candidate = `${base}${i++}`;
  used.add(candidate);
  return candidate;
}

function reconstructTemplate(node) {
  // returns { full: "text {{p}} more", params: [{name, exprText}] } or null
  const used = new Set();
  const params = [];
  let full = node.head.text;
  for (const span of node.templateSpans) {
    const exprText = span.expression.getText();
    const name = paramNameFor(exprText, used);
    params.push({ name, exprText });
    full += `{{${name}}}` + span.literal.text;
  }
  return { full: norm(full), params };
}

function reconstructConcat(node) {
  // binary + expression: literals + exprs -> single interpolated string
  const parts = [];
  function walk(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      walk(n.left); walk(n.right);
    } else parts.push(n);
  }
  walk(node);
  const used = new Set();
  const params = [];
  let full = "";
  let anyLiteral = false;
  for (const p of parts) {
    if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) {
      full += p.text; anyLiteral = true;
    } else {
      const exprText = p.getText();
      const name = paramNameFor(exprText, used);
      params.push({ name, exprText });
      full += `{{${name}}}`;
    }
  }
  if (!anyLiteral) return null;
  return { full: norm(full), params };
}

// --- the detection + collection pass ---------------------------------------------

function collectNodes(sourceFile, file) {
  // mirrors the scanner but collects NODES + context
  const out = [];
  const visit = (node, parents) => {
    const chain = [...parents, node];

    if (ts.isJsxText(node)) {
      const raw = node.getText();
      const cleaned = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      const decoded = cleaned.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const visible = norm(decoded);
      if (visible.length >= minChars && hasLetters(visible) && !BRAND_STRINGS.has(visible)) {
        out.push({ node, kind: "jsx-text", text: visible, parents: chain });
      }
      return;
    }

    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.text;
      if (VISIBLE_PROPS.has(attrName) && node.initializer) {
        const init = node.initializer;
        if (ts.isStringLiteral(init)) {
          const s = init.text;
          if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s) && !BRAND_STRINGS.has(s))
            out.push({ node: init, kind: `attr:${attrName}`, text: norm(s), parents: chain });
        } else if (ts.isJsxExpression(init) && init.expression) {
          const e = init.expression;
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
            const s = e.text;
            if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s) && !BRAND_STRINGS.has(s))
              out.push({ node: e, kind: `attr:${attrName}`, text: norm(s), parents: chain });
          } else if (ts.isTemplateExpression(e)) {
            const r = reconstructTemplate(e);
            if (r) out.push({ node: e, kind: `attr:${attrName}-template`, text: r.full, params: r.params, parents: chain });
          }
        }
      }
      return;
    }

    if (ts.isJsxExpression(node)) {
      if (node.expression) {
        const e = node.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
          const s = e.text;
          if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s) && !BRAND_STRINGS.has(s))
            out.push({ node: e, kind: "jsx-expression", text: norm(s), parents: chain });
        } else if (ts.isTemplateExpression(e)) {
          const r = reconstructTemplate(e);
          if (r) out.push({ node: e, kind: "jsx-expression-template", text: r.full, params: r.params, parents: chain });
        } else if (ts.isConditionalExpression(e)) {
          for (const branch of [e.whenTrue, e.whenFalse]) {
            if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) {
              const s = branch.text;
              if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s) && !BRAND_STRINGS.has(s))
                out.push({ node: branch, kind: "jsx-ternary", text: norm(s), parents: chain });
            } else if (ts.isTemplateExpression(branch)) {
              const r = reconstructTemplate(branch);
              if (r) out.push({ node: branch, kind: "jsx-ternary-template", text: r.full, params: r.params, parents: chain });
            }
          }
        } else if (ts.isBinaryExpression(e) &&
          (e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
          const right = e.right;
          if (ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right)) {
            const s = right.text;
            if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s) && !BRAND_STRINGS.has(s))
              out.push({ node: right, kind: "jsx-fallback", text: norm(s), parents: chain });
          }
        } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
          const r = reconstructConcat(e);
          if (r) out.push({ node: e, kind: "jsx-concat", text: r.full, params: r.params, parents: chain });
        }
      }
      // recurse ONCE through children (the expression included) — no double visit
      ts.forEachChild(node, (child) => visit(child, chain));
      return;
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let name = null;
      const fullText = callee.getText();
      if (ts.isIdentifier(callee)) name = callee.text;
      else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
      if (!fullText.startsWith("console.") && !fullText.startsWith("logger.") && name && VISIBLE_CALLS.has(name)) {
        for (const arg of node.arguments) {
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            const s = arg.text;
            if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s) && !BRAND_STRINGS.has(s))
              out.push({ node: arg, kind: `call:${name}`, text: norm(s), parents: chain });
          } else if (ts.isTemplateExpression(arg)) {
            const r = reconstructTemplate(arg);
            if (r) out.push({ node: arg, kind: `call:${name}-template`, text: r.full, params: r.params, parents: chain });
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, chain));
  };
  sourceFile.forEachChild((n) => visit(n, []));
  return out;
}

// --- context analysis -----------------------------------------------------------

function enclosingComponent(finding) {
  for (let i = finding.parents.length - 1; i >= 0; i--) {
    const n = finding.parents[i];
    let name = null;
    if (ts.isFunctionDeclaration(n) && n.name) name = n.name.text;
    else if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      // const X = () => … / export function X… / const useThing = () => …
      for (let j = i - 1; j >= 0; j--) {
        const p = finding.parents[j];
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) { name = p.name.text; break; }
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) { name = p.name.text; break; }
        if (ts.isCallExpression(p) || ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) break;
      }
    }
    // React components (uppercase) AND custom hooks (use*) can both call useTranslation
    if (name && (/^[A-Z]/.test(name) || /^use[A-Z_]/.test(name))) {
      return { node: n, name, hasBodyBlock: ts.isBlock(n.body ?? null) || !n.body };
    }
  }
  return null;
}

// --- file discovery ---------------------------------------------------------------

import { readdirSync } from "node:fs";
function listSourceFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fp = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(fp));
    else if (/\.[jt]sx?$/.test(entry.name)) out.push(fp);
  }
  return out;
}
const SCAN_DIRS = ["app", "features", "shared"];
const allFiles = SCAN_DIRS.flatMap((d) => listSourceFiles(join(SRC, d)))
  .filter((f) => !shouldExcludeFile(f));

// --- template key assignment (deterministic, like literals) ------------------------

const templateFindingsByFile = new Map(); // file -> template findings
const templateTexts = []; // { text, file, line }
{
  for (const file of allFiles) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const findings = collectNodes(sf, file);
    const templates = findings.filter((f) => f.kind.includes("template") || f.kind === "jsx-concat");
    if (templates.length) templateFindingsByFile.set(file, templates);
    for (const t of templates) templateTexts.push({ text: t.text, file, line: t.node.getStart() });
  }
}
const templateKeyMap = new Map();
{
  const seenFirst = new Map();
  const areasPerText = new Map();
  for (const t of templateTexts) {
    if (!seenFirst.has(t.text)) seenFirst.set(t.text, t);
    if (!areasPerText.has(t.text)) areasPerText.set(t.text, new Set());
    areasPerText.get(t.text).add(areaOf(t.file));
  }
  const ordered = [...new Set(templateTexts.map((t) => t.text))].sort((a, b) => {
    const fa = seenFirst.get(a), fb = seenFirst.get(b);
    return fa.file.localeCompare(fb.file) || sfLine(fa) - sfLine(fb);
  });
  function sfLine(t) { return t.line; }
  const counters = new Map();
  const commonCounter = { n: 1000 };
  for (const text of ordered) {
    const first = seenFirst.get(text);
    const area = areaOf(first.file);
    if (areasPerText.get(text).size >= 3) {
      commonCounter.n += 1;
      templateKeyMap.set(text, `common.m${commonCounter.n}`);
    } else {
      const slug = `${area}.${slugOf(first.file)}`;
      const n = (counters.get(slug) ?? 0) + 1;
      counters.set(slug, n);
      templateKeyMap.set(text, `${slug}.k${n}`);
    }
  }
}

// --- the main per-file processing ---------------------------------------------------

function processFile(file, apply) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = relative(ROOT, file).split("/").join("/");
  const findings = collectNodes(sf, file);
  if (findings.length === 0) return { rel, edits: 0, injections: 0, manual: [], moduleLevel: [] };

  const edits = []; // { start, end, text }
  const manual = []; // findings that need human handling
  const componentsNeedingHook = new Map(); // component name -> node
  const moduleLevel = [];

  for (const f of findings) {
    const isTemplate = f.kind.includes("template") || f.kind === "jsx-concat";
    const key = isTemplate
      ? templateKeyMap.get(f.text)
      : (literalToExistingKey.get(f.text) ?? literalKeyMap.get(f.text));
    if (!key) { manual.push({ line: sf.getLineAndCharacterOfPosition(f.node.getStart()).line + 1, kind: f.kind, text: f.text, why: "no key" }); continue; }

    let replacement;
    if (f.kind === "jsx-text") {
      // replace only the trimmed inner range
      const raw = f.node.getText();
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const start = f.node.getStart() + lead;
      const end = f.node.getEnd() - trail;
      replacement = { start, end, text: `{t("${key}")}` };
    } else if (f.kind.startsWith("attr:")) {
      const isTemplateAttr = f.kind.endsWith("-template");
      if (isTemplateAttr) {
        const params = f.params.map((p) => `${p.name}: ${p.exprText}`).join(", ");
        replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}", { ${params} })` };
      } else {
        replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}")` };
      }
    } else if (f.kind === "jsx-expression" || f.kind === "jsx-ternary" || f.kind === "jsx-fallback") {
      replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}")` };
    } else if (f.kind === "jsx-expression-template" || f.kind === "jsx-ternary-template") {
      const params = f.params.map((p) => `${p.name}: ${p.exprText}`).join(", ");
      replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}", { ${params} })` };
    } else if (f.kind === "jsx-concat") {
      const params = f.params.map((p) => `${p.name}: ${p.exprText}`).join(", ");
      replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}", { ${params} })` };
    } else if (f.kind.startsWith("call:")) {
      if (f.kind.endsWith("-template")) {
        const params = f.params.map((p) => `${p.name}: ${p.exprText}`).join(", ");
        replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}", { ${params} })` };
      } else {
        replacement = { start: f.node.getStart(), end: f.node.getEnd(), text: `t("${key}")` };
      }
    }
    if (!replacement) { manual.push({ line: sf.getLineAndCharacterOfPosition(f.node.getStart()).line + 1, kind: f.kind, text: f.text, why: "no replacement rule" }); continue; }

    // context check: inside a component or custom hook?
    const comp = enclosingComponent(f);
    if (comp) {
      componentsNeedingHook.set(comp.name, comp);
    } else {
      // plain helper functions / module constants — hooks are illegal there;
      // DEFER to manual migration (the codemod must not break rules-of-hooks)
      moduleLevel.push({ line: sf.getLineAndCharacterOfPosition(f.node.getStart()).line + 1, kind: f.kind, text: f.text, key });
      continue;
    }
    edits.push(replacement);
  }

  // for module-level findings we cannot inject a hook — flag them
  const moduleLevelManual = moduleLevel;

  let injections = [];
  if (apply) {
    // determine hook injection needs
    const hasHookImport = /import\s*\{[^}]*useTranslation[^}]*\}\s*from\s*["']react-i18next["']/.test(source);
    const compsWithLocalT = new Set();
    // find components that already destructure t
    for (const m of source.matchAll(/const\s*\{\s*t\s*\}\s*=\s*useTranslation\(\)/g)) compsWithLocalT.add(m.index);

    for (const [name, comp] of componentsNeedingHook) {
      // does this component already have the hook? find its body start
      const body = comp.node.body;
      if (!body) { manual.push({ why: `component ${name} has no body`, }); continue; }
      const bodyStart = body.getStart() + 1; // after {
      // check if a hook already exists between bodyStart and first real statement end
      const bodyText = source.slice(bodyStart, body.getEnd());
      if (/const\s*\{\s*t\s*\}\s*=\s*useTranslation\(\)/.test(bodyText)) continue;
      // indentation from the first line of the body
      const lineStart = source.lastIndexOf("\n", bodyStart) + 1;
      const lineText = source.slice(lineStart, source.indexOf("\n", bodyStart) + 1);
      const indent = (lineText.match(/^\s*/) ?? [""])[0];
      injections.push({ at: bodyStart, text: `\n${indent}const { t } = useTranslation();` });
    }
    if (!hasHookImport && (injections.length > 0 || componentsNeedingHook.size > 0)) {
      // insert after last import
      let lastImportEnd = 0;
      for (const m of source.matchAll(/^import[^;]+;/gm)) lastImportEnd = m.index + m[0].length;
      injections.push({ at: lastImportEnd, text: `\nimport { useTranslation } from "react-i18next";`, isImport: true });
    }
  }

  if (!apply || edits.length === 0) {
    return { rel, edits: edits.length, injections: injections.length, manual, moduleLevel: moduleLevelManual };
  }

  // apply edits back-to-front
  let out = source;
  const all = [...edits, ...injections].sort((a, b) => b.at - a.at);
  // for injections, 'at' is insertion point; for edits, start..end
  const ops = [];
  for (const e of edits) ops.push({ at: e.start, end: e.end, text: e.text });
  for (const inj of injections) ops.push({ at: inj.at, end: inj.at, text: inj.text });
  ops.sort((a, b) => b.at - a.at);
  for (const op of ops) {
    out = out.slice(0, op.at) + op.text + out.slice(op.end);
  }
  writeFileSync(file, out);
  return { rel, edits: edits.length, injections: injections.length, manual, moduleLevel: moduleLevelManual };
}

// --- dictionary emission ----------------------------------------------------------

import { pathToFileURL } from "node:url";

function unflatten(flat) {
  const root = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split(".");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return root;
}

function emitTsVar(varName, obj, header) {
  const json = JSON.stringify(obj, null, 2).replace(
    /^(\s*)"((?:\\.|[^"\\])*)":/gm,
    (m, indent, rawKey) => {
      const key = rawKey.replace(/\\"/g, '"');
      return /^[A-Za-z_$][\w$]*$/.test(key) ? `${indent}${key}:` : m;
    },
  );
  return `${header}\nexport const ${varName} = ${json};\n`;
}

const GEN_HEADER = (locale) => `/**
 * AUTO-GENERATED by scripts/i18n/apply-i18n.mjs dict — DO NOT EDIT BY HAND.
 * The T-388 generated dictionary (${locale}): every key the codemod assigned to a
 * formerly hardcoded string (common.m* cross-area texts + <area>.<fileSlug>.k*
 * per-file texts). Regenerated wholesale by the emitter — hand edits are lost.
 * Regenerate: node scripts/i18n/apply-i18n.mjs dict
 */`;

function buildGenDictionaries({ partial = false } = {}) {
  const cache = JSON.parse(readFileSync(join(__dirname, "translations-cache.json"), "utf8"));
  const tmplCache = existsSync(join(__dirname, "translations-templates.json"))
    ? JSON.parse(readFileSync(join(__dirname, "translations-templates.json"), "utf8"))
    : {};
  const todo = unique.filter((u) => !u.existingKey);
  const textToId = new Map(todo.map((u, i) => [u.text, i]));

  // liveness: a literal text is EMITTED only if it survives somewhere as a
  // standalone string — texts whose EVERY finding is a template chunk or a
  // concat part are dead keys (the codemod rewrites those nodes wholesale via
  // templateKeyMap), so they must not bloat the dictionary.
  const liveAsLiteral = new Set();
  for (const f of report) {
    if (!/-template$/.test(f.kind) && f.kind !== "jsx-concat") liveAsLiteral.add(f.text);
  }

  const flat = { fr: {}, ar: {}, en: {} };
  const missing = [];
  const issues = [];
  const skippedDead = [];
  const seen = new Set(); // one text may map to both a literal key and a template key — emit once per KEY

  const emit = (key, text, tr) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (!tr) { missing.push({ key, text }); return; }
    if (tr.issue) { issues.push({ key, text, issue: tr.issue }); return; }
    if (!tr.fr || !tr.ar || !tr.en) { missing.push({ key, text, why: "empty locale field" }); return; }
    flat.fr[key] = tr.fr;
    flat.ar[key] = tr.ar;
    flat.en[key] = tr.en;
  };

  for (const [text, key] of literalKeyMap) {
    if (!liveAsLiteral.has(text)) { skippedDead.push({ key, text }); continue; }
    const id = textToId.get(text);
    emit(key, text, id !== undefined ? cache[id] : undefined);
  }
  for (const [text, key] of templateKeyMap) {
    emit(key, text, tmplCache[text]);
  }

  if (skippedDead.length) console.log(`skipped ${skippedDead.length} dead chunk-only keys (template reconstruction owns them)`);
  return { flat, missing, issues, partial };
}

function writeGenDictionaries({ flat, missing, issues, partial }) {
  mkdirSync(join(SRC, "i18n", "gen"), { recursive: true });
  writeFileSync(join(SRC, "i18n", "gen", "fr.ts"), emitTsVar("genFr", unflatten(flat.fr), GEN_HEADER("fr")));
  writeFileSync(join(SRC, "i18n", "gen", "ar.ts"), emitTsVar("genAr", unflatten(flat.ar), GEN_HEADER("ar")));
  writeFileSync(join(SRC, "i18n", "gen", "en.ts"), emitTsVar("genEn", unflatten(flat.en), GEN_HEADER("en")));
  const n = Object.keys(flat.fr).length;
  console.log(`gen dictionaries written: ${n} keys x fr/ar/en -> src/i18n/gen/`);
  if (missing.length) {
    console.log(`⚠ MISSING translations: ${missing.length} (of ${n + missing.length})`);
    for (const m of missing.slice(0, 25)) console.log(`  ${m.key}: ${m.text.slice(0, 70)}`);
    if (missing.length > 25) console.log(`  … +${missing.length - 25} more`);
    if (!partial) {
      console.log("\nREFUSING to emit incomplete dictionaries without --partial");
      process.exit(1);
    }
  }
  if (issues.length) {
    console.log(`⚠ FLAGGED ISSUES: ${issues.length} — fix before shipping:`);
    for (const i of issues) console.log(`  ${i.key}: ${i.issue} — ${i.text.slice(0, 60)}`);
    process.exit(1);
  }
}

// base en.ts — the existing dictionary structure with en values (dictionary-en.json)
function writeBaseEn() {
  const dictEn = JSON.parse(readFileSync(join(__dirname, "dictionary-en.json"), "utf8"));
  const frSource = readFileSync(join(ROOT, "src/i18n/fr.ts"), "utf8");
  const stripped = frSource.replace("export const", "const").replace(/as const;/, ";");
  const js = ts.transpileModule(stripped + `\nmodule.exports = fr;\n`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  const frNested = mod.exports;

  const missing = [];
  function convert(node, prefix) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") {
        const e = dictEn[key];
        if (!e?.en) missing.push(key);
        out[k] = e?.en ?? v;
      } else out[k] = convert(v, key);
    }
    return out;
  }
  const enNested = convert(frNested, "");
  const header = `/**
 * English translation strings — the third locale (T-388, I18N-501).
 *
 * GENERATED ONCE from fr.ts + scripts/i18n/dictionary-en.json (the Pass 1
 * translation table), then HAND-MAINTAINED like fr.ts / ar.ts from now on.
 * Regenerating is NOT idempotent over manual edits — edit by hand.
 */`;
  writeFileSync(join(SRC, "i18n", "en.ts"), emitTsVar("en", enNested, header));
  console.log(`src/i18n/en.ts written (${Object.keys(dictEn).length} keys mapped, ${missing.length} missing en values)`);
  if (missing.length) {
    for (const k of missing.slice(0, 15)) console.log(`  !! no en value: ${k}`);
    process.exit(1);
  }
}

// --- run (main-module guarded — importers build maps only) ------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (mode === "dict") {
    const partial = process.argv.includes("--partial");
    console.log(`\n=== apply-i18n dict (${partial ? "PARTIAL" : "STRICT"}) ===\n`);
    writeGenDictionaries(buildGenDictionaries({ partial }));
    process.exit(0);
  }
  if (mode === "base-en") {
    console.log("\n=== apply-i18n base-en ===\n");
    writeBaseEn();
    process.exit(0);
  }

  const files = allFiles.filter((f) => {
    if (!areaFilter) return true;
    const rel = relative(ROOT, f);
    return areaFilter.has(areaOf(rel));
  });

  console.log(`\n=== apply-i18n ${mode} (${areaArg || "ALL AREAS"}, ${files.length} files) ===\n`);

  const summary = { files: [], totals: { edits: 0, injections: 0, manual: 0, moduleLevel: 0 } };
  const apply = mode === "apply";
  for (const file of files) {
    const r = processFile(file, apply);
    if (r.edits > 0 || r.manual.length > 0 || r.moduleLevel.length > 0) {
      summary.files.push(r);
      summary.totals.edits += r.edits;
      summary.totals.injections += r.injections;
      summary.totals.manual += r.manual.length;
      summary.totals.moduleLevel += r.moduleLevel.length;
    }
  }

  console.log(`files touched: ${summary.files.length}`);
  console.log(`edits: ${summary.totals.edits}, hook injections: ${summary.totals.injections}`);
  console.log(`manual review: ${summary.totals.manual}, module-level findings: ${summary.totals.moduleLevel}`);

  // module-level detail (the codemod applies them but t may be undefined there!)
  const ml = summary.files.flatMap((f) => f.moduleLevel.map((m) => ({ file: f.rel, ...m })));
  if (ml.length) {
    console.log(`\n⚠ MODULE-LEVEL FINDINGS (${ml.length}) — t() applied but no component scope:`);
    for (const m of ml.slice(0, 40)) console.log(`  ${m.file}:${m.line} [${m.kind}] ${m.text.slice(0, 70)}`);
    if (ml.length > 40) console.log(`  … +${ml.length - 40} more`);
  }
  const man = summary.files.flatMap((f) => f.manual.map((m) => ({ file: f.rel, ...m })));
  if (man.length) {
    console.log(`\n⚠ MANUAL REVIEW (${man.length}):`);
    for (const m of man.slice(0, 20)) console.log(`  ${m.file}:${m.line} [${m.kind}] ${m.text.slice(0, 70)}`);
  }

  writeFileSync(join(__dirname, "codemod-plan.json"), JSON.stringify(summary, null, 1));
  console.log(`\nplan written: scripts/i18n/codemod-plan.json`);
}

export { literalKeyMap, templateKeyMap, templateTexts, literalToExistingKey, areaOf };
