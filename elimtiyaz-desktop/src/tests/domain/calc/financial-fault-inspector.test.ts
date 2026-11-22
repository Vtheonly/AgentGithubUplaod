/**
 * S47 — the financial fault inspector's contextual rules, pinned against
 * the REAL defect classes found in the school's workbooks during the
 * owner-requested forensic investigation (Session 47). Each fixture below
 * reproduces a real row's numbers; the assertions pin the VERDICT and the
 * EVIDENCE that a reviewer needs to re-derive it.
 */
import { describe, it, expect } from "vitest";
import {
  inspectFinancialRecords,
  sortFaultsForReport,
  type FinancialRecordContext,
} from "../../../domain/calc/finance/financial-fault-inspector";

/** A normal PRIM row (the peer population). */
function primPeer(over: Partial<FinancialRecordContext> = {}): FinancialRecordContext {
  return {
    studentName: "PEER ELEVE",
    level: "PRIM",
    className: "CE1",
    devisAnnuel: 260_000,
    remise: 5_000,
    dettes: 0,
    reglementsDettes: 0,
    totalVersements: 120_000,
    totalCreance: 140_000,
    tuitionComponents: { fi: 25_000, v1: 60_000, v2Alt: null, v3: 35_000 },
    transportComponents: { t1: null, t2: null, t3: null },
    transportDestination: null,
    hasTransportOption: false,
    ...over,
  };
}

/** ~20 normal PRIM peers so the peer statistics are real, not thin. */
function primPeers(n = 18): FinancialRecordContext[] {
  return Array.from({ length: n }, (_, i) => {
    const paid = 100_000 + (i % 5) * 20_000;
    const devis = 245_000 + (i % 6) * 15_000;
    return primPeer({
      studentName: `PEER ${i}`,
      devisAnnuel: devis,
      totalVersements: paid,
      totalCreance: devis - paid,
      // Components consistent with the paid total (fi 25 000 + v1 60 000 +
      // v3 = the remainder) — the invariant rule must stay silent on peers.
      tuitionComponents: {
        fi: 25_000,
        v1: 60_000,
        v2Alt: null,
        v3: paid - 25_000 - 60_000,
      },
    });
  });
}

