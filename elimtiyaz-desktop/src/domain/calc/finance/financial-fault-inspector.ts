/**
 * Financial fault inspector — S47 (the owner-requested contextual financial
 * anomaly detection).
 *
 * CANONICAL module (the anomaly-signals.ts pattern: a needed derivation is
 * REGISTERED in the domain, not embedded beside a UI or an importer).
 * Pure and total; no IO.
 *
 * WHY: the owner challenged a 1 350 000 DZD amount on a client statement.
 * The forensic answer (Session 47) was that the amount itself was a demo
 * harness synthetic — but the INVESTIGATION found five REAL defect classes
 * in the school's Excel data that a plain per-field validator can never
 * see, because none of them is a per-field error. Each rule below encodes
 * one of those classes, verified against the real workbooks:
 *
 *   devis_outlier           OUAGED ARIS: devis 2 645 000 at CE1 (PRIM
 *                           median ≈ 300 000) — a ×10 extra-digit typo in
 *                           the Excel base constant (=2650000−J954 vs the
 *                           sibling's =300000−J955).
 *   devis_component_outlier BENADOUDA IYAD: =300000+400000 — a 400 000
 *                           "transport" addend ~8× the real addend norm.
 *   dettes_exceeds_devis    TASLGHOUA NAILA: prior-year dettes 394 000 on
 *                           a 300 000 annual devis.
 *   creance_invariant       BERDAI MAROUAN: creance 99 000 ≠ devis−paid
 *                           191 000 (−92 000 with no explanation).
 *   versements_invariant    Σ(FI+V1+2V+v3+1T+T2+t3) ≠ TOTAL VERSEMENTS
 *                           (0 hits in the real 1 139-row workbook — the
 *                           rule stays as a cheap invariant).
 *   duplicate_identity_conflict  HEROUA MOSADEK rows 770/771 (paid 33 000
 *                           vs 30 000) and KHALEF RAYAN rows 1065/1090
 *                           (paid 80 000 vs 158 000, same phone) — twin
 *                           rows with CONTRADICTING financials; the import
 *                           merges them first-wins and the difference
 *                           needs the school's paper receipts.
 *   embedded_aggregate      HABRI LINA: a cross-row family sum
 *                           (=145000+137000+157000+175000+177000 = 791 000)
 *                           typed INSIDE a data column — a scratch cell a
 *                           naive import reads as the student's creance.
 *   transport_context       OPTION=TRNSP / destination without transport
 *                           detail (or transport tranches without a
 *                           destination) — insufficient supporting info.
 *
 * DESIGN (the owner's explicit constraints):
 *   - NO single hardcoded threshold is the only mechanism. Outlier rules
 *     derive their bands from the PEER DISTRIBUTION of the record set
 *     itself (per academic level, median + MAD, with a global fallback for
 *     thin groups). The fixed constants that remain (×3/×10 multipliers,
 *     minimum group sizes) are multipliers on derived statistics,
 *     documented here.
 *   - Four-way verdict — "confirmed_error" (provable from the data alone),
 *     "suspicious" (strong contextual evidence, human decides),
 *     "legitimate_large" (unusually large but consistent — flagged so the
 *     reviewer can PASS it explicitly), "unverifiable" (the data cannot
 *     decide; lists what is needed).
 *   - Every fault carries its EVIDENCE CHAIN — the numbers that produced
 *     the flag — so a reviewer can re-derive the verdict without the code.
 *
 * A fault is a FINDING, never an auto-correction: the caller decides.
 * Formulas (devisFormula / crossRowFormula) are OPTIONAL — the in-app
 * import reads cached values only; the Excel-side harness (openpyxl)
 * supplies them for the deeper evidence rules.
 */

/* ------------------------------------------------------------------ */
/*  Input model                                                        */
/* ------------------------------------------------------------------ */

/** The per-tranche transport components (1T / T2 / t3). */
export interface TransportComponents {
  readonly t1?: number | null;
  readonly t2?: number | null;
  readonly t3?: number | null;
}

/** The per-tranche tuition components (FI / V1 / 2V / v3). */
export interface TuitionComponents {
  readonly fi?: number | null;
  readonly v1?: number | null;
  readonly v2Alt?: number | null;
  readonly v3?: number | null;
}

/**
 * One ETAT financial record, normalised from either the import engine's
 * validated records (in-app) or the openpyxl ground-truth scan (harness).
 */
