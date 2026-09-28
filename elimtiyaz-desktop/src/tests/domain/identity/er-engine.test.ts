/**
 * ER-PMAE engine unit suite — the issue-#16 §13 checklist (T-438 Phase 2).
 *
 * Suites (the issue's own test matrix, mapped to identity-rules.md):
 *   1. Phone Normalizer   — delimiters, malformed tokens, national formats, dummies
 *   2. Name Comparator    — transposed names, 1-char typos, initials, asymmetry
 *   3. Sibling Guardrail  — shared phone + distinct first names + grade gap ⇒ veto
 *   4. Transitivity       — the A-B-C bridge is CUT, never transitively merged
 *   5. Rollback           — unmerge restores the exact prior mapping (pure-graph level)
 *   6. Idempotency        — re-analyzing unchanged observations is a no-op
 *   plus: blocking saturation (INV-44), band boundaries, evidence vectors
 *   (INV-51), survivorship/provenance (INV-53), the observation hash (INV-55).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeName,
  normalizePhones,
  gradeRankOf,
  normalizeObservation,
  observationHash,
  blockingKeysFor,
  buildCandidatePool,
  levenshteinSimilarity,
  phoneticKey,
  compareNames,
  evaluateVetoes,
  bandOf,
  scorePair,
  connectedComponents,
  componentDensity,
  resolveClusters,
  synthesizeCanonical,
  analyze,
  ER_BLOCKING_SATURATION_LIMIT,
  type ErObservation,
  type ErNormalized,
} from "../../../domain/identity";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-09-29T12:00:00.000Z";

function obs(partial: Partial<ErObservation> & { id: string }): ErObservation {
  return {
    sourceSystem: "xlsx:test",
    sourceRecordId: partial.id,
    kind: "parent",
    displayName: null,
    phones: [],
    email: null,
    gradeLevelCode: null,
    transportDestination: null,
    gender: null,
    academicYear: null,
    extractedAt: NOW,
    tier: "import",
    canonicalId: null,
    ...partial,
  };
}

function norm(partial: Partial<ErNormalized> & { observationId: string }): ErNormalized {
  return {
    nameTokens: [],
    phones: [],
    email: null,
    gradeRank: null,
    transportKey: null,
    gender: null,
    academicYear: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1. Phone normalizer (identity-rules §2.2, INV-43)
// ---------------------------------------------------------------------------

describe("ER-PMAE 1 — phone normalizer", () => {
  it("splits composite cells across every documented delimiter", () => {
    expect(normalizePhones(["0663701834/0660800317"])).toEqual(["0660800317", "0663701834"]);
    expect(normalizePhones(["0550.12.34.56, 0770-99-88-77"])).toEqual(["0550123456", "0770998877"]);
    expect(normalizePhones(["0661111111; 0772222222 | 0553333333"])).toEqual([
      "0553333333",
      "0661111111",
      "0772222222",
    ]);
    expect(normalizePhones(["0661111111 et 0772222222"])).toEqual(["0661111111", "0772222222"]);
  });

  it("resolves national formats (+213 / 00213 / bare 213)", () => {
    expect(normalizePhones(["+213 663 70 18 34"])).toEqual(["0663701834"]);
    expect(normalizePhones(["+213(0)663701834"])).toEqual(["0663701834"]);
    expect(normalizePhones(["00213663701834"])).toEqual(["0663701834"]);
    expect(normalizePhones(["213 663 70 18 34"])).toEqual(["0663701834"]);
  });

  it("discards malformed tokens (< 8 digits) and dummy numbers", () => {
    expect(normalizePhones(["12345", "abc", ""])).toEqual([]);
    expect(normalizePhones(["0000000000"])).toEqual([]); // dummy placeholder
    expect(normalizePhones(["(inconnu)"])).toEqual([]); // import placeholder
  });

  it("deduplicates and sorts (the SET semantics)", () => {
    expect(normalizePhones(["0663701834", "0663701834", "0660800317"])).toEqual([
      "0660800317",
      "0663701834",
    ]);
  });

  it("is idempotent (INV-42)", () => {
    const once = normalizePhones(["0663701834/0660800317"]);
    const twice = normalizePhones(once);
    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// 2. Name comparator (identity-rules §4.3, INV-47)
// ---------------------------------------------------------------------------

describe("ER-PMAE 2 — name comparator", () => {
  it("transposed first/last names score like ordered ones (≥ 0.88)", () => {
    const s = compareNames(["kennedy", "john"], ["john", "kennedy"]);
    expect(s).toBeGreaterThanOrEqual(0.88);
    expect(s).toEqual(compareNames(["john", "kennedy"], ["kennedy", "john"]));
  });

  it("1-char typos stay strong (Kenedy vs Kennedy ≥ 0.85)", () => {
    expect(compareNames(["kenedy"], ["kennedy"])).toBeGreaterThanOrEqual(0.85);
    expect(compareNames(["sediki", "ishak"], ["sediki", "ishaq"])).toBeGreaterThanOrEqual(0.85);
  });

  it("initials match their full forms with partial credit", () => {
    const s = compareNames(["sediki", "f"], ["sediki", "fatima"]);
    expect(s).toBeGreaterThanOrEqual(0.85); // initial + surname exact
  });

  it("asymmetry: a short query is not penalized against a comprehensive record", () => {
    const short = compareNames(["sediki", "ishak"], ["sediki", "ishak", "mohamed"]);
    expect(short).toBeGreaterThanOrEqual(0.88); // coverage of the query is what counts
  });

  it("distinct names score low", () => {
    expect(compareNames(["benali", "karim"], ["sediki", "ishak"])).toBeLessThan(0.5);
  });

  it("diacritics and honorifics are stripped by normalization", () => {
    expect(normalizeName("SEDIKI, Ishak (NV)")).toEqual(["sediki", "ishak"]);
    expect(normalizeName("M. BÉNALI Karim")).toEqual(["benali", "karim"]);
    expect(normalizeName("Dr Fatima Zohra")).toEqual(["fatima", "zohra"]);
  });

  it("phonetic keys collapse transliteration variants", () => {
    expect(phoneticKey("sediki")).toEqual(phoneticKey("seddiki"));
    expect(phoneticKey("benali")).toEqual(phoneticKey("benaly"));
  });

  it("levenshtein similarity basics", () => {
    expect(levenshteinSimilarity("karim", "karim")).toBe(1);
    expect(levenshteinSimilarity("karim", "kalim")).toBeCloseTo(0.8, 2);
  });
});

// ---------------------------------------------------------------------------
// 3. Sibling guardrail (identity-rules §4.1, INV-46)
// ---------------------------------------------------------------------------

describe("ER-PMAE 3 — sibling guardrail veto", () => {
  const sharedPhone = ["0663701834"];

  it("shared phone + distinct first names + ≥ 2 grade ranks apart ⇒ veto", () => {
    const a = norm({
      observationId: "a",
      nameTokens: ["sediki", "ishak"],
      phones: sharedPhone,
      gradeRank: gradeRankOf("1ap"),
    });
    const b = norm({
      observationId: "b",
      nameTokens: ["sediki", "yakoub"],
      phones: sharedPhone,
      gradeRank: gradeRankOf("5ap"),
    });
    const vetoes = evaluateVetoes(a, b);
    expect(vetoes).toContain("sibling-guardrail");
    // And the score is pinned to separate:
    const scored = scorePair(a, b, vetoes, false);
    expect(scored.band).toBe("separate");
    expect(scored.confidence).toBe(0);
  });

  it("same phone + SIMILAR first names + close grades ⇒ NO veto", () => {
    const a = norm({
      observationId: "a",
      nameTokens: ["sediki", "mohamed"],
      phones: sharedPhone,
      gradeRank: gradeRankOf("1ap"),
    });
    const b = norm({
      observationId: "b",
      nameTokens: ["sediki", "mohammed"],
      phones: sharedPhone,
      gradeRank: gradeRankOf("1ap"),
    });
    expect(evaluateVetoes(a, b)).toEqual([]);
  });

  it("household evidence WITHOUT grade divergence is not a veto (context only)", () => {
    const a = norm({
      observationId: "a",
      nameTokens: ["sediki", "ishak"],
      phones: sharedPhone,
      gradeRank: gradeRankOf("1ap"),
    });
    const b = norm({
      observationId: "b",
      nameTokens: ["sediki", "yakoub"],
      phones: sharedPhone,
      gradeRank: gradeRankOf("2ap"),
    });
    expect(evaluateVetoes(a, b)).toEqual([]); // rank gap 1 < 2 — no hard veto
  });

  it("different recorded genders veto", () => {
    const a = norm({ observationId: "a", nameTokens: ["benali"], gender: "M" });
    const b = norm({ observationId: "b", nameTokens: ["benali"], gender: "F" });
    expect(evaluateVetoes(a, b)).toContain("demographic-incompatibility");
  });

  it("same year + near-zero name containment vetoes (different concurrent registrations)", () => {
    const a = norm({ observationId: "a", nameTokens: ["benali", "karim"], academicYear: "2026-2027" });
    const b = norm({ observationId: "b", nameTokens: ["sediki", "ishak"], academicYear: "2026-2027" });
    expect(evaluateVetoes(a, b)).toContain("same-year-identity-clash");
  });
});

// ---------------------------------------------------------------------------
// 4. Transitivity protection (identity-rules §6.2, INV-52)
// ---------------------------------------------------------------------------

describe("ER-PMAE 4 — transitivity / bridge cutting", () => {
  // The issue's canonical trap: A=("John Smith", P1), B=("John Smith", P1+P2),
  // C=("Adam Smith", P2). A-B strong, B-C moderate, A-C shares NOTHING.
  const nodes = ["A", "B", "C"];
  const edges = [
    { u: "A", v: "B", weight: 0.95 },
    { u: "B", v: "C", weight: 0.82 },
  ];

  it("the weak bridge is cut — A and C never share a cluster", () => {
    const clusters = resolveClusters(nodes, edges, 0.75);
    expect(clusters.length).toBe(2);
    const ids = clusters.map((c) => [...c].sort().join(",")).sort();
    expect(ids).toEqual(["A,B", "C"]);
  });

  it("a dense triangle stays ONE cluster", () => {
    const dense = [
      { u: "A", v: "B", weight: 0.95 },
      { u: "B", v: "C", weight: 0.9 },
      { u: "A", v: "C", weight: 0.9 },
    ];
    const clusters = resolveClusters(nodes, dense, 0.75);
    expect(clusters.length).toBe(1);
    expect(componentDensity(new Set(nodes), dense)).toBe(1);
  });

  it("connected components work over isolated nodes", () => {
    const comps = connectedComponents(["x", "y"], []);
    expect(comps.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Rollback (the unmerge graph semantics — INV-54's pure-graph core)
// ---------------------------------------------------------------------------

describe("ER-PMAE 5 — unmerge restores the exact prior clusters", () => {
  it("severing B's edge splits the pair while the rest stays linked", () => {
    // Cluster {A,B,C} dense; the user severs B.
    const edges = [
      { u: "A", v: "B", weight: 0.9 },
      { u: "B", v: "C", weight: 0.9 },
      { u: "A", v: "C", weight: 0.9 },
    ];
    expect(resolveClusters(["A", "B", "C"], edges, 0.75)).toHaveLength(1);
    // Unmerge(B): remove B's edges → {A,C} stays one cluster, B alone.
    const afterUnmerge = edges.filter((e) => e.u !== "B" && e.v !== "B");
    const clusters = resolveClusters(["A", "B", "C"], afterUnmerge, 0.75);
    const ids = clusters.map((c) => [...c].sort().join(",")).sort();
    expect(ids).toEqual(["A,C", "B"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Idempotency (identity-rules §8, INV-55)
// ---------------------------------------------------------------------------

describe("ER-PMAE 6 — idempotent re-analysis", () => {
  const incoming = [
    obs({ id: "r1", displayName: "SEDIKI Ishak", phones: ["0663701834"], academicYear: "2026-2027" }),
  ];
  const existing = [
    obs({
      id: "e1",
      sourceSystem: "canonical",
      sourceRecordId: "PAR-2026-A4F9",
      displayName: "SEDIKI Ishak",
      phones: ["0663701834"],
      tier: "manual",
      canonicalId: "p-1",
    }),
  ];
  const input = { incoming, existing, negativePairs: [], now: NOW };

  it("the observation hash is deterministic", () => {
    const n = normalizeObservation(incoming[0]);
    const h1 = observationHash(n, incoming[0].sourceSystem, incoming[0].sourceRecordId);
    const h2 = observationHash(normalizeObservation(incoming[0]), incoming[0].sourceSystem, incoming[0].sourceRecordId);
    expect(h1).toEqual(h2);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });

  it("re-analysis with the prior hash set produces ZERO proposals (the no-op)", () => {
    const first = analyze(input);
    expect(first.proposals.length).toBeGreaterThan(0);
    const n = normalizeObservation(incoming[0]);
    const hash = observationHash(n, incoming[0].sourceSystem, incoming[0].sourceRecordId);
    const second = analyze(input, [
      { sourceSystem: incoming[0].sourceSystem, sourceRecordId: incoming[0].sourceRecordId, payloadHash: hash },
    ]);
    expect(second.proposals).toHaveLength(0);
    expect(second.stats.pairsScored).toBe(0);
  });

  it("a CHANGED payload (phone changed) re-analyzes", () => {
    const n = normalizeObservation(incoming[0]);
    const staleHash = observationHash(n, incoming[0].sourceSystem, incoming[0].sourceRecordId);
    const changed = analyze(
      { ...input, incoming: [obs({ id: "r1", displayName: "SEDIKI Ishak", phones: ["0770998877"] })] },
      [{ sourceSystem: "xlsx:test", sourceRecordId: "r1", payloadHash: staleHash }],
    );
    expect(changed.stats.pairsScored).toBeGreaterThanOrEqual(0);
    expect(changed.unbound).toHaveLength(1); // different phone → no longer binds
  });
});

// ---------------------------------------------------------------------------
// Blocking (identity-rules §3, INV-44)
// ---------------------------------------------------------------------------

describe("ER-PMAE — blocking passes + saturation", () => {
  it("generates keys across the four passes", () => {
    const keys = blockingKeysFor(
      norm({ observationId: "x", nameTokens: ["sediki", "ishak"], phones: ["0663701834"] }),
    );
    const passes = new Set(keys.map((k) => k.pass));
    expect(passes.has("phone")).toBe(true);
    expect(passes.has("token-pair")).toBe(true);
    expect(passes.has("phonetic")).toBe(true);
    expect(passes.has("initial-surname")).toBe(true);
    expect(keys.map((k) => k.key)).toContain("TEL:0663701834");
  });

  it("order-invariant token blocking bridges transposed names", () => {
    const inc = [norm({ observationId: "inc", nameTokens: ["kennedy", "john"] })];
    const ex = [norm({ observationId: "ex", nameTokens: ["john", "kennedy"] })];
    const { candidatesByObservation } = buildCandidatePool(inc, ex);
    expect(candidatesByObservation.get("inc")?.has("ex")).toBe(true);
  });

  it("saturated keys are skipped, never fatal (INV-44)", () => {
    // 56 existing observations share the saturated name-token key; the
    // incoming bridges to the ONE carrying its phone via the phone pass.
    const inc = [
      norm({ observationId: "inc", nameTokens: ["benali", "karim"], phones: ["0663701834"] }),
    ];
    const existing: ErNormalized[] = [
      norm({ observationId: "target", nameTokens: ["benali", "karim"], phones: ["0663701834"] }),
    ];
    for (let i = 0; i < ER_BLOCKING_SATURATION_LIMIT + 5; i++) {
      existing.push(norm({ observationId: `saturated-${i}`, nameTokens: ["benali", "karim"] }));
    }
    const { candidatesByObservation, saturatedKeysSkipped } = buildCandidatePool(inc, existing);
    expect(saturatedKeysSkipped).toBeGreaterThan(0);
    // The saturated name keys were skipped, but the phone pass still
    // bridged the true target (the bucket of 1 is not saturated):
    const pool = candidatesByObservation.get("inc");
    expect(pool?.has("target")).toBe(true);
    // And the 55 same-name observations did NOT flood the pool:
    expect(pool?.size ?? 0).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// Scoring + bands + evidence (identity-rules §5, INV-49/50/51)
// ---------------------------------------------------------------------------

describe("ER-PMAE — bands, evidence, deterministic gate", () => {
  it("band boundaries follow the documented thresholds", () => {
    expect(bandOf(0.95)).toBe("definite");
    expect(bandOf(0.92)).toBe("definite");
    expect(bandOf(0.91)).toBe("probable");
    expect(bandOf(0.8)).toBe("probable");
    expect(bandOf(0.79)).toBe("review");
    expect(bandOf(0.6)).toBe("review");
    expect(bandOf(0.59)).toBe("separate");
  });

  it("strong name + shared phone lands in the definite band with full evidence", () => {
    const a = norm({ observationId: "a", nameTokens: ["sediki", "ishak"], phones: ["0663701834"] });
    const b = norm({ observationId: "b", nameTokens: ["sediki", "ishaq"], phones: ["0663701834"] });
    const scored = scorePair(a, b, [], false);
    expect(scored.band).toBe("definite");
    expect(scored.confidence).toBe(1); // the Band-1 deterministic gate
    // INV-51: the evidence vector is present and carries the phone + name rows.
    const fields = scored.evidence.map((e) => e.field);
    expect(fields).toContain("phones");
    expect(fields).toContain("name");
    const phoneRow = scored.evidence.find((e) => e.field === "phones");
    expect(phoneRow?.status).toBe("exact");
    expect(phoneRow?.weight).toBe(0.9);
  });

  it("the deterministic gate short-circuits to confidence 1.0", () => {
    const a = norm({ observationId: "a", nameTokens: ["x"] });
    const b = norm({ observationId: "b", nameTokens: ["y"] });
    const scored = scorePair(a, b, [], true);
    expect(scored.confidence).toBe(1);
    expect(scored.band).toBe("definite");
  });

  it("two populated disjoint phone sets contribute negative evidence", () => {
    const a = norm({ observationId: "a", nameTokens: ["sediki", "ishak"], phones: ["0663701834"] });
    const b = norm({ observationId: "b", nameTokens: ["sediki", "ishak"], phones: ["0770998877"] });
    const scored = scorePair(a, b, [], false);
    const phoneRow = scored.evidence.find((e) => e.field === "phones");
    expect(phoneRow?.status).toBe("mismatch");
    expect(phoneRow?.weight).toBe(-0.6);
    expect(scored.band).not.toBe("definite");
  });

  it("context (grade/transport) alone never reaches even the review band (INV-48)", () => {
    const a = norm({ observationId: "a", nameTokens: ["aaa"], gradeRank: 5, transportKey: "boudouaou" });
    const b = norm({ observationId: "b", nameTokens: ["zzz"], gradeRank: 5, transportKey: "boudouaou" });
    const scored = scorePair(a, b, [], false);
    expect(scored.confidence).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// Survivorship + provenance (identity-rules §6.3, INV-53)
// ---------------------------------------------------------------------------

describe("ER-PMAE — canonical synthesis survivorship", () => {
  const observations = [
    obs({
      id: "s1",
      sourceSystem: "xlsx:2021",
      displayName: "M. Ishak Sediki",
      phones: ["0663701834"],
      tier: "import",
      extractedAt: "2021-09-15T00:00:00.000Z",
    }),
    obs({
      id: "s2",
      sourceSystem: "xlsx:2026",
      displayName: "Mohamed Ishak Sediki",
      phones: ["0663701834/0660800317"],
      tier: "import",
      extractedAt: "2026-09-15T00:00:00.000Z",
    }),
    obs({
      id: "s3",
      sourceSystem: "manual",
      displayName: "Mohamed Ishak Sediki",
      phones: ["0663701834"],
      transportDestination: "Boudouaou",
      tier: "manual",
      extractedAt: "2026-09-20T00:00:00.000Z",
    }),
  ];

  it("the most complete name survives (structural completeness)", () => {
    const synthesis = synthesizeCanonical(observations, observations.map(normalizeObservation), NOW);
    expect(synthesis.displayName.value).toBe("Mohamed Ishak Sediki");
    expect(synthesis.displayName.rule).not.toBe("SINGLE_SOURCE");
  });

  it("phones resolve by SET UNION (INV-53 — every unique number survives)", () => {
    const synthesis = synthesizeCanonical(observations, observations.map(normalizeObservation), NOW);
    expect(synthesis.phones.value).toEqual(["0660800317", "0663701834"]);
    expect(synthesis.phones.rule).toBe("SET_UNION");
  });

  it("every field records provenance (source + rule + timestamp)", () => {
    const synthesis = synthesizeCanonical(observations, observations.map(normalizeObservation), NOW);
    for (const field of [
      synthesis.displayName,
      synthesis.phones,
      synthesis.email,
      synthesis.gradeLevelCode,
      synthesis.transportDestination,
    ]) {
      expect(field.assignedAt).toBe(NOW);
      expect(typeof field.rule).toBe("string");
    }
    expect(synthesis.transportDestination.sourceObservationId).toBe("s3"); // manual tier won
  });
});

// ---------------------------------------------------------------------------
// The analyze() orchestrator (identity-rules §2–§5 end to end)
// ---------------------------------------------------------------------------

describe("ER-PMAE — analyze() end to end", () => {
  const existing = [
    obs({
      id: "e1",
      sourceSystem: "canonical",
      sourceRecordId: "PAR-2026-A4F9",
      displayName: "SEDIKI Ishak",
      phones: ["0663701834"],
      tier: "manual",
      canonicalId: "p-1",
      academicYear: "2026-2027",
    }),
    obs({
      id: "e2",
      sourceSystem: "canonical",
      sourceRecordId: "PAR-2026-B7G2",
      displayName: "BENALI Karim",
      phones: ["0770998877"],
      tier: "manual",
      canonicalId: "p-2",
      academicYear: "2026-2027",
    }),
  ];

  it("the same person in a new workbook binds (definite proposal, canonical target)", () => {
    const result = analyze({
      incoming: [
        obs({ id: "r1", displayName: "SEDIKI ISHAK", phones: ["0663701834/0660800317"], academicYear: "2026-2027" }),
      ],
      existing,
      negativePairs: [],
      now: NOW,
    });
    expect(result.proposals).toHaveLength(1);
    const p = result.proposals[0];
    expect(p.bObservationId).toBe("e1");
    expect(p.score.band).toBe("definite");
    expect(p.status).toBe("proposed"); // INV-50: proposed, NEVER executed
    expect(result.unbound).toHaveLength(0);
  });

  it("an unknown person stays unbound (proceeds as a new entity)", () => {
    const result = analyze({
      incoming: [obs({ id: "r9", displayName: "MERZAK Farid", phones: ["0555112233"] })],
      existing,
      negativePairs: [],
      now: NOW,
    });
    expect(result.proposals).toHaveLength(0);
    expect(result.unbound.map((u) => u.id)).toEqual(["r9"]);
  });

  it("rejected pairs are never re-proposed (the negative constraint)", () => {
    const result = analyze(
      {
        incoming: [obs({ id: "r1", displayName: "SEDIKI ISHAK", phones: ["0663701834"] })],
        existing,
        negativePairs: [{ aId: "r1", bId: "e1" }],
        now: NOW,
      },
    );
    expect(result.proposals).toHaveLength(0);
  });

  it("sibling rows sharing the family phone produce NO proposal for the wrong sibling", () => {
    const result = analyze({
      incoming: [
        // Ishak (1AP) and Yakoub (5AP) — one household, two people.
        obs({ id: "r1", displayName: "SEDIKI Ishak", phones: ["0663701834"], gradeLevelCode: "1ap" }),
        obs({ id: "r2", displayName: "SEDIKI Yakoub", phones: ["0663701834"], gradeLevelCode: "5ap" }),
      ],
      existing: [
        obs({
          id: "e1",
          sourceSystem: "canonical",
          sourceRecordId: "PAR-2026-A4F9",
          displayName: "SEDIKI Yakoub",
          phones: ["0663701834"],
          gradeLevelCode: "5ap",
          tier: "manual",
          canonicalId: "p-1",
        }),
      ],
      negativePairs: [],
      now: NOW,
    });
    // Yakoub binds to Yakoub; Ishak (vetoed as a sibling) stays unbound.
    const forIshak = result.proposals.filter((p) => p.aObservationId === "r1");
    expect(forIshak).toHaveLength(0);
    expect(result.unbound.map((u) => u.id)).toContain("r1");
    const forYakoub = result.proposals.find((p) => p.aObservationId === "r2");
    expect(forYakoub).toBeDefined();
    expect(result.stats.vetoed).toBeGreaterThanOrEqual(1);
  });
});
