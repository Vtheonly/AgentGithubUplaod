/**
 * ImportConfigRegistry unit tests — T-414 (IMPORT-111 / ADR-026).
 *
 * Verifies the centralized configuration repository's contract:
 *   1. Seeded with the two built-in format documents (old + new).
 *   2. Structural validation: rejects broken documents (no fields,
 *      unaddressable fields, invalid column letters, unresolvable
 *      identity, duplicate keys) with precise issue paths.
 *   3. resolve/resolveAll: documents compile to the engine's runtime
 *      ImportSchemas (regex matchers, identity, field keys, column
 *      addressing carried through).
 *   4. Detection: name-only tier 1, header-signature disambiguation for
 *      the SAME sheet name across formats, tier-2 fallback, priority.
 *   5. Versioning + enable/disable management + explicit selection.
 *   6. The extension points: the EntityMatcher NO-OP default (profile
 *      matching explicitly NOT implemented — the mandate).
 */
import { describe, it, expect } from "vitest";
import {
  importConfigRegistry,
  ImportConfigRegistry,
  validateImportConfigDocument,
  compileSheetConfig,
  NoOpEntityMatcher,
  type ImportConfigDocument,
} from "../../infrastructure/excel/import-config";

const OLD_HEADER = ["", "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE"];
const NEW_HEADER = [
  "", "INFOS", "E-MAIL", "NEM", "TUTEUR", "", "niveau", "CLASSE", "OPTION",
  "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
  "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE", "FI", "V1", "2V",
  "v3", "DISTINATION", "1T", "T2", "t3", "PSY1", "PSY2", "PSY3", "PSY4",
  "PSY5", "PSY6", "PSY7", "PSY8", "PSY9", "PSY10", "PSY11", "PSY12", "PSY13",
  "PSY14", "CREANCE SEPT", "CREANCE SEPT", "CREANCE SEPT", "TT CREANCE",
  "COURS SUP", "LIVRES", "CLUB", "SORTIES",
];

