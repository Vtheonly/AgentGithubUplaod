#!/usr/bin/env node
/**
 * scan-hardcoded-strings.mjs — desktop whole-codebase user-visible string scanner.
 *
 * T-388 port of the website's scanner (elimtiyaz-website/scripts/i18n/
 * scan-hardcoded-strings.mjs — the T-385 tool), adapted for the desktop:
 *
 *   - scans the UI layers only: src/app, src/features, src/shared
 *     (domain/infrastructure/core are logic + the ADR-002 canonical layer;
 *     PDF/Excel exports stay French per the T-385 scope decision)
 *   - the desktop toast API (toast.showSuccess/showError/showWarning/showInfo)
 *     is added to the visible-call set
 *   - t("…") / i18n keys are already-localized — skipped
 *
 * Reports string literals that are USER-VISIBLE:
 *   1. JSX text nodes                      <div>Bonjour</div>
 *   2. JSX attributes (visible props)      placeholder="Nom" / title= / aria-label=
 *   3. String literals inside JSX {expr}   {`Aucune note`} {"Chargement"}
 *   4. Toast calls                         toast.showError("Échec", …)
 *   5. Logical fallbacks in JSX            {value || "fallback"}
 *
 * Output: JSON report (scripts/i18n/hardcoded-strings-report.json) + summary.
 * Exit code 1 if any finding remains (CI-able).
 *
 * Usage: node scripts/i18n/scan-hardcoded-strings.mjs
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", ".."); // elimtiyaz-desktop
const SRC = join(ROOT, "src");
const OUT_REPORT = join(__dirname, "hardcoded-strings-report.json");

const minChars = 2;

// --- configuration: what counts as user-visible ------------------------------

const VISIBLE_PROPS = new Set([
  "label",
  "title",
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "alt",
  "description",
  "emptyText",
  "emptyMessage",
  "helperText",
  "hint",
  "text",
  "message",
  "subtitle",
  "caption",
  "confirmText",
  "cancelText",
  "okText",
]);

const INVISIBLE_PROPS = new Set([
  "className",
  "class",
  "key",
  "id",
  "htmlFor",
  "for",
  "type",
  "variant",
  "size",
  "href",
  "src",
  "action",
  "method",
  "role",
  "dir",
  "lang",
  "style",
  "value",
  "defaultValue",
  "testId",
  "data-testid",
  "autoComplete",
  "inputMode",
  "name",
  "trigger",
  "asChild",
  "forceMount",
  "defaultOpen",
  "open",
  "checked",
  "disabled",
  "required",
  "readOnly",
  "multiple",
  "accept",
  "capture",
  "form",
  "maxLength",
  "minLength",
  "min",
  "max",
  "step",
  "rows",
  "cols",
  "mode",
  "priority",
  "onSelect",
  "side",
  "align",
  "collisionPadding",
  "sticky",
  "prefix",
]);

// function names whose string arguments are user-visible (toast, alerts)
const VISIBLE_CALLS = new Set([
  "toast",
  "success",
  "error",
  "info",
  "warning",
  "message",
  "alert",
  "confirm",
  "prompt",
  // desktop toast-provider API
  "showSuccess",
  "showError",
  "showWarning",
  "showInfo",
]);

// UI layers that own user-visible strings
const SCAN_DIRS = ["app", "features", "shared"];

// files never to scan (within the scan dirs)
const EXCLUDE_FILES = [
  // tone identifiers ("success"/"danger") — not user text
  "src/app/providers/toast-provider.tsx",
];

function shouldExcludeFile(fp) {
  const rel = relative(ROOT, fp).split("/").join("/");
  if (EXCLUDE_FILES.includes(rel)) return true;
  if (/\.test\.[jt]sx?$/.test(rel)) return true;
  if (rel.startsWith("src/tests/")) return true;
  if (rel.startsWith("src/test/")) return true;
  if (rel.endsWith(".d.ts")) return true;
  // the particle engine is a canvas renderer — no text nodes
  if (rel.startsWith("src/shared/particle-engine/")) return true;
  return false;
}

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

// --- string extraction --------------------------------------------------------

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
  // iso dates, times, currencies, phone-ish, codes
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return true;
  if (/^[A-Z]{2,3}-\d+$/.test(trimmed)) return true; // PAR-0001 style codes
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(trimmed)) return true; // emails
  return false;
}

function hasLetters(s) {
  return /[a-zA-ZàâäçéèêëîïôöùûüÿñæœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸÑÆŒ\u0600-\u06FF]/.test(s);
}

// brand strings that stay untranslated in every locale (proper nouns)
const BRAND_STRINGS = new Set([
  "El-Imtiyaz",
  "EI",
  "El-Imtiyaz Educational & Operational Management Platform",
]);

const findings = [];

function addFinding(file, node, text, kind) {
  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  const rel = relative(ROOT, file).split("/").join("/");
  findings.push({
    file: rel,
    line: line + 1,
    kind,
    text: text.replace(/\s+/g, " ").trim(),
  });
}

function visitJsxText(node, file) {
  const raw = node.getText();
  const cleaned = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const decoded = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const visible = decoded.trim();
  if (visible.length >= minChars && hasLetters(visible) && !BRAND_STRINGS.has(visible)) {
    addFinding(file, node, visible, "jsx-text");
  }
}

function visitStringLiteral(node, file, context) {
  const s = node.text;
  if (s.length < minChars) return;
  if (!hasLetters(s)) return;
  if (looksLikeTechnical(s)) return;
  if (BRAND_STRINGS.has(s)) return;
  addFinding(file, node, s, context);
}

function visitTemplateLiteral(node, file, context) {
  for (const chunk of [node.head, ...(node.templateSpans || []).map((sp) => sp.literal)]) {
    if (!chunk) continue;
    const s = chunk.getText ? chunk.getText() : String(chunk);
    const cleaned = s.replace(/^[`}${]+/, "").replace(/[${}`]+$/, "");
    if (cleaned.length >= minChars && hasLetters(cleaned) && !looksLikeTechnical(cleaned)) {
      addFinding(file, node, cleaned, context + "-template");
    }
  }
}

function flattenConcat(binExpr) {
  const parts = [];
  function walk(n) {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      walk(n.left);
      walk(n.right);
    } else parts.push(n);
  }
  walk(binExpr);
  return parts;
}

function visitJsxExpression(node, file) {
  if (!node.expression) return;
  const e = node.expression;
  if (ts.isStringLiteral(e)) {
    visitStringLiteral(e, file, "jsx-expression");
  } else if (ts.isNoSubstitutionTemplateLiteral(e)) {
    const s = e.text;
    if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s)) {
      addFinding(file, e, s, "jsx-expression");
    }
  } else if (ts.isConditionalExpression(e)) {
    for (const branch of [e.whenTrue, e.whenFalse]) {
      if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) {
        visitStringLiteral(branch, file, "jsx-ternary");
      } else if (ts.isTemplateExpression(branch)) {
        visitTemplateLiteral(branch, file, "jsx-ternary");
      }
    }
  } else if (
    ts.isBinaryExpression(e) &&
    (e.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    const right = e.right;
    if (ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right)) {
      visitStringLiteral(right, file, "jsx-fallback");
    }
  } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const parts = flattenConcat(e);
    for (const p of parts) {
      if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) {
        const s = p.text;
        if (s.length >= minChars && hasLetters(s) && !looksLikeTechnical(s)) {
          addFinding(file, p, s, "jsx-concat");
        }
      }
    }
  }
}

function visitCallExpression(node, file) {
  const callee = node.expression;
  let name = null;
  const fullText = callee.getText();
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;

  if (fullText.startsWith("console.")) return;
  // logger.* is developer-facing
  if (fullText.startsWith("logger.")) return;

  if (name && VISIBLE_CALLS.has(name)) {
    for (const arg of node.arguments) {
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        visitStringLiteral(arg, file, `call:${name}`);
      } else if (ts.isTemplateExpression(arg)) {
        visitTemplateLiteral(arg, file, `call:${name}`);
      }
    }
  }
  // `new Error("...")` strings are deliberately NOT reported — developer invariants
}

function visit(node, file) {
  if (ts.isJsxText(node)) {
    visitJsxText(node, file);
    return;
  }

  if (ts.isJsxAttribute(node)) {
    const attrName = node.name.text;
    const inVisible = VISIBLE_PROPS.has(attrName);
    if (inVisible && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) {
        visitStringLiteral(init, file, `attr:${attrName}`);
      } else if (ts.isJsxExpression(init) && init.expression) {
        const e = init.expression;
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
          visitStringLiteral(e, file, `attr:${attrName}`);
        }
      }
    }
    return;
  }

  if (ts.isJsxExpression(node)) {
    visitJsxExpression(node, file);
    if (node.expression) visit(node.expression, file);
    return;
  }

  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    visitCallExpression(node, file);
  }

  ts.forEachChild(node, (child) => visit(child, file));
}

// --- main ----------------------------------------------------------------------

const files = SCAN_DIRS.flatMap((d) =>
  listSourceFiles(join(SRC, d)).filter((f) => !shouldExcludeFile(f)),
);
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  sf.forEachChild((node) => visit(node, file));
}

// dedupe (file, line, text)
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.file}:${f.line}:${f.text}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

writeFileSync(OUT_REPORT, JSON.stringify(unique, null, 2));

const byFile = {};
const byKind = {};
for (const f of unique) {
  byFile[f.file] = (byFile[f.file] || 0) + 1;
  byKind[f.kind] = (byKind[f.kind] || 0) + 1;
}

console.log(`\n=== ${unique.length} hardcoded user-visible strings in ${Object.keys(byFile).length} files ===\n`);
console.log("By kind:", JSON.stringify(byKind, null, 2));
console.log("\nBy file:");
for (const [file, count] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${file}`);
}
console.log(`\nFull report: ${OUT_REPORT}`);
process.exit(unique.length > 0 ? 1 : 0);
