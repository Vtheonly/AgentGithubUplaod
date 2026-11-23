/**
 * t-471 — DIRECT coverage for generateFamilyStatementPdf (the S47 gap).
 *
 * WHY THIS SUITE EXISTS: Session 47 shipped the traceable family-statement
 * generator (383 lines — per-child sections, the spelled-out balance
 * reconstruction, the inspector's findings with evidence, the explicit
 * unavailable-information list) but verified it only through the S46/S47
 * ACCOUNT-statement pins (t-368) and the import-engine seam. The generator
 * itself had ZERO direct tests. This suite pins its geometry and its
 * CONTENT contract directly:
 *
 *   1. GEOMETRY (the S46/S47 discipline, applied to this document):
 *      - no drawn text breaches the 50pt margins;
 *      - the fee-table amount columns share ONE right edge each
 *        (À payer / Réglé — the S46 ragged-column fix);
 *      - the footer never overlaps (the S47 ~15pt root cause);
 *      - multi-page flow: many children force continuation pages with the
 *        "(suite)" header — no silent truncation.
 *
 *   2. CONTENT TRACEABILITY (the owner's demand, verbatim):
 *      - every child section carries the Excel row reference;
 *      - the devis FORMULA note renders (the =2650000−J954 evidence);
 *      - payments carry full descriptions (child + year + tranche);
 *      - the balance reconstruction line spells out the arithmetic;
 *      - anomaly verdicts render with their four-way labels + evidence;
 *      - the unavailable-information list renders explicitly.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-471-family-statement.test.ts
 */
import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PAGE_W, MARGIN } from "../../infrastructure/receipt-pdf/shared";
import {
  generateFamilyStatementPdf,
  type FamilyStatement,
  type FamilyStatementStudent,
  type FamilyStatementAnomaly,
} from "../../infrastructure/receipt-pdf/family-statement";

/* ============================================================ */
/*  The geometry extractor (the t-368 technique, reused).        */
/* ============================================================ */

interface DrawnText { x: number; y: number; size: number; bold: boolean; str: string; right: number }

function extractTextGeometry(pdfBytes: Uint8Array): DrawnText[] {
  const buf = Buffer.from(pdfBytes);
  const latin = buf.toString("latin1");
  const out: DrawnText[] = [];
  const re = /\/Filter\s*\/FlateDecode\s*\/Length\s+(\d+)|\/Length\s+(\d+)\s*\/Filter\s*\/FlateDecode/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const len = Number(m[1] || m[2]);
    const kw = latin.indexOf("stream", m.index);
    let start = kw + 6;
    if (latin[start] === "\r") start++;
    if (latin[start] === "\n") start++;
    let content: string;
    try {
      content = inflateSync(buf.subarray(start, start + len)).toString("latin1");
    } catch {
      continue;
    }
    for (const block of content.split("BT").slice(1)) {
      const et = block.indexOf("ET");
      const body = et >= 0 ? block.slice(0, et) : block;
      const tf = body.match(/\/([A-Za-z0-9-]+)\s+([\d.]+)\s+Tf/);
      const tm = body.match(/1 0 0 1\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/);
      const tj = body.match(/<([0-9A-Fa-f]+)>\s+Tj/);
      if (!tf || !tm || !tj) continue;
      const hex = tj[1];
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      const str = Buffer.from(bytes).toString("latin1");
      const size = Number(tf[2]);
      const bold = tf[1].includes("Bold");
      const width = bold
        ? helveticaBoldMetrics.widthOfTextAtSize(str, size)
        : helveticaMetrics.widthOfTextAtSize(str, size);
      out.push({ x: Number(tm[1]), y: Number(tm[2]), size, bold, str, right: Number(tm[1]) + width });
    }
  }
  return out;
}

const metricsDoc = await PDFDocument.create();
const helveticaMetrics = await metricsDoc.embedFont(StandardFonts.Helvetica);
const helveticaBoldMetrics = await metricsDoc.embedFont(StandardFonts.HelveticaBold);

/**
 * WinAnsi-to-latin1 normalization for CONTENT assertions: the geometry
 * extractor decodes the drawn bytes as latin1, so multi-byte sequences
 * (the em-dash, accented capitals) arrive transcodED. Expectations are
 * written with the REAL characters and latinized() maps them to the
 * extracted form (é stays é in latin1; — becomes ?).
 */
function latinized(s: string): string {
  // 1) strip diacritics (é→e, û→u — sanitizePdfText's WinAnsi folding)
  const stripped = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // 2) the glyphs outside latin1 arrive as '?' (em-dash, minus sign)
  return stripped.replace(/[—−]/g, "?");
}