describe("T-414 ImportConfigRegistry — the centralized configuration repository", () => {
  it("is seeded with the two built-in format documents", () => {
    const summaries = importConfigRegistry.listSummaries();
    expect(summaries.map((s) => s.id).sort()).toEqual(["etat-2026-2027", "etat-2027-2026"]);
    const old = summaries.find((s) => s.id === "etat-2026-2027")!;
    expect(old.sheetNames).toEqual(["etat", "ref", "bon", "devis"]);
    const fresh = summaries.find((s) => s.id === "etat-2027-2026")!;
    expect(fresh.sheetNames).toEqual(["etat"]);
    expect(fresh.enabled).toBe(true);
  });

  it("resolves documents to the engine's runtime ImportSchemas", () => {
    const old = importConfigRegistry.resolve("etat-2026-2027");
    expect(old.length).toBe(4);
    const etat = old.find((s) => s.name === "etat")!;
    expect(etat.sheetMatchers[0].test("ETAT 20262027")).toBe(true);
    expect(etat.identity).toEqual({ fields: ["NEM", "NOM"], strategy: "upsert" });
    const nomField = etat.fields.find((f) => f.key === "nom")!;
    expect(nomField.header).toBe("NOM");
    expect(nomField.required).toBe(true);

    const fresh = importConfigRegistry.resolve("etat-2027-2026");
    const freshEtat = fresh.find((s) => s.name === "etat")!;
    // The 2027-2026 field count: 24 shared columns (B–Y minus the
    // unmapped A) + PSY1..PSY14 + creanceSept×3 + ttCreance +
    // coursSup/livres/club/sorties.
    expect(freshEtat.fields.length).toBe(24 + 14 + 4 + 4);
    const freshNom = freshEtat.fields.find((f) => f.key === "nom")!;
    expect(freshNom.column).toBe("F"); // positional — headerless column
    const v1 = freshEtat.fields.find((f) => f.key === "v2")!;
    expect(v1.header).toBe("V1"); // the relabeled 1st installment
    expect(v1.column).toBe("S");
    const creanceSept2 = freshEtat.fields.find((f) => f.key === "creanceSept2")!;
    expect(creanceSept2.column).toBe("AO"); // shared-header disambiguation
  });

  it("DETECTS the format by header signature when the sheet NAME collides", () => {
    // Both formats declare "ETAT 20262027"-style sheets — the name-only
    // shortlist has two candidates.
    const nameMatches = importConfigRegistry.identify("ETAT 20262027");
    expect(nameMatches.length).toBe(2);

    // The OLD header row (NOM present, no V1) → the old format's schema.
    const old = importConfigRegistry.detect("ETAT 20262027", OLD_HEADER);
    expect(old).not.toBeNull();
    expect(old!.requiredHeaders).toContain("NOM");

    // The NEW header row (no NOM, V1+LIVRES+CLUB+SORTIES present) → the
    // new format's schema.
    const fresh = importConfigRegistry.detect("ETAT 20262027", NEW_HEADER);
    expect(fresh).not.toBeNull();
    expect(fresh!.requiredHeaders).toContain("V1");
    expect(fresh).not.toBe(old);

    // Without a header row the name-only fallback returns the FIRST
    // candidate in detection order (the corpus-tested old format, priority
    // 100 < 110).
    const noHeader = importConfigRegistry.detect("ETAT 20262027");
    expect(noHeader!.requiredHeaders).toContain("NOM");

    // Unknown sheet name + no headers → null.
    expect(importConfigRegistry.detect("Feuille Inconnue")).toBeNull();

    // Tier-2: unknown NAME but a matching header signature still detects.
    const tier2 = importConfigRegistry.detect("Copy of ETAT", NEW_HEADER);
    expect(tier2).not.toBeNull();
    expect(tier2!.requiredHeaders).toContain("V1");
  });

  it("compiles sheet configs faithfully (matchers → RegExp, fields carried)", () => {
    const doc = importConfigRegistry.get("etat-2027-2026")!;
    const schema = compileSheetConfig(doc.sheets[0]);
    expect(schema.name).toBe("etat");
    expect(schema.sheetMatchers.map((r) => r.source)).toEqual(["^ETAT", "^ETAT\\s*\\d+"]);
    expect(schema.headerRow).toBe(1);
    const psy14 = schema.fields.find((f) => f.key === "psy14")!;
    expect(psy14.header).toBe("PSY14");
    expect(psy14.column).toBe("AM");
    expect(psy14.default).toBe(0);
  });

  it("VALIDATES documents and rejects broken ones with precise issue paths", () => {
    const base = (): ImportConfigDocument => ({
      id: "test-config",
      version: 1,
      formatLabel: "Test format",
      description: "test",
      enabled: true,
      createdAt: "2026-09-26T00:00:00Z",
      updatedAt: "2026-09-26T00:00:00Z",
      sheets: [
        {
          name: "etat",
          sheetMatchers: ["^ETAT"],
          headerRow: 1,
          requiredHeaders: ["NOM"],
          identity: { fields: ["NOM"], strategy: "upsert" },
          fields: [
            { key: "nom", header: "NOM", type: "string", required: true, concept: "name", role: "identity" },
          ],
        },
      ],
    });

    // A well-formed document passes.
    expect(validateImportConfigDocument(base())).toEqual([]);

    // No header AND no column → the field can never be matched.
    const unaddressable = base();
    (unaddressable.sheets[0].fields[0] as { header?: string }).header = undefined;
    expect(validateImportConfigDocument(unaddressable).map((i) => i.path)).toContain("sheets[0].fields[0]");

    // Invalid column letter.
    const badColumn = base();
    (badColumn.sheets[0].fields[0] as { column?: string }).column = "123";
    expect(validateImportConfigDocument(badColumn).map((i) => i.message)).toContain("invalid column letter: 123");

    // Duplicate field keys.
    const dupKey = base();
    (dupKey.sheets[0] as { fields: unknown[] }).fields = [
      ...dupKey.sheets[0].fields,
      { ...dupKey.sheets[0].fields[0] },
    ];
    expect(validateImportConfigDocument(dupKey).map((i) => i.message)).toContain('duplicate field key "nom"');

    // Identity field resolving to nothing.
    const badIdentity = base();
    (badIdentity.sheets[0] as { identity: { fields: string[] } }).identity = { fields: ["GHOST"], strategy: "upsert" };
    expect(validateImportConfigDocument(badIdentity).map((i) => i.message)).toContain('identity field "GHOST" resolves to no mapped field');

    // Invalid regex source.
    const badRegex = base();
    (badRegex.sheets[0] as { sheetMatchers: string[] }).sheetMatchers = ["["];
    expect(validateImportConfigDocument(badRegex).map((i) => i.message)).toContain("invalid regex source: [");

    // Missing concept documentation.
    const noConcept = base();
    delete (noConcept.sheets[0].fields[0] as { concept?: string }).concept;
    expect(validateImportConfigDocument(noConcept).map((i) => i.message)).toContain('field "nom" must document its canonical concept');

    // register() refuses invalid documents (nothing stored).
    const reg = new ImportConfigRegistry();
    const issues = reg.register(unaddressable);
    expect(issues.length).toBeGreaterThan(0);
    expect(reg.get("test-config")).toBeUndefined();
  });

  it("manages documents: version pinning, enable/disable, explicit selection", () => {
    const reg = new ImportConfigRegistry();
    const doc: ImportConfigDocument = {
      id: "managed",
      version: 1,
      formatLabel: "Managed",
      description: "test",
      enabled: true,
      createdAt: "2026-09-26T00:00:00Z",
      updatedAt: "2026-09-26T00:00:00Z",
      sheets: [
        {
          name: "etat",
          sheetMatchers: ["^ETAT"],
          headerRow: 1,
          requiredHeaders: ["NOM"],
          identity: { fields: ["NOM"], strategy: "upsert" },
          fields: [
            { key: "nom", header: "NOM", type: "string", required: true, concept: "name", role: "identity" },
          ],
        },
      ],
    };
    expect(reg.register(doc)).toEqual([]);
    expect(reg.get("managed", 1)).toBeDefined();
    expect(reg.get("managed", 99)).toBeUndefined();

    // Disabled configs resolve to nothing and never detect.
    expect(reg.setEnabled("managed", false)).toBe(true);
    expect(reg.resolve("managed")).toEqual([]);
    expect(reg.detect("ETAT sheet")).toBeNull();
    expect(reg.setEnabled("managed", true)).toBe(true);
    expect(reg.detect("ETAT sheet")!.name).toBe("etat");

    // Explicit selection (the mandate's "or select the appropriate
    // configuration").
    expect(reg.selectConfig("managed").length).toBe(1);
    expect(reg.selectConfig("does-not-exist")).toEqual([]);
  });

  it("EXTENSION POINTS: the EntityMatcher no-op default — profile matching NOT implemented", async () => {
    const matcher = new NoOpEntityMatcher();
    const result = await matcher.match(
      { kind: "parent", id: "src-1", attributes: { phone: "0550" } },
      [{ kind: "parent", id: "existing-1", attributes: { phone: "0550" } }],
    );
    // Even an EXACT attribute overlap reports no match — matching is a
    // future extension point by mandate, never silently active.
    expect(result.matched).toBe(false);
    expect(result.reason).toContain("not implemented");
  });
});