export interface FinancialRecordContext {
  /** The Excel row number, when known — carried into every subject label. */
  readonly excelRow?: number;
  readonly studentName: string;
  readonly phone?: string | null;
  readonly level?: string | null;
  readonly className?: string | null;
  readonly remise?: number | null;
  readonly devisAnnuel?: number | null;
  /** The raw Excel devis FORMULA, when available (harness/forensics only). */
  readonly devisFormula?: string | null;
  /** True when the formula references OTHER ROWS (the HABRI class). */
  readonly crossRowFormula?: boolean;
  readonly dettes?: number | null;
  readonly reglementsDettes?: number | null;
  readonly totalVersements?: number | null;
  readonly totalCreance?: number | null;
  readonly tuitionComponents?: TuitionComponents | null;
  readonly transportDestination?: string | null;
  readonly transportComponents?: TransportComponents | null;
  readonly hasTransportOption?: boolean;
}

export type FaultVerdict =
  | "confirmed_error"
  | "suspicious"
  | "legitimate_large"
  | "unverifiable";

export type FaultRule =
  | "devis_outlier"
  | "devis_component_outlier"
  | "dettes_exceeds_devis"
  | "creance_invariant"
  | "versements_invariant"
  | "duplicate_identity_conflict"
  | "embedded_aggregate"
  | "transport_context";

export interface FinancialFault {
  readonly rule: FaultRule;
  readonly verdict: FaultVerdict;
  /** "OUAGED ARIS (ligne 954)" */
  readonly subject: string;
  readonly summary: string;
  /** The numbers that produced the flag — the reviewer's re-derivation. */
  readonly evidence: readonly string[];
  readonly suggestedAction: string;
}

/* ------------------------------------------------------------------ */
/*  Peer statistics (contextual bands — never a single hardcoded gate)  */
/* ------------------------------------------------------------------ */

const MIN_LEVEL_GROUP = 8;
/** Median absolute deviation → σ-equivalent (1.4826 for Gaussian). */
const MAD_TO_SIGMA = 1.4826;
/** A devis above this multiple of its level median is an outlier. */
const DEVIS_OUTLIER_FACTOR = 3;
/** A devis between these multiples is unusually large but plausible. */
const DEVIS_LEGIT_LARGE_FACTOR = 2;
/** The extra-digit (×10) typo test band, in peer quantiles. */
const TYPO_DIVISOR = 10;
/** Non-base devis addends above this multiple of the peer addend norm. */
const ADDEND_OUTLIER_FACTOR = 4;
/** Invariant tolerance: 1 DZD, or 1% of devis, whichever is larger. */
const INVARIANT_TOL_PCT = 0.01;