describe("S47 financial fault inspector — the real defect classes", () => {
  it("devis_outlier: a ×10 extra-digit typo is flagged SUSPICIOUS with the /10 evidence (OUAGED ARIS, real row 954)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "OUAGED ARIS",
        excelRow: 954,
        devisAnnuel: 2_645_000,
        remise: 5_000,
        totalVersements: 35_000,
        totalCreance: 2_610_000,
        tuitionComponents: { fi: null, v1: 35_000, v2Alt: null, v3: null },
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const outlier = faults.filter((f) => f.rule === "devis_outlier");
    expect(outlier).toHaveLength(1);
    expect(outlier[0].verdict).toBe("suspicious");
    expect(outlier[0].subject).toContain("ligne 954");
    // The /10 evidence — the reviewer's smoking gun.
    expect(
      outlier[0].evidence.some((e) => e.includes("264 500") || e.includes("×")),
    ).toBe(true);
    expect(outlier[0].evidence.some((e) => e.includes("médiane"))).toBe(true);
  });

  it("devis_outlier: an in-band devis is NOT flagged (the 18 peers produce no false positives)", () => {
    const faults = inspectFinancialRecords(primPeers());
    expect(faults.filter((f) => f.rule === "devis_outlier")).toHaveLength(0);
  });

  it("devis_outlier: 2-3× the median is LEGITIMATE_LARGE (flagged for explicit review, not accused)", () => {
    const records = [
      ...primPeers(),
      primPeer({ studentName: "GRAND DEVIS", devisAnnuel: 610_000, totalCreance: 490_000 }),
    ];
    const outlier = inspectFinancialRecords(records).filter((f) => f.rule === "devis_outlier");
    expect(outlier).toHaveLength(1);
    expect(outlier[0].verdict).toBe("legitimate_large");
  });

  it("devis_component_outlier: a 400 000 complement vs the 40-55 000 norm is SUSPICIOUS (BENADOUDA IYAD, real row 647)", () => {
    const records = [
      ...primPeers().map((p) => ({ ...p, devisFormula: "=300000+40000-J1" })),
      primPeer({
        studentName: "BENADOUDA IYAD",
        excelRow: 647,
        devisAnnuel: 700_000,
        remise: 0,
        devisFormula: "=300000+400000-J647",
        totalVersements: 70_000,
        totalCreance: 630_000,
        tuitionComponents: { fi: null, v1: 70_000, v2Alt: null, v3: null },
        transportDestination: "BOUMERDES",
        hasTransportOption: true,
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const comp = faults.filter((f) => f.rule === "devis_component_outlier");
    expect(comp).toHaveLength(1);
    expect(comp[0].verdict).toBe("suspicious");
    expect(comp[0].subject).toContain("BENADOUDA");
    expect(comp[0].evidence[0]).toContain("=300000+400000-J647");
  });

  it("dettes_exceeds_devis: prior debts above the annual devis are UNVERIFIABLE with the prior-year note (TASLGHOUA NAILA, real row 814)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "TASLGHOUA NAILA",
        excelRow: 814,
        devisAnnuel: 300_000,
        dettes: 394_000,
        reglementsDettes: 0,
        totalVersements: 0,
        totalCreance: 300_000,
        tuitionComponents: null,
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const d = faults.filter((f) => f.rule === "dettes_exceeds_devis");
    expect(d).toHaveLength(1);
    expect(d[0].verdict).toBe("unverifiable");
    expect(d[0].evidence.some((e) => e.includes("antérieures"))).toBe(true);
  });

  it("creance_invariant: créance ≠ devis − versements is a CONFIRMED ERROR (BERDAI MAROUAN, real row 840)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "BERDAI MAROUAN",
        excelRow: 840,
        devisAnnuel: 318_000,
        totalVersements: 127_000,
        totalCreance: 99_000, // expected 191 000 — the real −92 000 gap
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const c = faults.filter((f) => f.rule === "creance_invariant");
    expect(c).toHaveLength(1);
    expect(c[0].verdict).toBe("confirmed_error");
    expect(c[0].summary).toContain("191 000");
  });

  it("versements_invariant: Σ tranches ≠ TOTAL VERSEMENTS is a CONFIRMED ERROR", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "SOMME FAUSSE",
        excelRow: 10,
        totalVersements: 120_000,
        tuitionComponents: { fi: 25_000, v1: 60_000, v2Alt: null, v3: 10_000 }, // Σ=95 000 ≠ 120 000
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const v = faults.filter((f) => f.rule === "versements_invariant");
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe("confirmed_error");
  });

  it("duplicate_identity_conflict: twin rows with contradicting versements are UNVERIFIABLE with BOTH values listed (KHALEF RAYAN, real rows 1065/1090)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "KHALEF RAYAN",
        excelRow: 1065,
        className: "3EM",
        level: "LYC",
        phone: "555160243",
        devisAnnuel: 395_000,
        totalVersements: 80_000,
        totalCreance: 315_000,
        tuitionComponents: { fi: null, v1: 80_000, v2Alt: null, v3: null },
      }),
      primPeer({
        studentName: "KHALEF RAYAN",
        excelRow: 1090,
        className: "3EM",
        level: "LYC",
        phone: "555160243",
        devisAnnuel: 395_000,
        totalVersements: 158_000,
        totalCreance: 237_000,
        tuitionComponents: { fi: null, v1: 158_000, v2Alt: null, v3: null },
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const dup = faults.filter((f) => f.rule === "duplicate_identity_conflict");
    expect(dup).toHaveLength(1);
    expect(dup[0].verdict).toBe("unverifiable");
    expect(dup[0].subject).toContain("1065");
    expect(dup[0].subject).toContain("1090");
    expect(dup[0].evidence.some((e) => e.includes("80 000") && e.includes("158 000"))).toBe(true);
  });


  it("duplicate_identity: a NULL phone on one row is NOT corroboration when the classes differ (the live BIDA MED false-positive class, fixed S47)", () => {
    const records = [
      ...primPeers(),
      primPeer({ studentName: "BIDA MED", excelRow: 50, className: "1AP", phone: null, devisAnnuel: 184_500 }),
      primPeer({ studentName: "BIDA MED", excelRow: 786, className: "2AAM", phone: "555844769", devisAnnuel: 340_000 }),
    ];
    const faults = inspectFinancialRecords(records);
    expect(faults.filter((f) => f.rule === "duplicate_identity_conflict")).toHaveLength(0);
  });

  it("duplicate_identity: both phones missing + SAME class + contradicting paid IS a conflict (the live HEROUA MOSADEK rows 770/771)", () => {
    const records = [
      ...primPeers(),
      primPeer({ studentName: "HEROUA MOSADEK", excelRow: 770, className: "CE1", phone: null, devisAnnuel: 265_000, totalVersements: 33_000, totalCreance: 232_000 }),
      primPeer({ studentName: "HEROUA MOSADEK", excelRow: 771, className: "CE1", phone: null, devisAnnuel: 265_000, totalVersements: 30_000, totalCreance: 235_000 }),
    ];
    const faults = inspectFinancialRecords(records);
    const dup = faults.filter((f) => f.rule === "duplicate_identity_conflict");
    expect(dup).toHaveLength(1);
    expect(dup[0].verdict).toBe("unverifiable");
    expect(dup[0].evidence.some((e) => e.includes("33 000") && e.includes("30 000"))).toBe(true);
  });

  it("duplicate_identity: identical twins are NOT a conflict (the merge is safe)", () => {
    const records = [
      ...primPeers(),
      primPeer({ studentName: "VRAI DOUBLON", excelRow: 1 }),
      primPeer({ studentName: "VRAI DOUBLON", excelRow: 2 }),
    ];
    const faults = inspectFinancialRecords(records);
    expect(faults.filter((f) => f.rule === "duplicate_identity_conflict")).toHaveLength(0);
  });

  it("duplicate_identity: same name but DIFFERENT phones/classes are separate students (BIDA MED rows 50/786 — no false merge accusation)", () => {
    const records = [
      ...primPeers(),
      primPeer({ studentName: "BIDA MED", excelRow: 50, className: "1AP", phone: "674675003", devisAnnuel: 184_500 }),
      primPeer({ studentName: "BIDA MED", excelRow: 786, className: "2AAM", phone: "555844769", devisAnnuel: 340_000 }),
    ];
    const faults = inspectFinancialRecords(records);
    expect(faults.filter((f) => f.rule === "duplicate_identity_conflict")).toHaveLength(0);
  });

  it("embedded_aggregate: a cross-row family sum inside a data column is a CONFIRMED ERROR (HABRI LINA, real row 505)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "HABRI LINA",
        excelRow: 505,
        devisFormula: "=145000+137000+157000+175000+177000",
        crossRowFormula: true,
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const e = faults.filter((f) => f.rule === "embedded_aggregate");
    expect(e).toHaveLength(1);
    expect(e[0].verdict).toBe("confirmed_error");
    expect(e[0].summary).toContain("multi-lignes");
  });

  it("transport_context: OPTION TRNSP with no transport detail is SUSPICIOUS (insufficient supporting info)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "SANS DETAIL TRANSPORT",
        excelRow: 99,
        devisAnnuel: 0,
        totalCreance: 0,
        hasTransportOption: true,
        transportDestination: "BOUMERDES",
        transportComponents: { t1: null, t2: null, t3: null },
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const t = faults.filter((f) => f.rule === "transport_context");
    expect(t).toHaveLength(1);
    expect(t[0].verdict).toBe("suspicious");
  });


  it("transport_context: TRNSP with a devis is NOT flagged (transport folded into the devis — 124 such rows in the real workbook must not be noise)", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "TRANSPORT DANS DEVIS",
        excelRow: 97,
        devisAnnuel: 340_000,
        totalCreance: 220_000,
        hasTransportOption: true,
        transportDestination: "BOUMERDES",
        transportComponents: { t1: null, t2: null, t3: null },
      }),
    ];
    const faults = inspectFinancialRecords(records);
    expect(faults.filter((f) => f.rule === "transport_context")).toHaveLength(0);
  });

  it("transport_context: transport tranches WITHOUT a destination are flagged", () => {
    const records = [
      ...primPeers(),
      primPeer({
        studentName: "SANS DESTINATION",
        excelRow: 98,
        transportDestination: null,
        transportComponents: { t1: 20_000, t2: 10_000, t3: 10_000 },
      }),
    ];
    const faults = inspectFinancialRecords(records);
    const t = faults.filter((f) => f.rule === "transport_context");
    expect(t).toHaveLength(1);
    expect(t[0].summary).toContain("sans destination");
  });

  it("four-way verdicts are distinguished: confirmed_error < suspicious < unverifiable < legitimate_large ordering (worst first)", () => {
    const records = [
      ...primPeers(),
      primPeer({ studentName: "BERDAI MAROUAN", excelRow: 840, devisAnnuel: 318_000, totalVersements: 127_000, totalCreance: 99_000 }),
      primPeer({ studentName: "OUAGED ARIS", excelRow: 954, devisAnnuel: 2_645_000, totalVersements: 35_000, totalCreance: 2_610_000 }),
      primPeer({ studentName: "MOYEN GRAND", devisAnnuel: 610_000, totalCreance: 490_000 }),
    ];
    const sorted = sortFaultsForReport(inspectFinancialRecords(records));
    const verdicts = sorted.map((f) => f.verdict);
    const firstConfirmed = verdicts.indexOf("confirmed_error");
    const firstLegit = verdicts.indexOf("legitimate_large");
    expect(firstConfirmed).toBeGreaterThanOrEqual(0);
    expect(firstLegit).toBeGreaterThan(firstConfirmed);
  });

  it("thin level groups fall back to the global peer band (no verdict from a 2-row 'level')", () => {
    const records: FinancialRecordContext[] = [
      { studentName: "A", level: "PRES", devisAnnuel: 280_000 },
      { studentName: "B", level: "PRES", devisAnnuel: 2_800_000 },
      ...primPeers(20).map((p) => ({ ...p, level: "PRIM" })),
    ];
    const faults = inspectFinancialRecords(records);
    const outlier = faults.filter((f) => f.rule === "devis_outlier" && f.subject.startsWith("B"));
    // The PRES group is too thin (2 < 8) — the fallback is the global set,
    // where 2 800 000 is still a ×10 outlier → flagged, with the scope
    // honestly reported as "tous niveaux".
    expect(outlier).toHaveLength(1);
    expect(outlier[0].evidence[0]).toContain("tous niveaux");
  });
});
