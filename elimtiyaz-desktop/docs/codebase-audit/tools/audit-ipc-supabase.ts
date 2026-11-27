/**
 * audit-ipc-supabase.ts — IPC contract audit + Supabase client usage audit.
 * Part of the Codebase Intelligence, Architecture & Duplication Audit.
 * Run: npx tsx docs/codebase-audit/tools/audit-ipc-supabase.ts
 *
 * A) IPC: registers every ipcMain.handle/on channel (electron/) and every
 *    ipcRenderer.invoke channel (preload + src), then diffs them:
 *    - registered-but-never-invoked (dead IPC surface)
 *    - invoked-but-never-registered (broken contract)
 * B) Supabase usage: every .from("table") / .rpc("fn") call site, flags
 *    select() without limit/range (unpaginated reads), counts per table.
 */
import { Project, SyntaxKind, CallExpression, StringLiteral } from "ts-morph";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../");
const project = new Project({
  tsConfigFilePath: resolve(ROOT, "tsconfig.json"),
  skipAddingFilesFromTsConfig: false,
});

const registered = new Set<string>();
const invoked = new Set<string>();
const ipcFiles: Record<string, number> = {};
const invokeFiles: Record<string, number> = {};

function rel(p: string) { return p.replace(ROOT + "/", ""); }

for (const sf of project.getSourceFiles()) {
  const r = rel(sf.getFilePath());
  const inElectron = r.startsWith("electron/");
  const inSrc = r.startsWith("src/") || r.startsWith("electron/");
  if (!inElectron && !r.startsWith("src/")) continue;

  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const exprText = call.getExpression().getText();

    // A) ipcMain.handle("ch", ...) / ipcMain.on("ch", ...)
    if (inElectron && (exprText.endsWith(".handle") || exprText.endsWith(".on")) && exprText.includes("ipcMain")) {
      const arg0 = call.getArguments()[0];
      const chName = arg0?.getKind() === SyntaxKind.StringLiteral ? (arg0 as StringLiteral).getLiteralText() : undefined;
      if (chName) {
        registered.add(`${exprText.endsWith(".on") ? "on" : "handle"}:${chName}`);
        ipcFiles[chName] = (ipcFiles[chName] ?? 0) + 1;
      }
    }
    // ipcRenderer.invoke("ch", ...) anywhere (preload; renderer never touches ipcRenderer directly)
    if (inSrc && r.startsWith("electron/") && exprText.includes("ipcRenderer") && exprText.endsWith(".invoke")) {
      const arg0 = call.getArguments()[0];
      const chName = arg0?.getKind() === SyntaxKind.StringLiteral ? (arg0 as StringLiteral).getLiteralText() : undefined;
      if (chName) {
        invoked.add(chName);
        invokeFiles[chName] = (invokeFiles[chName] ?? 0) + 1;
      }
    }
  });
}

// B) Supabase usage census across src (renderer + infra)
interface FromSite { file: string; line: number; table: string }
const fromSites: FromSite[] = [];
const rpcSites: FromSite[] = [];
const unboundedSelects: FromSite[] = [];
const serviceRoleSuspects: { file: string; line: number; text: string }[] = [];

for (const sf of project.getSourceFiles()) {
  const r = rel(sf.getFilePath());
  if (!r.startsWith("src/")) continue;
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const expr = call.getExpression().getText();

    const arg0 = call.getArguments()[0];
    const lit = arg0?.getKind() === SyntaxKind.StringLiteral ? (arg0 as StringLiteral).getLiteralText() : undefined;

    if (/\.from$/.test(expr) && lit) {
      fromSites.push({ file: r, line: call.getStartLineNumber(), table: lit });
      // walk up the chain: check whether this query chain has .select without .limit/.range
      const chain = call.getParentWhile((n) => n.getKind() === SyntaxKind.PropertyAccessExpression || n.getKind() === SyntaxKind.CallExpression);
      const chainText = chain?.getText().slice(0, 900) ?? "";
      if (chainText.includes(".select(") && !chainText.includes(".limit(") && !chainText.includes(".range(")) {
        unboundedSelects.push({ file: r, line: call.getStartLineNumber(), table: lit });
      }
    }
    if (/\.rpc$/.test(expr) && lit) {
      rpcSites.push({ file: r, line: call.getStartLineNumber(), table: lit });
    }
  });

  // service-role exposure check: only REAL key literals (sb_secret_ / sbp_ / service_role
  // assigned to a string), not comment prose. ts-morph gives us string literals only:
  const text = sf.getFullText();
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const v = lit.getLiteralText();
    if (v.startsWith("sb_secret_") || (v.startsWith("sbp_") && v.length > 30)) {
      serviceRoleSuspects.push({ file: r, line: lit.getStartLineNumber(), text: v.slice(0, 18) + "<redacted>" });
    }
    if (/^eyJ[A-Za-z0-9_-]{40,}/.test(v)) {
      serviceRoleSuspects.push({ file: r, line: lit.getStartLineNumber(), text: "JWT-looking literal (len " + v.length + ")" });
    }
  }
  void text;
}

const tableCounts = fromSites.reduce<Record<string, number>>((acc, s) => { acc[s.table] = (acc[s.table] ?? 0) + 1; return acc; }, {});
const rpcCounts = rpcSites.reduce<Record<string, number>>((acc, s) => { acc[s.table] = (acc[s.table] ?? 0) + 1; return acc; }, {});

const out = {
  generatedAt: new Date().toISOString(),
  ipc: {
    registeredChannels: [...registered].sort(),
    invokedChannels: [...invoked].sort(),
    registeredButNeverInvoked: [...registered].filter((c) => !invoked.has(c.split(":").slice(1).join(":"))),
    invokedButNeverRegistered: [...invoked].filter((c) => !registered.has(`handle:${c}`) && !registered.has(`on:${c}`)),
  },
  supabase: {
    distinctTablesReferenced: Object.keys(tableCounts).length,
    tableCounts,
    rpcCounts,
    totalFromCalls: fromSites.length,
    unboundedSelects: unboundedSelects.length,
    unboundedSelectSites: unboundedSelects.slice(0, 80),
    serviceRoleSuspects: serviceRoleSuspects.slice(0, 20),
  },
};

mkdirSync(resolve(HERE, "../raw"), { recursive: true });
writeFileSync(resolve(HERE, "../raw/tsmorph-ipc-supabase.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  registered: registered.size,
  invoked: invoked.size,
  registeredButNeverInvoked: out.ipc.registeredButNeverInvoked.length,
  invokedButNeverRegistered: out.ipc.invokedButNeverRegistered.length,
  distinctTables: Object.keys(tableCounts).length,
  unboundedSelects: unboundedSelects.length,
  serviceRoleSuspects: serviceRoleSuspects.length,
}, null, 2));