interface Stats {
  readonly n: number;
  readonly median: number;
  readonly mad: number;
  readonly p10: number;
  readonly p90: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statsOf(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const med = quantile(sorted, 0.5);
  const mad = quantile(sorted.map((v) => Math.abs(v - med)), 0.5);
  return {
    n: sorted.length,
    median: med,
    mad,
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
  };
}

/** The peer band for a level, falling back to the global set when thin. */
function peerStatsFor(
  records: readonly FinancialRecordContext[],
  level: string | null | undefined,
): { stats: Stats; scope: string } {
  const byLevel = records.filter(
    (r) => r.level && level && r.level.toUpperCase() === level.toUpperCase(),
  );
  const levelValues = byLevel
    .map((r) => r.devisAnnuel)
    .filter((v): v is number => typeof v === "number" && v > 0);
  if (levelValues.length >= MIN_LEVEL_GROUP) {
    return { stats: statsOf(levelValues), scope: `niveau ${level}` };
  }
  const all = records
    .map((r) => r.devisAnnuel)
    .filter((v): v is number => typeof v === "number" && v > 0);
  return { stats: statsOf(all), scope: "tous niveaux" };
}

// fr-FR grouping WITHOUT the U+202F narrow no-break space (the WinAnsi
// hazard dzdPdf exists for — these strings reach PDFs and terminals).
const fmt = (n: number) =>
  n
    .toLocaleString("fr-FR", { maximumFractionDigits: 0 })
    .replace(/[\u202f\u00a0\u2009]/g, " ");

/* ------------------------------------------------------------------ */
/*  Rules                                                              */
/* ------------------------------------------------------------------ */

function subjectOf(r: FinancialRecordContext): string {
  return r.excelRow !== undefined
    ? `${r.studentName} (ligne ${r.excelRow})`
    : r.studentName;
}

/**
 * 1. devis_outlier — the OUAGED class. Peer-relative by construction:
 * the band is the level's own median; the ×10 test turns a raw outlier
 * into a strong typo hypothesis when dividing by 10 lands inside the
 * peer [p10, p90] band.
 */
function ruleDevisOutlier(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  const faults: FinancialFault[] = [];
  for (const r of records) {
    const devis = r.devisAnnuel;
    if (typeof devis !== "number" || devis <= 0) continue;
    const { stats, scope } = peerStatsFor(records, r.level);
    if (stats.n < 2) continue;
    const factor = devis / stats.median;
    if (factor <= DEVIS_LEGIT_LARGE_FACTOR) continue;

    const evidence = [
      `Devis ${fmt(devis)} vs médiane ${fmt(stats.median)} du scope « ${scope} » (n=${stats.n}) → ratio ×${factor.toFixed(1)}`,
    ];
    // The extra-digit test: /10 landing in the peer band is the classic
    // single-typo signature (2 645 000 → 264 500).
    const divided = devis / TYPO_DIVISOR;
    if (divided >= stats.p10 && divided <= stats.p90) {
      evidence.push(
        `Divisé par 10 → ${fmt(divided)}, DANS la bande peer [${fmt(stats.p10)} ; ${fmt(stats.p90)}] — signature d'une frappe d'un chiffre en trop`,
      );
    }
    if (typeof r.remise === "number" && r.remise > 0) {
      evidence.push(
        `Remise ${fmt(r.remise)} — cohérente avec un devis de l'ordre de ${fmt(divided > 0 ? divided + r.remise : stats.median)}, pas de ${fmt(devis)}`,
      );
    }

    if (factor > DEVIS_OUTLIER_FACTOR) {
      faults.push({
        rule: "devis_outlier",
        verdict: "suspicious",
        subject: subjectOf(r),
        summary: `Devis annuel ${fmt(devis)} = ×${factor.toFixed(1)} la médiane de son niveau — incohérent avec la grille tarifaire du scope « ${scope} »`,
        evidence,
        suggestedAction:
          "Vérifier la formule Excel du devis (constante de base) et le devis signé par la famille; corriger la source avant ré-import",
      });
    } else {
      // 2×..3× the median: unusually large but not absurd — flagged so the
      // reviewer can PASS it explicitly (a legitimate but large devis).
      faults.push({
        rule: "devis_outlier",
        verdict: "legitimate_large",
        subject: subjectOf(r),
        summary: `Devis annuel ${fmt(devis)} = ×${factor.toFixed(1)} la médiane du scope « ${scope} » — élevé mais pas aberrant`,
        evidence,
        suggestedAction:
          "Confirmer auprès de la direction que ce devis négocié est voulu (le passer en revue, pas le bloquer)",
      });
    }
  }
  return faults;
}

/**
 * 2. devis_component_outlier — the BENADOUDA class (formula evidence,
 * optional): decompose the devis formula's addends; the largest is the
 * tuition base, the others are complements (transport …); a complement
 * far outside the peer complement norm is flagged.
 */
function ruleDevisComponentOutlier(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  // Collect the non-base addends across all formula-bearing records.
  const addendsOf = (r: FinancialRecordContext): number[] => {
    if (!r.devisFormula) return [];
    const nums = [...r.devisFormula.matchAll(/(\d{4,})/g)].map((m) =>
      Number(m[1]),
    );
    return nums.filter((n) => n > 0);
  };
  const allAddends = records.flatMap(addendsOf);
  if (allAddends.length === 0) return [];

  // Peer norm for COMPLEMENTS: for each record, the largest addend is the
  // base; everything else is a complement.
  const complements = records.flatMap((r) => {
    const a = addendsOf(r);
    if (a.length < 2) return [];
    const max = Math.max(...a);
    return a.filter((x) => x < max);
  });
  if (complements.length < 3) return []; // thin evidence — no verdict
  const compStats = statsOf(complements);

  const faults: FinancialFault[] = [];
  for (const r of records) {
    const a = addendsOf(r);
    if (a.length < 2) continue;
    const max = Math.max(...a);
    for (const x of a) {
      if (x >= max) continue;
      if (x > compStats.median * ADDEND_OUTLIER_FACTOR && x > compStats.p90) {
        faults.push({
          rule: "devis_component_outlier",
          verdict: "suspicious",
          subject: subjectOf(r),
          summary: `Complément de ${fmt(x)} dans la formule du devis (${r.devisFormula}) — ×${(x / compStats.median).toFixed(1)} la norme des compléments (${fmt(compStats.median)}, n=${compStats.n})`,
          evidence: [
            `Formule: ${r.devisFormula}`,
            `Compléments peers: médiane ${fmt(compStats.median)}, p90 ${fmt(compStats.p90)} (n=${compStats.n})`,
            `Le complément de ${fmt(x)} est hors norme — une frappe 400 000 pour 40 000 a exactement cette signature`,
          ],
          suggestedAction:
            "Vérifier la formule Excel: le complément (transport etc.) dépasse la grille; comparer avec les formules des lignes voisines",
        });
      }
    }
  }
  return faults;
}

/**
 * 3. dettes_exceeds_devis — the TASLGHOUA class: prior-year debts larger
 * than the current annual devis. Not provably wrong (multi-year
 * accumulation exists), but not decidable from this workbook either.
 */
function ruleDettes(records: readonly FinancialRecordContext[]): FinancialFault[] {
  const faults: FinancialFault[] = [];
  for (const r of records) {
    const d = r.dettes;
    const devis = r.devisAnnuel;
    if (typeof d !== "number" || d <= 0 || typeof devis !== "number" || devis <= 0) {
      continue;
    }
    if (d > devis) {
      faults.push({
        rule: "dettes_exceeds_devis",
        verdict: "unverifiable",
        subject: subjectOf(r),
        summary: `Dettes antérieures ${fmt(d)} > devis annuel ${fmt(devis)} — plus d'une année de frais due avant l'année en cours`,
        evidence: [
          `Dettes: ${fmt(d)}; Devis ${fmt(devis)}; Réglé sur dettes: ${fmt(r.reglementsDettes ?? 0)}`,
          "Les registres des années antérieures ne sont pas dans ce classeur — impossible de trancher ici",
        ],
        suggestedAction:
          "Rapprocher des états des années précédentes (ou des reçus papier) avant d'intégrer ces dettes au solde",
      });
    }
  }
  return faults;
}

/**
 * 4. creance_invariant — the BERDAI class: TOTAL*CREANCE must equal
 * devis − versements. A violation is a CONFIRMED internal error of the
 * workbook (stale cache or manual override), provable from the row alone.
 */
function ruleCreanceInvariant(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  const faults: FinancialFault[] = [];
  for (const r of records) {
    const devis = r.devisAnnuel;
    const paid = r.totalVersements;
    const creance = r.totalCreance;
    if (
      typeof devis !== "number" ||
      typeof paid !== "number" ||
      typeof creance !== "number"
    ) {
      continue;
    }
    const expected = devis - paid;
    const tol = Math.max(1, devis * INVARIANT_TOL_PCT);
    if (Math.abs(expected - creance) > tol) {
      faults.push({
        rule: "creance_invariant",
        verdict: "confirmed_error",
        subject: subjectOf(r),
        summary: `Créance ${fmt(creance)} ≠ devis − versements (${fmt(devis)} − ${fmt(paid)} = ${fmt(expected)}) — écart ${fmt(creance - expected)}`,
        evidence: [
          `Devis ${fmt(devis)}; Versements ${fmt(paid)}; Créance stockée ${fmt(creance)}; attendu ${fmt(expected)}`,
          "Formule de la colonne TOTAL*CREANCE probablement écrasée manuellement ou cache non recalculé",
        ],
        suggestedAction:
          "Restaurer la formule =L{ligne}−P{ligne} dans le classeur source, puis ré-importer",
      });
    }
  }
  return faults;
}

/**
 * 5. versements_invariant — Σ(FI+V1+2V+v3+1T+T2+t3) must equal TOTAL
 * VERSEMENTS. Cheap and total; 0 hits on the real workbook today.
 */
function ruleVersementsInvariant(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  const faults: FinancialFault[] = [];
  for (const r of records) {
    const paid = r.totalVersements;
    if (typeof paid !== "number" || !r.tuitionComponents || !r.transportComponents) {
      continue;
    }
    const { fi, v1, v2Alt, v3 } = r.tuitionComponents;
    const { t1, t2, t3 } = r.transportComponents;
    const sum = [fi, v1, v2Alt, v3, t1, t2, t3].reduce<number>(
      (a, v) => a + (typeof v === "number" ? v : 0),
      0,
    );
    const tol = Math.max(1, Math.abs(paid) * INVARIANT_TOL_PCT);
    if (Math.abs(sum - paid) > tol) {
      faults.push({
        rule: "versements_invariant",
        verdict: "confirmed_error",
        subject: subjectOf(r),
        summary: `TOTAL VERSEMENTS ${fmt(paid)} ≠ Σ tranches (${fmt(sum)}) — écart ${fmt(paid - sum)}`,
        evidence: [
          `FI ${fmt(fi ?? 0)} + V1 ${fmt(v1 ?? 0)} + 2V ${fmt(v2Alt ?? 0)} + v3 ${fmt(v3 ?? 0)} + 1T ${fmt(t1 ?? 0)} + T2 ${fmt(t2 ?? 0)} + t3 ${fmt(t3 ?? 0)} = ${fmt(sum)}`,
          `TOTAL VERSEMENTS stocké: ${fmt(paid)}`,
        ],
        suggestedAction:
          "Recalculer le classeur (cache périmé) ou corriger la formule P=R+S+T+U+W+X+Y",
      });
    }
  }
  return faults;
}

/**
 * 6. duplicate_identity_conflict — the HEROUA / KHALEF class: two rows
 * resolve to the same student (same name, and same class or same phone)
 * but carry DIFFERENT financials. The import merges first-wins; the
 * contradiction is not decidable from the workbook.
 */
function ruleDuplicateIdentity(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  const faults: FinancialFault[] = [];
  const groups = new Map<string, FinancialRecordContext[]>();
  const keyOf = (r: FinancialRecordContext) =>
    r.studentName.toUpperCase().replace(/\s+/g, " ").trim();
  for (const r of records) {
    const k = keyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, rows] of groups) {
    if (rows.length < 2) continue;
    // Same identity needs POSITIVE corroboration beyond the name — never
    // a missing field (a null phone on one row is NO evidence of same
    // identity: the live workbook has three same-name pairs whose phones
    // AND classes both differ — BIDA MED 1AP/2AAM, SIDI MAMER CM2/5AP,
    // HEMDANI CM1/CE2 — none of them is a duplicate).
    //   both phones known → same phone OR same class
    //   a phone missing   → the classes must MATCH (both known)
    const sameIdentity = rows.every((r) =>
      rows.every((o) => {
        if (r.phone && o.phone) {
          return (
            String(r.phone) === String(o.phone) ||
            (!!r.className && r.className === o.className)
          );
        }
        return !!r.className && !!o.className && r.className === o.className;
      }),
    );
    if (!sameIdentity) continue;
    // Compare the financials.
    const fields: Array<[string, (r: FinancialRecordContext) => number | null | undefined]> = [
      ["devis", (r) => r.devisAnnuel],
      ["versements", (r) => r.totalVersements],
      ["créance", (r) => r.totalCreance],
      ["dettes", (r) => r.dettes],
    ];
    const diffs: string[] = [];
    for (const [label, get] of fields) {
      const vals = rows.map(get);
      const allEqual = vals.every((v) => v === vals[0]);
      if (!allEqual) {
        diffs.push(
          `${label}: ${rows.map((r, i) => `ligne ${r.excelRow ?? "?"} = ${fmt(vals[i] ?? 0)}`).join(" vs ")}`,
        );
      }
    }
    if (diffs.length === 0) continue; // identical twins — merge is safe
    // The identity evidence, stated honestly (phones/classes of the rows).
    const phones = [...new Set(rows.map((r) => r.phone ?? "—"))].join("/");
    const classes = [...new Set(rows.map((r) => r.className ?? "—"))].join("/");
    faults.push({
      rule: "duplicate_identity_conflict",
      verdict: "unverifiable",
      subject: `${k} (lignes ${rows.map((r) => r.excelRow ?? "?").join(", ")})`,
      summary: `${rows.length} lignes pour le même élève (même nom; classes ${classes}; tél ${phones}) avec des valeurs contradictoires`,
      evidence: [
        ...diffs,
        "L'import fusionne ces lignes (première valeur gagne) — l'écart ne peut pas être tranché depuis le classeur",
      ],
      suggestedAction:
        "Rapprocher des reçus papier pour chaque ligne, puis supprimer la ligne erronée du classeur source",
    });
  }
  return faults;
}

