// Run from elimtiyaz-desktop with Node 24 and the desktop TypeScript installation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function declaration(path, name) {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  return fn.getText(file).replace(/^export /, "");
}

const domain = "src/domain/calc/workflow/";
const edge = "supabase/functions/workflow-execute/engine.ts";
function load(conditionFile, routeFile) {
  const code = declaration(conditionFile, "parseConditionConfig") + "\n" + declaration(routeFile, "parseSwitchRoutes");
  const ctx = vm.createContext({});
  vm.runInContext(ts.transpile(code, {target: ts.ScriptTarget.ES2022}), ctx);
  return ctx;
}
const preview = load(domain + "condition-evaluator.ts", domain + "dry-run.ts");
const executor = load(edge, edge);
const comparisons = [">", "<", ">=", "<=", "==", "!=", "bad"].map(op => ({kind:"comparison", field:"debt", op, value:0}));
const conditions = [undefined, null, 0, "", "bad", {}, ...comparisons, ...comparisons.map(c => JSON.stringify(c)),
  ...["and", "or", "not", "invalid"].map(combinator => ({kind:"logic", combinator, children:[null, ...comparisons]}))];
let checks = 0;
for (const c of conditions) {
  for (const [name, input] of [["parseConditionConfig", c], ["parseSwitchRoutes", [null, {label:" ", condition:c}, {label:" A ", condition:c}]]]) {
    assert.equal(JSON.stringify(preview[name](input)), JSON.stringify(executor[name](input)));
    checks++;
  }
}
console.log(checks + " preview/Edge parser comparisons passed");
