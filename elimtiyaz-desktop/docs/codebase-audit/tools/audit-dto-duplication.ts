/**
 * audit-dto-duplication.ts — semantic DTO/type duplication scanner.
 * Part of the Codebase Intelligence, Architecture & Duplication Audit.
 * Run: npx tsx docs/codebase-audit/tools/audit-dto-duplication.ts
 *
 * Groups exported interfaces / type aliases by a normalized structural
 * signature (sorted member names + primitive-normalized types) so that
 * structurally identical or near-identical DTOs across files are found.
 */
import { Project, SyntaxKind, InterfaceDeclaration, TypeAliasDeclaration } from "ts-morph";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../");
const project = new Project({
  tsConfigFilePath: resolve(ROOT, "tsconfig.json"),
  skipAddingFilesFromTsConfig: false,
});

interface TypeSig { name: string; file: string; members: string[]; line: number }

const sigs: TypeSig[] = [];

function memberSignature(m: { getName(): string; getType(): any; getStructure(): any }): string {
  let t = "any";
  try { t = m.getType().getText(undefined, 1 /* TypeFormatFlags.UseAliasDefinedOutsideCurrentScope */); } catch { /* noop */ }
  // normalize structural noise: strip whitespace, qualify primitives
  return `${m.getName()}: ${t.replace(/\s+/g, " ")}`;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").replace(/import\("[^"]*"\)\./g, "").trim();
}

for (const sf of project.getSourceFiles()) {
  const rel = sf.getFilePath().replace(ROOT + "/", "");
  if (!rel.startsWith("src/") && !rel.startsWith("electron/")) continue;
  if (rel.includes("/tests/") || rel.includes(".test.")) continue;

  const collect = (d: InterfaceDeclaration | TypeAliasDeclaration) => {
    let members: string[] = [];
    if (d.getKind() === SyntaxKind.InterfaceDeclaration) {
      members = (d as InterfaceDeclaration).getMembers().map((m: any) => {
        try { return memberSignature(m); } catch { return "member:?"; }
      });
    } else {
      const td = d as TypeAliasDeclaration;
      const t = td.getTypeNode();
      if (!t) return;
      const kind = t.getKind();
      if (kind === SyntaxKind.TypeLiteral) {
        members = t.getChildrenOfKind(SyntaxKind.PropertySignature as any).map((m: any) => {
          try { return memberSignature(m); } catch { return "member:?"; }
        });
      } else if (kind === SyntaxKind.UnionType) {
        members = t.getDescendants().filter((n: any) => n.getKind() === SyntaxKind.LiteralType).map((n: any) => norm(n.getText()));
      } else if (kind === SyntaxKind.TypeReference) {
        members = [norm(t.getText())];
      } else return;
    }
    sigs.push({ name: d.getName() ?? "<anon>", file: rel, line: d.getStartLineNumber(), members: members.map(norm) });
  };

  for (const d of sf.getInterfaces()) if (d.isExported()) collect(d);
  for (const d of sf.getTypeAliases()) if (d.isExported()) collect(d);
}

// 1. exact structural groups (same sorted member list)
const byExact = new Map<string, TypeSig[]>();
for (const s of sigs) {
  const key = s.members.slice().sort().join(" | ");
  if (!byExact.has(key)) byExact.set(key, []);
  byExact.get(key)!.push(s);
}
const exactGroups = [...byExact.values()].filter((g) => g.length > 1);

// 2. name-set groups (same property names, possibly different types) — semantic near-dupes
const byNames = new Map<string, TypeSig[]>();
for (const s of sigs) {
  const key = s.members.map((m) => m.split(":")[0]).filter((n) => n && n !== "member:?").sort().join(",");
  if (!key) continue;
  if (!byNames.has(key)) byNames.set(key, []);
  byNames.get(key)!.push(s);
}
const nameGroups = [...byNames.values()].filter((g) => g.length > 1 && new Set(g.map((x) => x.file)).size > 1);

const out = {
  generatedAt: new Date().toISOString(),
  totalExportedTypes: sigs.length,
  exactDuplicateGroups: exactGroups.map((g) => ({ count: g.length, types: g.map((t) => `${t.file}:${t.line} ${t.name}`) })),
  sameMemberNameGroups: nameGroups.map((g) => ({ count: g.length, types: g.map((t) => `${t.file}:${t.line} ${t.name}`) })),
};

mkdirSync(resolve(HERE, "../raw"), { recursive: true });
writeFileSync(resolve(HERE, "../raw/tsmorph-dto-duplication.json"), JSON.stringify(out, null, 2));
console.log(`exported types: ${sigs.length}`);
console.log(`exact structural duplicate groups: ${exactGroups.length}`);
console.log(`same-member-name groups (multi-file): ${nameGroups.length}`);
