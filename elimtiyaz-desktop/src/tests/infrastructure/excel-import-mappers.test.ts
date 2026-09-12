/**
 * CALC-001 follow-up — Excel import mapper verification.
 *
 * Locks in the two import-path fixes that the full-CSV replay surfaced:
 *   1. `mapExcelDestinationToCanonical` resolves EVERY spelling observed in
 *      the workbook (ETAT DISTINATION column + REF reference sheet, typos
 *      included) to the REAL per-town transport key — not the legacy
 *      4-zone collapse (ZEMMOURI 52k→57k, BENI AMRANE 55k→65k).
 *   2. `resolveGradeFromClasse` resolves the EXACT grade from the CLASSE
 *      column (CE1→2ap), so imported students are priced per grade instead
 *      of at the broad-level year-1 rate (PRIM→1ap).
 *   3. `isAutisteTrack` routes AUTISTE rows to the dedicated schedule.
 */
import { describe, it, expect } from "vitest";
import { mapExcelDestinationToCanonical } from "../../infrastructure/excel/import-engine/mappers/destination-mapper";
import {
  resolveGradeFromClasse,
  isAutisteTrack,
  mapNiveauCode,
} from "../../infrastructure/excel/import-engine/mappers/niveau-mapper";
import { REAL_TRANSPORT_MATRIX, REAL_TUITION_BY_GRADE, REAL_FI_BY_GRADE } from "../../domain/calc/pricing/school-price-matrix";

describe("destination mapper — every workbook spelling resolves to its real town", () => {
  it("maps the exact-price towns (57k / 65k tiers the old 4-zone map got wrong)", () => {
    // ZEMMOURI is 57 000 — the old mapping collapsed it into the
    // boudouaou_thenia_zemmouri 52 000 zone (5 000 DZD under-charged).
    expect(mapExcelDestinationToCanonical("ZEMMOURI")).toBe("zemmouri");
    expect(REAL_TRANSPORT_MATRIX.zemmouri[0]).toBe(57_000);
    // The REF-sheet typo spelling (one M) resolves to the same town.
    expect(mapExcelDestinationToCanonical(" ZEMOURI ")).toBe("zemmouri");
    // BENI AMRANE / REGHAIA / ROUIBA / OULED HEDDAJ / LAGATA are 65 000 —
    // the old mapping dumped them into `autres` (55 000, 10 000 under).
    expect(mapExcelDestinationToCanonical("BENIAMRAN")).toBe("beni_amrane");
    expect(REAL_TRANSPORT_MATRIX.beni_amrane[0]).toBe(65_000);
    expect(mapExcelDestinationToCanonical("REGHIAA")).toBe("reghaia"); // REF typo
    expect(mapExcelDestinationToCanonical("REGHAIA")).toBe("reghaia");
    expect(mapExcelDestinationToCanonical("ROUIBA")).toBe("rouiba");
    expect(mapExcelDestinationToCanonical("OULED HEDDAJ /HOUCHE MEKHEFI")).toBe("ouled_heddadj");
    expect(mapExcelDestinationToCanonical("KHEMIS KHENCHELA")).toBe("khemis_el_khechna"); // REF typo
    expect(REAL_TRANSPORT_MATRIX.reghaia[0]).toBe(65_000);
  });

  it("maps the 40k / 43k / 52k / 55k tiers exactly", () => {
    expect(mapExcelDestinationToCanonical("BOUMERDES")).toBe("boumerdes");
    expect(mapExcelDestinationToCanonical("BOUMRDES")).toBe("boumerdes");
    expect(mapExcelDestinationToCanonical("CHABAT")).toBe("chabat");
    expect(mapExcelDestinationToCanonical("CORSO")).toBe("corso");
    expect(mapExcelDestinationToCanonical("SAHEL")).toBe("sahel");
    expect(mapExcelDestinationToCanonical("FIGUIER")).toBe("figuier");
    expect(mapExcelDestinationToCanonical("TIDJELABINE")).toBe("tidjelabine");
    expect(mapExcelDestinationToCanonical("BOUDOUAOU")).toBe("boudouaou");
    expect(mapExcelDestinationToCanonical("THENIA")).toBe("thenia");
    expect(mapExcelDestinationToCanonical("DJENAT")).toBe("djenet");
    expect(mapExcelDestinationToCanonical("BORDJ MNAIL")).toBe("bordj_menaiel");
    expect(mapExcelDestinationToCanonical("SI MUSTAPHA")).toBe("si_mustapha");
    expect(mapExcelDestinationToCanonical("ISSER")).toBe("isser");
    expect(mapExcelDestinationToCanonical("OULED MOUSSA")).toBe("ouled_moussa");
    expect(mapExcelDestinationToCanonical("BENYOUNES")).toBe("benyounes");
    expect(mapExcelDestinationToCanonical("SOUK ELHAD")).toBe("souk_elhad");
    expect(mapExcelDestinationToCanonical("CAP DJENET")).toBe("cap_djenet");
    expect(REAL_TRANSPORT_MATRIX.boumerdes[0]).toBe(40_000);
    expect(REAL_TRANSPORT_MATRIX.corso[0]).toBe(43_000);
    expect(REAL_TRANSPORT_MATRIX.boudouaou[0]).toBe(52_000);
    expect(REAL_TRANSPORT_MATRIX.djenet[0]).toBe(55_000);
  });

  it("falls back to the legacy `autres` zone for unknown/blank values", () => {
    expect(mapExcelDestinationToCanonical(null)).toBe("autres");
    expect(mapExcelDestinationToCanonical("")).toBe("autres");
    expect(mapExcelDestinationToCanonical("MARS")).toBe("autres");
    expect(REAL_TRANSPORT_MATRIX.autres[0]).toBe(55_000);
  });

  it("every REF-sheet town resolves to a priced destination (20/20)", () => {
    const refTowns = [
      "BOUMERDES", "CORSO", "SAHEL", "FIGUIER", "ZEMOURI ", "BOUDOUAOU", "REGHIAA",
      "ROUIBA", "BORDJ MNAIL", "SI MUSTAPHA", "ISSER", "THENIA", "BENI AMRANE",
      "OULED MOUSSA", "OULED HEDDAJ /HOUCHE MEKHEFI", "KHEMIS KHENCHELA",
      "TIDJELABINE", "BENYOUNES", "SOUK ELHAD", "CAP DJENET",
    ];
    for (const town of refTowns) {
      const key = mapExcelDestinationToCanonical(town);
      expect(REAL_TRANSPORT_MATRIX[key as keyof typeof REAL_TRANSPORT_MATRIX],
        `REF town '${town}' must resolve to a priced destination`).toBeDefined();
    }
  });
});