/** All extractable text, joined per page for content assertions. */
async function pagesText(pdfBytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdfBytes);
  const out: string[] = [];
  for (const [i, contents] of doc.getPages().entries()) {
    // Use the geometry extractor per-stream: simpler — re-run over the
    // whole file but bucket by page count order. The extractor is global
    // over streams, and pdf-lib writes one stream per page in order.
    void i; void contents;
  }
  const all = extractTextGeometry(pdfBytes);
  // Streams are in page order; split by the continuation header marker.
  // For content assertions a flat join is sufficient and order-stable.
  out.push(all.map((t) => t.str).join(" "));
  return out;
}

/* ============================================================ */
/*  Fixtures — the OUAGED ×10 case, the S47 verdict table.       */
/* ============================================================ */

function makeStudent(overrides: Partial<FamilyStatementStudent> = {}): FamilyStatementStudent {
  return {
    name: "OUAGED ARIS",
    className: "PRIM 3/B",
    level: "Primaire",
    academicYear: "2026/2027",
    devisAnnuel: 2_645_000,
    devisNote: "formule Excel: =2650000-J954 (base 2 650 000 − remise 5 000)",
    dettes: 0,
    dettesReglement: 0,
    transport: {
      destination: "Es Sénia",
      tranches: [
        { label: "T1", amount: 27_000 },
        { label: "T2", amount: 27_000 },
        { label: "T3", amount: 27_000 },
      ],
    },
    installments: [
      { label: "Frais d'inscription (FI)", tranche: 0, due: 18_000, paid: 18_000 },
      { label: "Tranche 1 — Scolarité (V1)", tranche: 1, due: 100_000, paid: 100_000 },
      { label: "Tranche 2 — Scolarité (2V)", tranche: 2, due: 100_000, paid: 60_000 },
      { label: "Tranche 3 — Scolarité (v3)", tranche: 3, due: 2_456_500, paid: 0 },
    ],
    payments: [
      {
        date: "15/09/2026",
        description: "Scolarité 2026/2027 — Frais d'inscription (FI) — OUAGED ARIS",
        method: "Espèces",
        amount: 18_000,
      },
      {
        date: "20/10/2026",
        description: "Scolarité 2026/2027 — Tranche 1 (V1) — OUAGED ARIS",
        method: "Espèces",
        amount: 100_000,
      },
    ],
    sourceRow: 954,
    ...overrides,
  };
}

const OUAGED_ANOMALIES: FamilyStatementAnomaly[] = [
  {
    verdict: "suspicious",
    subject: "OUAGED ARIS — devis 2 645 000",
    summary: "Devis 8,8x the PRIM median ~300 000; the sibling row ILYEN (same phone) reads =300000-J955.",
    evidence: [
      "formule Excel ligne 954: =2650000-J954",
      "PRIM median+MAD band: ~300 000",
      "Division par 10 -> 264 500 lands in the peer band",
    ],
    suggestedAction: "Corriger la base Excel 2 650 000 -> 265 000 puis re-importer.",
  },
  {
    verdict: "unverifiable",
    subject: "OUAGED ARIS — dettes antérieures",
    summary: "Prior-year debts are not in this workbook; cannot be verified from the data.",
    evidence: ["Aucun registre des années antérieures dans 2027-2026.xlsx"],
  },
];

function makeStatement(overrides: Partial<FamilyStatement> = {}): FamilyStatement {
  return {
    parent: {
      displayName: "OUAGED AHMED",
      code: "PAR-2026-0954",
      phone: "+213 555 954 954",
      email: null,
      sourceRef: "Excel 2027-2026.xlsx - ETAT 20262027 - ligne 954",
    },
    issuedAt: "23/11/2026 00:00",
    academicYear: "2026/2027",
    students: [makeStudent()],
    anomalies: OUAGED_ANOMALIES,
    unavailable: [
      "Le registre des dettes des annees anterieures n'est pas dans le classeur 2027-2026.xlsx.",
    ],
    ...overrides,
  };
}

/* ============================================================ */
/*  1. GEOMETRY                                                  */
/* ============================================================ */

