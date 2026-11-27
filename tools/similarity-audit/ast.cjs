// Emit candidates only. A structural match can change the meaning of a name or literal.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ts = require("typescript");
const groups = new Map();
function add(method, key, location) {
  const bucket = method + ":" + crypto.createHash("sha256").update(key).digest("hex");
  if (!groups.has(bucket)) groups.set(bucket, {method, locations: []});
  groups.get(bucket).locations.push(location);
}
function walkDirectory(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkDirectory(file); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
           ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
        const start = source.getLineAndCharacterOfPosition(node.body.getStart()).line + 1;
        const end = source.getLineAndCharacterOfPosition(node.body.end).line + 1;
        if (end - start >= 4) {
          const loc = [file,start,end];
          add("ast-exact",node.body.getText(source),loc);
          const tokens = [];
          function shape(n) {
            tokens.push(n.kind);
            ts.forEachChild(n,shape);
            tokens.push(-1);
          }
          shape(node.body);
          if (tokens.length >= 60) add("ast-structure",tokens.join(","),loc);
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
}
walkDirectory(".");
console.log(JSON.stringify([...groups.values()].filter(g => g.locations.length > 1)));