describe("classe resolution — the EXACT grade, not the broad level", () => {
  it("resolves every observed CLASSE code to its exact gradeLevel", () => {
    expect(resolveGradeFromClasse("CE1", "PRIM").gradeLevel).toBe("2ap");
    expect(resolveGradeFromClasse("CM2", "PRIM").gradeLevel).toBe("5ap");
    expect(resolveGradeFromClasse("3AAM", "COLG").gradeLevel).toBe("3am");
    expect(resolveGradeFromClasse("4AAM", "COLG").gradeLevel).toBe("4am");
    expect(resolveGradeFromClasse("3EM", "LYC").gradeLevel).toBe("3eme_annee");
    expect(resolveGradeFromClasse("GS", "PRIM").gradeLevel).toBe("prescolaire_2");
    expect(resolveGradeFromClasse("MS", "PRIM").gradeLevel).toBe("prescolaire_1");
    expect(resolveGradeFromClasse("1ER", "LYC").gradeLevel).toBe("1ere_annee");
    expect(resolveGradeFromClasse("2EM", "LYC").gradeLevel).toBe("2eme_annee");
    // REF-sheet variants resolve too.
    expect(resolveGradeFromClasse("1AS", "LYC").gradeLevel).toBe("1ere_annee");
    expect(resolveGradeFromClasse("3CS", "LYC").gradeLevel).toBe("3eme_annee");
    expect(resolveGradeFromClasse("PS", "PRIM").gradeLevel).toBe("prescolaire_1");
    expect(resolveGradeFromClasse("TPS", "PRIM").gradeLevel).toBe("prescolaire_1");
  });

  it("the exact grade selects the REAL per-grade schedule (ZIREG LEA CE1 case)", () => {
    // A CE1 (2ap) row must NOT be priced with the 1ap (CP) schedule:
    // the pre-fix importer mapped PRIM→1ap → FI 25000 but tranches
    // 89000/65500/65500 — wrong for CE1 (97000/71500/71500).
    const ce1 = resolveGradeFromClasse("CE1", "PRIM");
    expect(REAL_FI_BY_GRADE[ce1.gradeLevel]).toBe(25_000);
    expect(REAL_TUITION_BY_GRADE[ce1.gradeLevel].v2).toBe(97_000);
    expect(REAL_TUITION_BY_GRADE[ce1.gradeLevel].tranche3).toBe(71_500);
    expect(REAL_TUITION_BY_GRADE[ce1.gradeLevel].tranche4).toBe(71_500);
    // The broad-level fallback is unchanged for unknown class codes.
    expect(resolveGradeFromClasse("NV4", "NV4").gradeLevel).toBe(mapNiveauCode("NV4").gradeLevel);
    expect(resolveGradeFromClasse("Non assignée", "COLG").gradeLevel).toBe("1am");
  });

  it("AUTISTE track detection via classe or option", () => {
    expect(isAutisteTrack("AUTISTE", null)).toBe(true);
    expect(isAutisteTrack(null, "AUTISTE")).toBe(true);
    expect(isAutisteTrack("CE1", "TRNSP")).toBe(false);
    expect(isAutisteTrack(null, null)).toBe(false);
  });
});
