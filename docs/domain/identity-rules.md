# Domain Rules — Identity Resolution & User Aggregation (ER-PMAE)

> **Status:** Canonical (T-438 / ADR-032, 2026-09-29 — problems IDENT-100/101/102, GitHub issues #15 + #16).
> **Scope:** the rules governing how the system decides that two recorded observations describe the same real-world person, how such decisions are proposed/reviewed/executed/reversed, and the experimental feature's gating contract.
> **Status of the FEATURE:** **EXPERIMENTAL — DISABLED BY DEFAULT.** The engine is fully implemented but inactive until a user explicitly enables it in Settings → Expérimental (§9). Nothing in this document applies to a desktop where the flag is off — the import path is then byte-identical to the pre-T-438 behavior (INV-40).
> **Adaptation note (issue #15's own mandate):** the ER-PMAE article referenced by the issues is a CONCEPTUAL reference written for another program. These rules preserve its goals (open-world identity assumption, blocking, tiered matching, guardrails, reversibility, provenance, HITL) while replacing its prescribed mechanisms (REST endpoints, Python/NetworkX, its DDL) with THIS application's architecture: a pure-TS desktop domain engine, the repository duality (mock + Supabase), additive SQL persistence, and the canonical RPC write path.

---

## 1. The open-world identity model

1. **A record is an observation, not a person.** A parent row, a student row, and an Excel source row are each observations of reality captured through an imperfect instrument (a spreadsheet cell, a manual form). Identity questions are therefore PROBABILISTIC statements about observations, never absolutes stored on a row.
2. **The canonical entity stays canonical.** ER-PMAE never creates a second class of "person" records. The surviving entity in any aggregation is an EXISTING canonical row (`parents` / `students`). The engine's output is LINKAGE (edges + provenance), not new identity storage (ADR-032 decision 1).
3. **Fragmentation vs. false merge.** A false non-match creates a duplicate account that can be reconciled later; a false merge commingles two people's financial and academic histories. In a school's financial environment a false merge is the more destructive failure, so every threshold, veto, and confirmation gate is tuned to prefer separation when evidence is ambiguous (INV-41).

## 2. The normalization pipeline (deterministic, pure)

Every identity-bearing field passes through a deterministic normalization pipeline BEFORE any comparison. Normalization is idempotent: normalizing an already-normalized value changes nothing (INV-42).

1. **Names** (§2.1): NFKD decomposition → strip diacritics (`é`→`e`) → lowercase → drop honorifics/operational noise tokens (`dr`, `mr`, `mme`, `mlle`, `prof`, `nv`, `tuteur`, `par mois`, …) → strip non-alphanumeric characters → collapse whitespace → token list. `"SEDIKI, Ishak (NV)"` → `["sediki","ishak"]`.
2. **Phones** (§2.2): split composite cells across delimiters (`,`, `/`, `;`, `|`, newline, ` et `) → strip non-digits (keep leading `+`) → resolve Algerian national prefixes (`+213…`/`00213…` → `0…`) → validate length (8–14 digits; < 8 = garbage, discarded) → deduplicate → sorted array. A phone field is a SET of atomic contact points, never a scalar string (INV-43). The placeholder `"(inconnu)"` and obviously dummy numbers (`0000000000`) normalize to the empty set and NEVER act as matching evidence.
3. **Categorical context** (§2.3): grade levels / cycles / transport destinations map through the SAME canonical mappers the import engine already owns (`niveau-mapper`, `destination-mapper`) — ER never grows a second mapping table (the §6 no-duplicate-implementations rule).

## 3. Candidate generation (blocking)

Comparing every observation against every existing entity is quadratic; blocking prunes the search space first.

1. **Multi-pass keys.** An observation is compared in depth only against entities sharing AT LEAST ONE blocking key with it, across four independent passes:
   - **P1 — exact phone:** `TEL:<normalized-number>` (bridges even severely misspelled names);
   - **P2 — order-invariant name tokens:** `TOK:<two alphabetically-first name tokens>` (survives first/last inversion);
   - **P3 — phonetic compression:** `PHON:<phonetic key of the two primary tokens>` (a Metaphone-class encoder implemented in-repo, no external dependency);
   - **P4 — initial + surname:** `INIT:<first-token initial>:<second token>` (an abbreviation still intersects its full form).
2. **Saturation guard.** A key mapping to more than a threshold of entities (default 50) is a SATURATED key — skipped for that pass, never an error (a common surname or a dummy phone must not recreate the quadratic blow-up) (INV-44).
3. **The candidate pool is the union** of all passes' hits, deduplicated, then evaluated pairwise. The legacy exact-match resolution (`BatchParentIndex.resolveFamilyFor`: phone → email → placeholder-name stages) remains the FALLBACK for every observation the ER layer does not bind (INV-45).

## 4. The matching tiers and the hard vetoes

For each candidate pair, evaluation runs in strict order:

1. **Stage 1 — semantic hard disqualification (the veto rules).** Before any positive score:
   - **Sibling guardrail:** if the pair shares a contact phone (or exact phone-set intersection) AND both first names are fully formed (> 2 chars) AND their similarity is low (< 0.40) AND the grade ranks differ by ≥ 2 levels — they are members of one household, NOT one person. Hard veto: the pair can never be proposed as a match (INV-46). Shared household evidence without the name/grade divergence is NOT a veto — it is context.
   - **Demographic incompatibility:** explicitly recorded, contradictory immutable markers (gender on both rows differing) veto the pair.
   - **Same-year identity clash:** two observations of the same academic year whose normalized name tokens share < 20% containment are different concurrent registrations, not one person.
   - A veto is evidence about a PAIR, not a global fact: it is recorded as a negative constraint only when the pair is explicitly rejected in review (§7.3).
2. **Stage 2 — deterministic gate.** An exact match on a strong unique identifier (a canonical deterministic code — `parent_code` — or an exact normalized phone + ≥ 0.85 name similarity with no veto) resolves the pair deterministically: confidence 1.0, band `definite`.
3. **Stage 3 — probabilistic multi-field comparison.** Otherwise the pair is scored (§5) from field-level comparators:
   - **Asymmetric token-wise name coverage:** for each token of A, the best-matching token of B (exact = 1.0; single-letter-vs-full-initial = 0.9 when initials align; else `1 − levenshtein/max(len)`); coverage = mean over A's tokens; the pair score is `max(cov(A→B), cov(B→A)) − 0.08·|tokenCountDiff|` (a short query is not penalized for matching a comprehensive record — the abbreviation asymmetry rule) (INV-47).
   - **Phone-set intersection:** ≥ 1 shared valid number is strong positive evidence; two fully-populated disjoint phone sets is negative evidence (a Jaccard-style contribution, never a sole basis for a merge).
   - **Contextual alignment** (grade level, transport destination): supporting evidence only — sufficient to tip a high-variance name match across a threshold, never sufficient alone (INV-48).

## 5. Confidence scoring and the decision bands

1. **Weighted evidence aggregation.** Each field comparison contributes a signed weight (match = positive, mismatch = negative, missing = zero), converted through a logistic squash into a composite confidence in `[0,1]`. The weights are DOMAIN CONSTANTS documented here (name-strong +0.40 / name-weak +0.15 / phone-unique +0.45 / national-id-class +0.95 / context +0.10/+0.08; non-match weights −0.50/−0.30/−0.05) — changing them is a rules change that must update this file and re-run the ER suite (INV-49).
2. **The four bands:**
   - `definite` (≥ 0.92): deterministic or near-perfect alignment — proposed as an auto-candidate merge, still requiring explicit human confirmation before execution (INV-50 — the issue-#15 hard rule: NOTHING is merged without explicit confirmation, in every band).
   - `probable` (0.80 ≤ s < 0.92): proposed with an audit flag.
   - `review` (0.60 ≤ s < 0.80): staged in the review queue with the evidence snapshot; the pair is NEVER auto-proposed for execution.
   - `separate` (< 0.60): no proposal; the observation proceeds as a distinct entity.
3. **Score provenance is mandatory.** Every proposal records the full evidence vector (which fields matched, their weights, the veto checks passed) so a reviewer sees WHY the engine hesitated (INV-51).

## 6. Clustering, transitivity, and canonical synthesis

1. **Edges and clusters.** Approved/confirmed identity links form an undirected weighted graph over observations + canonical entities. A connected component is a candidate identity cluster. Simple transitivity is FORBIDDEN as a merge basis: A=B and B=C does NOT merge A=C (the snowball trap).
2. **Density validation.** Before a cluster of ≥ 3 nodes is proposed as one person, its edge density (actual/possible) must be ≥ 0.75; below that, the weakest edge is flagged as a bridge and the cluster is split at it (recursively). Bridge detection is a pure graph walk — no external graph library (INV-52).
3. **Field survivorship (the synthesis rules).** The surviving canonical entity's field values follow, in order: authoritative tier (manually-verified > imported spreadsheet) → temporal recency → additive set union (phones) → structural completeness (the longest name form wins ties). Every resolved field records its provenance: source observation, rule used, timestamp (INV-53).
4. **The invariant ledger rule.** Financial and academic rows are bound to their SOURCE observations; a merge RE-POINTS relationships in one transaction and records the complete prior mapping; balances and histories are then PROJECTIONS of the merged graph. An unmerge restores the exact prior mapping — the financial rows were never destructively rewritten (INV-54). A merge never recalculates any amount (INV-1 holds).

## 7. The human-in-the-loop contract

1. **Nothing merges without explicit confirmation** — regardless of band, score, or source (issue #15's non-negotiable). The only execution paths are: (a) the import-time confirmation step, (b) the review-queue decision actions, both human-initiated.
2. **The import-time flow (flag ON):** dry-run parse → ER analysis against the existing roster → the dedicated review surface lists detected records + proposed matches/aggregations with evidence + confidence + band → the user approves/rejects each proposal → the import executes, binding ONLY approved pairs through the canonical write path; every other row follows the legacy resolution (INV-45).
3. **Review-queue decisions:** `approve` (creates the active identity edge, executes the binding/merge, writes the audit event) or `reject` (writes a NEGATIVE CONSTRAINT edge — the pair is never proposed again by any future automated pass; reversible only by an explicit unreject action).
4. **Every decision is audited** with actor, timestamp, evidence snapshot, and rationale.

## 8. Idempotency and re-import safety

1. **Invariant observation hashing.** Each analyzed source observation carries a stable hash over (source system, record id, normalized payload). Re-analyzing an unchanged observation is a no-op: no new observation row, no new proposals, no duplicated edges (INV-55).
2. **Re-imports of an already-bound workbook** produce zero new entities and zero new edges (the hash hit short-circuits; the legacy exact-match path independently guarantees no duplicate rows — IMPORT-116/109).

## 9. The experimental gating contract (issue #15's isolation rules)

1. **Disabled by default.** The flag lives in per-desktop LOCAL storage (the local-config convention) — never in the server `feature_flags` (an experimental opt-in must not be flippable for every operator at once) (INV-56).
2. **The only activation path** is Settings → Expérimental → the User Aggregation / Identity Resolution toggle. The tab lists every experimental capability with its status and the experimental disclaimer.
3. **Flag OFF ⇒ byte-identical legacy behavior** on every existing surface: imports resolve identity exactly as pre-T-438 (the NoOp matcher path — the `EntityMatcher` seam returns "no match" and the legacy exact-match runs unchanged), no ER reads or writes occur anywhere, and performance is unchanged (INV-40 — pinned by test).
4. **No parallel systems.** The ER state persists through the EXISTING repository duality (mock store / one additive migration) and rides the EXISTING backup snapshot + restore path (never a second backup system); the merged data is written ONLY through the canonical repositories/RPCs (never a second financial path) (INV-57).
5. **Backup/restore integrity:** a backup taken after aggregation restores the complete aggregation state (observations, edges, proposals, events, provenance); a backup taken BEFORE aggregation restores to that prior state with ZERO residue (no orphaned mappings, no leftover aggregation rows) (INV-58 — pinned by the round-trip suite).

## 10. Invariants index

| ID | Invariant |
|---|---|
| INV-40 | Flag OFF ⇒ the import path is byte-identical to pre-T-438; zero ER reads/writes |
| INV-41 | Ambiguity resolves toward SEPARATION (a false merge costs more than a false non-match) |
| INV-42 | Normalization is deterministic and idempotent |
| INV-43 | Phone fields are SETS of atomic contact points; placeholders never act as evidence |
| INV-44 | Saturated blocking keys are skipped, never fatal |
| INV-45 | The legacy exact-match resolution remains the fallback for every unbound observation |
| INV-46 | The sibling guardrail vetoes (shared phone + low first-name similarity + ≥ 2 grade-rank divergence) |
| INV-47 | Name comparison is asymmetric-coverage-based (abbreviations never penalized as mismatches) |
| INV-48 | Context (grade/transport) is supporting evidence only — never a sole merge basis |
| INV-49 | The evidence weights are domain constants documented in this file; changes re-run the suite |
| INV-50 | NOTHING is merged without explicit human confirmation — every band, every source |
| INV-51 | Every proposal carries its full evidence vector (score provenance) |
| INV-52 | Clusters of ≥ 3 require density ≥ 0.75; bridges are cut, never transitively merged |
| INV-53 | Every synthesized field records source + survivorship rule + timestamp |
| INV-54 | Ledger rows are re-pointed, never rewritten; unmerge restores the exact prior mapping |
| INV-55 | Unchanged observations re-analyze as no-ops (hash short-circuit) |
| INV-56 | The experimental flag is per-desktop-local, OFF by default |
| INV-57 | No parallel backup/sync/restore or financial write path |
| INV-58 | Backup-before-aggregation restores with zero aggregation residue |
