// Run from the desktop package. Pass the website checkout as the first argument.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const website = process.argv[2];
if (!website) throw new Error("Pass the website checkout path");
const groups = new Map();
let files = 0;
let functions = 0;
for (const [label, root, dirs] of [["desktop", ".", ["src","electron","supabase/functions"]], ["website", website, ["src"]]]) {
  const paths = execFileSync("git", ["ls-files", "-z", "--", ...dirs], {cwd:root,encoding:"utf8"}).split("\0").filter(Boolean);
  for (const path of paths.filter(p => /\.[cm]?tsx?$/.test(p) && !/(?:\.test\.|\.spec\.|\/tests\/|\.d\.ts$)/.test(p))) {
    const source = ts.createSourceFile(path, readFileSync(join(root,path),"utf8"), ts.ScriptTarget.Latest, true);
    files++;
    function visit(node) {
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body) {
        const start = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
        if (end - start >= 5) {
          const body = node.body.getText(source);
          const hash = createHash("sha256").update(body).digest("hex");
          if (!groups.has(hash)) groups.set(hash, []);
          groups.get(hash).push({repo:label,path,name:node.name.getText(source),start,end});
          functions++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
const matches = [...groups].filter(([,rows]) => rows.length > 1);
console.log(JSON.stringify({typescript:ts.version,files,functions,groups:matches.length,matches}));