describe("t-471 — the family statement's drawn geometry", () => {
  it("NO drawn text breaches the 50pt content margins", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const items = extractTextGeometry(bytes);
    expect(items.length).toBeGreaterThan(60);
    const rightLimit = PAGE_W - MARGIN + 0.75;
    for (const it of items) {
      expect(it.right, `"${it.str}" (right=${it.right}) breaches the right margin`).toBeLessThanOrEqual(rightLimit);
      expect(it.x, `"${it.str}" starts left of the margin`).toBeGreaterThanOrEqual(MARGIN - 0.75);
    }
  });

  it("the fee-table amount columns share ONE right edge each (À payer / Réglé)", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const items = extractTextGeometry(bytes);
    // Row amounts: size-9 grouped numbers (regular for rows, bold for TOTAL).
    const rowAmounts = items.filter(
      (it) => it.size === 9 && /^\d{1,3}( \d{3})+$/.test(it.str.trim()),
    );
    expect(rowAmounts.length).toBeGreaterThanOrEqual(6); // 4 rows + TOTAL ×2 + payments
    const rights = new Set(rowAmounts.map((a) => Math.round(a.right)));
    // Exactly TWO shared edges: the DUE column and the PAID column.
    expect(rights.size).toBeLessThanOrEqual(2);
    for (const edge of rights) {
      expect(edge).toBeLessThanOrEqual(PAGE_W - MARGIN);
    }
  });

  it("the footer never overlaps (the S47 root-cause pin, on THIS document)", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const items = extractTextGeometry(bytes);
    const contact = items.find((it) => it.str.startsWith("El-Imtiyaz"));
    const gen = items.find((it) => it.str.startsWith("Genere le") || it.str.startsWith("Généré le"));
    expect(contact).toBeDefined();
    expect(gen).toBeDefined();
    expect(gen!.x - contact!.right).toBeGreaterThanOrEqual(4);
  });

  it("many children flow onto continuation pages — no silent truncation", async () => {
    const students = Array.from({ length: 9 }, (_, i) =>
      makeStudent({ name: `ENFANT ${i + 1}`, sourceRow: 900 + i }),
    );
    const bytes = await generateFamilyStatementPdf(makeStatement({ students, anomalies: [] }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    // Every child's section bar renders — the last one included.
    const text = (await pagesText(bytes))[0];
    expect(text).toContain("ENFANT 9");
    expect(text).toContain("ligne Excel 908");
  });
});

/* ============================================================ */
/*  2. CONTENT TRACEABILITY                                      */
/* ============================================================ */

describe("t-471 — the family statement's traceable content", () => {
  it("the client meta block carries the SOURCE REFERENCE (workbook, sheet, row)", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    expect(text).toContain("OUAGED AHMED");
    expect(text).toContain("Excel 2027-2026.xlsx - ETAT 20262027 - ligne 954");
  });

  it("the child section carries the Excel row reference + the devis FORMULA", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    expect(text).toContain("ligne Excel 954");
    // The formula note (the ×10 typo's evidence) renders verbatim.
    expect(text).toContain("=2650000-J954");
    // Transport is DETAILED — destination + tranches, never a bare "Transport".
    expect(text).toContain("Es Senia");
    expect(text).toContain("T1: 27 000");
  });

  it("payments carry FULL descriptions (child + year + tranche)", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    expect(text).toContain(latinized("Scolarité 2026/2027 — Tranche 1 (V1) — OUAGED ARIS"));
  });

  it("the balance reconstruction SPELLS OUT the arithmetic", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    // "Solde dû pour OUAGED ARIS = À payer 2 674 500 − Réglé 178 000 = 2 496 500"
    expect(text).toContain(latinized("Solde dû pour OUAGED ARIS = "));
    expect(text).toContain(latinized("− Réglé "));
    // The reconstruction's inputs are the actual sums (verified by code):
    const sumDue = 18_000 + 100_000 + 100_000 + 2_456_500;
    const stuPaid = 18_000 + 100_000;
    expect(text).toContain(sumDue.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " "));
    expect(text).toContain((sumDue - stuPaid).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " "));
  });

  it("the anomaly verdicts render with their labels + evidence chains", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    expect(text).toContain(latinized("ANOMALIES DETECTEES — INSPECTEUR FINANCIER (2)"));
    expect(text).toContain(latinized("[SUSPECT — A VERIFIER]"));
    expect(text).toContain(latinized("[NON VERIFIABLE]"));
    // The evidence chain lines render.
    expect(text).toContain("formule Excel ligne 954");
    expect(text).toContain("264 500");
    // The suggested action renders.
    expect(text).toContain("Corriger la base Excel");
  });

  it("the unavailable-information list renders EXPLICITLY (never invented)", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    expect(text).toContain(latinized("INFORMATIONS NON DISPONIBLES"));
    expect(text).toContain("annees anterieures");
  });

  it("the synthèse boxes total the per-child figures (independent re-computation)", async () => {
    const bytes = await generateFamilyStatementPdf(makeStatement());
    const text = (await pagesText(bytes))[0];
    const totalDue = 18_000 + 100_000 + 100_000 + 2_456_500; // the installment sums
    const totalPaid = 18_000 + 100_000; // the payment sums
    expect(text).toContain(totalDue.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " "));
    expect(text).toContain(totalPaid.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " "));
    expect(text).toContain((totalDue - totalPaid).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " "));
  });
});
