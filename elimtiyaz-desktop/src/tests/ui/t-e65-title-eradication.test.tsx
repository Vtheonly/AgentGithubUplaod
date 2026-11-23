/**
 * E6.5 (UI-U5 / DUP-026) — the native title= eradication suite.
 *
 * The deliverable: EVERY native HTML `title=` attribute (browser tooltips)
 * in application source renders through the shared Radix Tooltip instead,
 * via the new `TooltipHint` wrapper (shared/ui/tooltip.tsx).
 *
 *   1. TOOLTIPHINT CONTRACT (behavioral):
 *      - empty content (null/undefined/"") renders the child bare — the
 *        native-title semantics preserved (title={undefined} showed nothing);
 *      - non-empty content renders the Radix tooltip surface on focus;
 *      - the wrapper FORWARDS unknown props + ref onto the child, so a hint
 *        mounted inside another asChild Slot (DropdownMenuTrigger asChild,
 *        …) keeps the outer trigger semantics (the composability contract);
 *      - list keys sit ON the wrapper (React's key rule for mapped items).
 *
 *   2. THE SOURCE CENSUS GATE (permanent): a JSX-scanner sweep over the
 *      application src tree (.tsx and .ts; tests/stories excluded)
 *      asserting ZERO native title= attributes remain on lowercase (HTML)
 *      elements. The scanner is multi-line aware and quotes-in-children
 *      aware (the S9 lexer lessons) — a naive single-line regex undercounts.
 *
 * Census at registration (S50): C-10's 194/102 counted every `title=` token
 * including COMPONENT LABEL PROPS; the true native-attribute census at HEAD
 * measured 89 sites across 40 files (the deeper codemod scanner found 23+
 * beyond the initial 46/28 naive count) — all converted in this task.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";
import { TooltipHint } from "../../shared/ui/tooltip";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 1. The TooltipHint behavioral contract
// ---------------------------------------------------------------------------
describe("E6.5 — the TooltipHint primitive", () => {
  it("renders the child bare when content is null/undefined/empty — the native-title semantics", () => {
    const { container, rerender } = render(
      <TooltipHint content={undefined}>
        <button type="button">bare</button>
      </TooltipHint>,
    );
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.querySelector("[data-radix-popper-content-wrapper]")).toBeNull();
    rerender(
      <TooltipHint content={""}>
        <button type="button">bare</button>
      </TooltipHint>,
    );
    expect(container.querySelector("button")).not.toBeNull();
    // no tooltip surface mounts for empty content
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders the hint text through the Radix tooltip on focus", async () => {
    render(
      <TooltipHint content="Infobulle partagée">
        <button type="button">cible</button>
      </TooltipHint>,
    );
    fireEvent.focus(screen.getByText("cible"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Infobulle partagée");
  });

  it("forwards unknown props + ref onto the child (asChild Slot composability)", () => {
    const ref = React.createRef<HTMLButtonElement>();
    const { container } = render(
      // simulates an outer Slot (e.g. DropdownMenuTrigger asChild) cloning
      // the hint with its trigger props — they must reach the DOM child
      <TooltipHint content="x" id="outer-slot-id" data-outer="1" ref={ref}>
        <button type="button">cible</button>
      </TooltipHint>,
    );
    const btn = container.querySelector("button");
    expect(btn?.id).toBe("outer-slot-id");
    expect(btn?.getAttribute("data-outer")).toBe("1");
    expect(ref.current).toBe(btn);
  });

  it("accepts the list key on the wrapper (the mapped-item contract)", () => {
    const items = ["a", "b"];
    const { container } = render(
      <div>
        {items.map((k) => (
          <TooltipHint key={k} content={`hint ${k}`}>
            <span>{k}</span>
          </TooltipHint>
        ))}
      </div>,
    );
    expect(container.querySelectorAll("span").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. The source census gate — ZERO native title= remains
// ---------------------------------------------------------------------------
// Compact JSX scanner (the codemod's, read-only): finds native title= attrs
// on lowercase elements. Quotes are strings in CODE/EXPR but TEXT in JSX
// children (French apostrophes); tags inside expressions follow the
// keyword/operator predecessor heuristic.
const KEYWORDS_BEFORE_TAG = new Set(["return", "throw", "case", "do", "else", "yield", "await", "default"]);
const OPERATOR_BEFORE_TAG = ">{,:;(&|=?![-+*%~^";

function skipString(s: string, i: number): number {
  const q = s[i];
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (q === "`" && c === "$" && s[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < s.length && depth > 0) {
        const ch = s[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === '"' || ch === "'" || ch === "`") { i = skipString(s, i); continue; }
        i++;
      }
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}
const skipLine = (s: string, i: number) => { while (i < s.length && s[i] !== "\n") i++; return i; };
const skipBlock = (s: string, i: number) => { i += 2; while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++; return Math.min(i + 2, s.length); };
function skipBraces(s: string, i: number): number {
  let depth = 0;
  do {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(s, i); continue; }
    if (ch === "/" && s[i + 1] === "/") { i = skipLine(s, i); continue; }
    if (ch === "/" && s[i + 1] === "*") { i = skipBlock(s, i); continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  } while (i < s.length && depth > 0);
  return i;
}
function prevToken(s: string, i: number): { word: string; prevChar: string } {
  let j = i;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (j < 0) return { word: "", prevChar: "" };
  if (!/[A-Za-z0-9_$]/.test(s[j])) return { word: "", prevChar: s[j] };
  let end = j;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(s[j])) j--;
  return { word: s.slice(j + 1, end + 1), prevChar: s[end] };
}

/** All native (lowercase-tag) title= attribute sites in a source text. */
export function findNativeTitleSites(s: string): Array<{ line: number; tag: string }> {
  const sites: Array<{ line: number; tag: string }> = [];
  const tags: Array<{ name: string; native: boolean; hasTitle: boolean }> = [];
  const modes: string[] = ["CODE"];
  let i = 0;
  const lineOf = (idx: number) => s.slice(0, idx).split("\n").length;
  while (i < s.length) {
    const mode = modes[modes.length - 1];
    const c = s[i];
    if (c === "/" && s[i + 1] === "/") { i = skipLine(s, i); continue; }
    if (c === "/" && s[i + 1] === "*") { i = skipBlock(s, i); continue; }
    if (mode !== "CHILDREN" && (c === '"' || c === "'" || c === "`")) { i = skipString(s, i); continue; }
    if (c === "{") { modes.push("EXPR"); i++; continue; }
    if (c === "}") { if (modes.length > 1) modes.pop(); i++; continue; }
    if (c === "<") {
      const nx = s[i + 1] ?? "";
      const isClose = nx === "/";
      const isFrag = nx === ">";
      const isName = /^[A-Za-z]$/.test(nx);
      if (isClose || isFrag || isName) {
        let isTag = true;
        if (mode !== "CHILDREN" && isName) {
          const { word, prevChar } = prevToken(s, i - 1);
          isTag = word !== "" ? KEYWORDS_BEFORE_TAG.has(word) : (prevChar === "" || OPERATOR_BEFORE_TAG.includes(prevChar));
        }
        if (isTag) {
          if (isClose) {
            const nameM = /^[A-Za-z][A-Za-z0-9._-]*/.exec(s.slice(i + 2));
            const closeName = s[i + 2] === ">" ? "" : (nameM ? nameM[0] : null);
            if (closeName === null) { i++; continue; }
            let p = i + 2 + (closeName ? closeName.length : 0);
            while (p < s.length && /\s/.test(s[p])) p++;
            if (s[p] === ">") p++;
            let el: { name: string; native: boolean; hasTitle: boolean } | null = null;
            while (tags.length) {
              if (modes.length > 1) modes.pop();
              const top = tags.pop()!;
              if (top.name === closeName) { el = top; break; }
            }
            i = p;
            if (el?.native && el.hasTitle) sites.push({ line: lineOf(i), tag: el.name });
            continue;
          }
          if (isFrag) { tags.push({ name: "", native: false, hasTitle: false }); modes.push("CHILDREN"); i += 2; continue; }
          // start tag: scan its attribute region for title=
          const nameM = /^[A-Za-z][A-Za-z0-9._-]*/.exec(s.slice(i + 1));
          if (!nameM) { i++; continue; }
          const name = nameM[0];
          let p = i + 1 + name.length;
          let hasTitle = false;
          let selfClosing = false;
          let guard = 0;
          while (p < s.length && guard++ < 200000) {
            const ac = s[p];
            if (/\s/.test(ac)) { p++; continue; }
            if (ac === "/" && s[p + 1] === ">") { selfClosing = true; break; }
            if (ac === ">") break;
            if (ac === "{") { p = skipBraces(s, p); continue; }
            if (ac === '"' || ac === "'" || ac === "`") { p = skipString(s, p); continue; }
            const attrM = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(s.slice(p));
            if (!attrM) { p++; continue; }
            if (attrM[0] === "title") {
              let q = p + attrM[0].length;
              while (q < s.length && /\s/.test(s[q])) q++;
              if (s[q] === "=") hasTitle = true;
            }
            p += attrM[0].length;
            let q = p;
            while (q < s.length && /\s/.test(s[q])) q++;
            if (s[q] === "=") {
              q++;
              while (q < s.length && /\s/.test(s[q])) q++;
              if (s[q] === '"' || s[q] === "'") { const qs = q; q++; while (q < s.length && s[q] !== s[qs]) q++; p = q + 1; }
              else if (s[q] === "{") p = skipBraces(s, q);
              else p = q;
            }
            continue;
          }
          if (selfClosing) {
            i = p + 2;
            if (/^[a-z]/.test(name) && hasTitle) sites.push({ line: lineOf(i), tag: name });
            continue;
          }
          tags.push({ name, native: /^[a-z]/.test(name), hasTitle });
          modes.push("CHILDREN");
          i = p + 1;
          continue;
        }
      }
    }
    i++;
  }
  return sites;
}

// --- the sweep itself -------------------------------------------------------
import { readdirSync, statSync } from "node:fs";

const TESTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // = src/

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.(tsx|ts)$/.test(name) && !/(test|spec|stories)\./.test(name) && !p.includes(join("src", "tests"))) files.push(p);
  }
  return files;
}

describe("E6.5 — the native title= census gate (DUP-026)", () => {
  it("application source carries ZERO native title= attributes — every hover hint renders through the shared Radix Tooltip", () => {
    const files = walk(TESTS_ROOT);
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const site of findNativeTitleSites(src)) offenders.push(`${f.replace(TESTS_ROOT, "")}:${site.line} <${site.tag} title=…>`);
    }
    expect(offenders, `native title= found (convert to <TooltipHint content=…>):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the census scanner itself is sound — it finds a native title= in a crafted fixture", () => {
    const fixture = [
      "const Label = 'l\\'année'; // apostrophe in code string",
      "export function X() {",
      "  return (",
      "    <div className=\"x\">",
      "      <span title=\"astuce\">texte</span>",
      "      <Comp title=\"label prop — NOT counted\" />",
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    const sites = findNativeTitleSites(fixture);
    expect(sites.length).toBe(1);
    expect(sites[0].tag).toBe("span");
  });
});