/**
 * 7. embedded_aggregate — the HABRI class: a formula inside a DATA column
 * that references OTHER ROWS (a scratch family sum). Provable from the
 * formula alone — a confirmed data-column contamination.
 */
function ruleEmbeddedAggregate(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  const faults: FinancialFault[] = [];
  for (const r of records) {
    if (!r.crossRowFormula) continue;
    faults.push({
      rule: "embedded_aggregate",
      verdict: "confirmed_error",
      subject: subjectOf(r),
      summary: `Formule multi-lignes dans une colonne de données (${r.devisFormula ?? "références croisés"}) — un calcul de famille saisie dans la colonne d'une élève`,
      evidence: [
        `Formule: ${r.devisFormula ?? "(références vers d'autres lignes)"}`,
        "Une formule =a+b+c… sans référence de ligne courante additionne d'autres lignes — une cellule de travail, pas une donnée",
      ],
      suggestedAction:
        "Déplacer le calcul de famille hors des colonnes de données (une zone de synthèse), sinon l'import le lit comme la valeur de l'élève",
    });
  }
  return faults;
}

/**
 * 8. transport_context — transport WITHOUT sufficient supporting info:
 * an OPTION/destination with no transport detail at all, or transport
 * tranches with no destination.
 */
function ruleTransportContext(
  records: readonly FinancialRecordContext[],
): FinancialFault[] {
  const faults: FinancialFault[] = [];
  for (const r of records) {
    const tc = r.transportComponents;
    const trSum = tc
      ? [tc.t1, tc.t2, tc.t3].reduce<number>(
          (a, v) => a + (typeof v === "number" ? v : 0),
          0,
        )
      : 0;
    const hasTransportFlag = r.hasTransportOption === true || !!r.transportDestination;
    const hasDestination = !!r.transportDestination;
    const hasDevis = typeof r.devisAnnuel === "number" && r.devisAnnuel > 0;
    if (hasTransportFlag && trSum === 0 && !hasDevis) {
      // Transport claimed with NEITHER tranches NOR a devis to fold it
      // into — nothing anywhere supports the claim. (When devis > 0 the
      // transport typically lives inside the devis formula — 124 such
      // rows in the real workbook — which in-app value-only parsing
      // cannot decompose; flagging all of them would be noise, not
      // signal. The formula-aware harness layer covers that case.)
      faults.push({
        rule: "transport_context",
        verdict: "suspicious",
        subject: subjectOf(r),
        summary: `Transport déclaré (${r.transportDestination ?? "OPTION TRNSP"}) sans tranches NI devis — aucune donnée ne le chiffre`,
        evidence: [
          `Destination: ${r.transportDestination ?? "(vide)"}; 1T/T2/t3: aucune valeur; Devis: 0`,
          `Le transport ne peut être ni chiffré ni rapproché depuis cette ligne`,
        ],
        suggestedAction:
          "Documenter les tranches transport (1T/T2/t3) ou intégrer le tarif au devis",
      });
    } else if (!hasDestination && trSum > 0) {
      faults.push({
        rule: "transport_context",
        verdict: "suspicious",
        subject: subjectOf(r),
        summary: `Tranches transport (${fmt(trSum)}) sans destination renseignée`,
        evidence: [
          `1T ${fmt(tc?.t1 ?? 0)} + T2 ${fmt(tc?.t2 ?? 0)} + t3 ${fmt(tc?.t3 ?? 0)} = ${fmt(trSum)} — DISTINATION vide`,
        ],
        suggestedAction: "Renseigner la destination (grille transport par commune)",
      });
    }
  }
  return faults;
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export function inspectFinancialRecords(
  records: readonly FinancialRecordContext[],
): readonly FinancialFault[] {
  if (records.length === 0) return [];
  return [
    ...ruleDevisOutlier(records),
    ...ruleDevisComponentOutlier(records),
    ...ruleDettes(records),
    ...ruleCreanceInvariant(records),
    ...ruleVersementsInvariant(records),
    ...ruleDuplicateIdentity(records),
    ...ruleEmbeddedAggregate(records),
    ...ruleTransportContext(records),
  ];
}

/** Verdict ordering for reports (worst first). */
export const FAULT_VERDICT_ORDER: readonly FaultVerdict[] = [
  "confirmed_error",
  "suspicious",
  "unverifiable",
  "legitimate_large",
];

export function sortFaultsForReport(
  faults: readonly FinancialFault[],
): readonly FinancialFault[] {
  return [...faults].sort(
    (a, b) =>
      FAULT_VERDICT_ORDER.indexOf(a.verdict) - FAULT_VERDICT_ORDER.indexOf(b.verdict),
  );
}
