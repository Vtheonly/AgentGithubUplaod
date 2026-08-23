// ============================================================================
// lib/canon.mjs — Canonical test inputs + deterministic generators.
// ----------------------------------------------------------------------------
// A canonical input is the *normalized user intent* — what both clients must
// converge on after their respective UI/input-layer canonicalization.
// The SAME canonical input is executed through the Desktop client adapter and
// the Mobile client adapter; resulting DB states are normalized and compared.
//
// Determinism: the generator uses a seeded mulberry32 PRNG (same pattern as
// the existing financial-tests/equivalence generator, seed 42) so runs are
// reproducible byte-for-byte.
// ============================================================================

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the canonical family scenario used by the core equivalence run.
 *  `variant` is "D" (desktop scope) or "M" (mobile scope) — the canonical
 *  VALUES (names, amounts, dates) are IDENTICAL for both scopes so field-level
 *  equivalence is meaningful; only entity CODES and PHONES differ so the two
 *  scopes stay isolated in the live DB. */
export function canonicalFamily(variant, { index = 1 } = {}) {
  const rnd = mulberry32(4200 + index);
  const tuitionAnnual = 330000; // 1AM per fee-schedule-2026-2027
  const tranches = [132000, 99000, 99000]; // 40/30/30 split
  return {
    marker: "EQTEST",
    scope: variant,
    parent: {
      parentCode: `PAR-2026-EQTEST-${variant}${String(index).padStart(2, "0")}`,
      firstName: "Famille",
      lastName: `Eqtest${String(index).padStart(2, "0")}`,
      // display_name participates in the RPC's identity fallback chain —
      // scope-suffix it to keep scopes isolated (compared with marker
      // normalization in the CRM layer).
      displayName: `Famille Eqtest ${String(index).padStart(2, "0")} (${variant})`,
      primaryPhone: `0990${variant === "D" ? "10" : "20"}${String(100000 + index).slice(-6)}`,
      email: `eqtest-${String(index).padStart(2, "0")}-${variant.toLowerCase()}@example.invalid`,
    },
    student: {
      studentCode: `ELV-2026-EQTEST-${variant}${String(index).padStart(2, "0")}`,
      firstName: "Eleve",
      lastName: `Eqtest${String(index).padStart(2, "0")}`,
      displayName: `EQTEST${String(index).padStart(2, "0")} ELEVE (${variant})`,
      gradeLevelCode: "1am",
      paymentPlan: "tranches",
      dateOfBirth: "2012-05-1" + (1 + Math.floor(rnd() * 8)),
    },
    charges: [
      {
        category: "tuition",
        amount: tuitionAnnual, // DZD
        description: "Scolarité annuelle (épreuve d'équivalence)",
        tranches,
        dueDates: ["2026-09-15", "2026-12-15", "2027-03-15"],
      },
    ],
    payments: [
      {
        // canonical: cash payment covering tranche 1 exactly
        category: "tuition",
        method: "cash",
        amount: tranches[0],
        description: "Versement tranche 1 (épreuve d'équivalence)",
        collectedAt: "2026-09-20T10:00:00.000Z",
        field: "T1",
      },
      {
        // canonical: partial cash payment toward tranche 2
        category: "tuition",
        method: "cash",
        amount: 40000,
        description: "Versement partiel tranche 2 (épreuve d'équivalence)",
        collectedAt: "2026-12-18T09:30:00.000Z",
        field: "T2",
      },
    ],
    adjustment: {
      category: "tuition",
      amount: -5000, // signed credit (remise)
      reason: "equivalence-test-remise",
      description: "Remise de test d'équivalence",
    },
    edits: {
      studentGradeLevelCode: "2am",
      parentPhoneSuffix: "9",
    },
  };
}

/** Canonical UI-layer raw inputs (identical user keystrokes on both clients). */
export function canonicalUiInputs() {
  return [
    { kind: "name", raw: "  benali   mohamed ", expected: { first: "mohamed", last: "benali", display: "benali mohamed" } },
    { kind: "name", raw: "ZIREG LEA", expected: { first: "LEA", last: "ZIREG", display: "ZIREG LEA" } },
    { kind: "phone", raw: "770264718", expected: "0770264718" },
    { kind: "phone", raw: "0663701834/0660800317", expected: "0663701834" },
    { kind: "phone", raw: "055 00 00 01", expected: "055000001" },
    { kind: "amount", raw: "25 000,50", expected: { dzd: 25000.5, centimes: 2500050 } },
    { kind: "amount", raw: "25000", expected: { dzd: 25000, centimes: 2500000 } },
    { kind: "grade", raw: "1AM", expected: "1am" },
    { kind: "grade", raw: "CE1", expected: "ce1" },
  ];
}

/** Invalid operations — BOTH clients must reject them (validation layer). */
export function invalidOperations(variant) {
  return [
    {
      id: "neg-payment",
      op: "payment.collect",
      input: { amount: -10000, method: "cash", category: "tuition" },
      expect: "rejected",
    },
    {
      id: "zero-payment",
      op: "payment.collect",
      input: { amount: 0, method: "cash", category: "tuition" },
      expect: "rejected-or-noop",
    },
    {
      id: "bad-method",
      op: "payment.collect",
      input: { amount: 5000, method: "crypto", category: "tuition" },
      expect: "rejected",
    },
    {
      id: "bad-category",
      op: "ledger.charge",
      input: { amount: 5000, category: "not-a-category" },
      expect: "rejected",
    },
    {
      id: "bad-grade",
      op: "student.create",
      input: { gradeLevelCode: "99eme" },
      expect: "rejected-or-clamped",
    },
    {
      id: "student-no-name",
      op: "student.create",
      input: { firstName: "", lastName: "" },
      expect: "rejected",
    },
  ];
}
