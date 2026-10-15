/**
 * T-546 (UI-354) pre-test: every glossary formula must render in KaTeX
 * without errors (throwOnError: true — stricter than the component's
 * graceful-fallback mode). Run from elimtiyaz-desktop/.
 */
import katex from "katex";
import { STAT_TIPS_FR, STAT_TIPS_EN, STAT_TIPS_AR } from "../src/i18n/stats-tips";

type Tree = typeof STAT_TIPS_FR;

function collectFormulas(tree: Tree, locale: string): Array<{ key: string; tex: string }> {
  const out: Array<{ key: string; tex: string }> = [];
  for (const [group, entries] of Object.entries(tree)) {
    if (group === "_meta") continue;
    for (const [leaf, entry] of Object.entries(entries as Record<string, { formula?: string }>)) {
      if (entry?.formula) out.push({ key: `${locale}:${group}.${leaf}`, tex: entry.formula });
    }
  }
  return out;
}

let pass = 0;
let fail = 0;
for (const tree of [
  ["FR", STAT_TIPS_FR],
  ["EN", STAT_TIPS_EN],
  ["AR", STAT_TIPS_AR],
] as Array<[string, Tree]>) {
  for (const { key, tex } of collectFormulas(tree[1], tree[0])) {
    for (const display of [false, true]) {
      try {
        const html = katex.renderToString(tex, {
          displayMode: display,
          throwOnError: true,
          strict: "ignore",
          output: "html",
        });
        if (html.includes("katex-error")) {
          console.error(`EMBEDDED ERROR ${key} (display=${display})`);
          fail++;
        } else {
          pass++;
        }
      } catch (err) {
        console.error(`THROW ${key} (display=${display}): ${(err as Error).message}`);
        fail++;
      }
    }
  }
}
console.log(`\nKaTeX render check: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
