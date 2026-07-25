# ETAT Columns — Services (Z–AE)

The fourth block of columns on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds **optional special services** — psychology sessions, speech therapy, e-plant sessions, and catch-up classes. These are billable services the school provides on top of the standard tuition.

| Column | Letter | Header | Likely meaning |
|---|---|---|---|
| 26 | Z | `PSY1` | Psychology session 1 — first session with the school psychologist |
| 27 | AA | `PSY2` | Psychology session 2 — follow-up session |
| 28 | AB | `ORTH1` | Orthophonie session 1 — first speech-therapy session |
| 29 | AC | `ORTH2` | Orthophonie session 2 — follow-up speech-therapy session |
| 30 | AD | `E-PLANT` | (unclear — possibly "Élan Plante" or "Éducation Plantaire" or a planning tool) |
| 31 | AE | `Ratrapage` | Rattrapage — catch-up / makeup classes for falling-behind students |

## What these columns are for

These six columns billable services that are **not part of the standard tuition package**. A family opts into them on an as-needed basis — for example, a student struggling in French might be enrolled in ORTH sessions, or a student with emotional difficulties might see the psychologist.

Each column holds a **payment amount** — what the family paid for that service. There's no enrollment flag elsewhere in the sheet; the presence of an amount in Z/AA/AB/AC/AD/AE implicitly means the student received that service.

## What the abbreviations mean

### PSY1 / PSY2 — Psychology

`PSY` is short for **Psychologue** (French for psychologist). The school appears to have a visiting or staff psychologist who provides one-on-one sessions to students.

- **PSY1**: first session of the year
- **PSY2**: follow-up session (or sessions) later in the year

The amount is per-session, billed to the family.

### ORTH1 / ORTH2 — Orthophonie (speech therapy)

`ORTH` is short for **Orthophonie** — the French term for speech-language therapy / speech therapy. An **orthophoniste** is a speech therapist.

- **ORTH1**: first session
- **ORTH2**: follow-up session

As with PSY, the amount is per-session.

### E-PLANT — unclear

This header is ambiguous. Possible interpretations:
- **Élan Plante** — possibly a specific educational program name
- **Éducation Plantaire** — reflexology / foot-therapy sessions (unlikely in a school context)
- **E-Planning** — an online scheduling or planning service
- **Évaluation Pédagogique** — a pedagogical assessment, abbreviated oddly

Without more context from the school, this column's meaning is uncertain. It does contain numeric values in some rows, so it's billable.

### Ratrapage — catch-up classes

`Ratrapage` is a misspelling of **Rattrapage** — French for "catching up" or "making up". In a school context, this means **remedial classes** — extra sessions for students who are falling behind in a subject.

The amount is per-session or per-term, billed to the family.

## How these columns are used

### Currently: informational only

In the current file, the special-service columns are **not used by any formula**. The P formula only sums R + S + T + U + W + X + Y (tuition + transport installments), not Z–AE.

This means:
- If a family pays for a PSY session, the payment is recorded in column Z.
- But that payment **does not reduce the balance owed** in column Q.
- The Q formula `=L-P` doesn't see Z at all.

So the special-service amounts are **stored for billing records but excluded from the running balance**. This is a deliberate design choice: the L (DEVIS ANNUEL) formula only includes the standard fee components, so the special services are tracked as extras outside the main receivable.

### In the Devis sheet

On the Devis sheet, services are listed in column G (with the amount in column H) and are included in the row total `=+SUM(A15:H15)`. So at quote time, services are part of the total — but on the ledger, they're tracked separately.

This creates a small inconsistency: a family's Devis total may include a 30,000 PSY session, but their ETAT L formula probably doesn't. So the L column underestimates what they were originally quoted, and Q underestimates what they still owe.

### How it should work (intent)

The cleanest design would be:
- L (DEVIS ANNUEL) includes the standard fee components + any optional services agreed at enrollment.
- P (TOTAL VERSEMENTS) includes payments toward both standard fees and optional services.
- Q (BALANCE) = L − P captures everything.

In the current file, this isn't implemented — services are tracked but excluded from L, P, and Q.

## Sample values

From the actual file, here's the distribution of populated cells in Z–AE across the 390 students:

| Column | Populated cells | Typical amount |
|---|---|---|
| Z (PSY1) | ~10 | 2,000–5,000 DZD |
| AA (PSY2) | ~5 | 2,000–5,000 DZD |
| AB (ORTH1) | ~15 | 3,000–8,000 DZD |
| AC (ORTH2) | ~8 | 3,000–8,000 DZD |
| AD (E-PLANT) | ~5 | unclear |
| AE (Ratrapage) | ~12 | 5,000–15,000 DZD |

(Approximate counts from spot-checking the data; not exhaustively verified.)

These services are clearly used by a minority of students — most rows have all six columns empty.

## Where each value comes from

| Column | Source | How it's entered |
|---|---|---|
| Z (PSY1) | Cash / check payment for a psychology session | Operator types the amount after the session |
| AA (PSY2) | Same | Same |
| AB (ORTH1) | Cash / check payment for a speech-therapy session | Same |
| AC (ORTH2) | Same | Same |
| AD (E-PLANT) | Cash / check payment for whatever E-PLANT is | Same |
| AE (Ratrapage) | Cash / check payment for catch-up classes | Same |

## Where each value goes next

| Column | Used by | How |
|---|---|---|
| Z (PSY1) | nowhere in a formula | Informational only |
| AA (PSY2) | nowhere | Informational only |
| AB (ORTH1) | nowhere | Informational only |
| AC (ORTH2) | nowhere | Informational only |
| AD (E-PLANT) | nowhere | Informational only |
| AE (Ratrapage) | nowhere | Informational only |

## Why the headers are inconsistent (case + spelling)

Notice:
- `PSY1`, `PSY2`, `ORTH1`, `ORTH2` — uppercase with digit
- `E-PLANT` — uppercase with hyphen
- `Ratrapage` — mixed case, no abbreviation, misspelled (should be `Rattrapage`)

The first four look like systematic abbreviations (probably chosen by the operator). `E-PLANT` looks like a brand name or program name. `Ratrapage` looks like a typo that stuck — the operator typed it once, it propagated, and nobody fixed it.

## Recommendations

If you were cleaning up the workbook, you'd want to:

1. **Decide whether services should be in L** — if yes, update the L formula to include Z+AA+AB+AC+AD+AE; if no, document this clearly.
2. **Decide whether services should be in P** — same decision.
3. **Fix the spelling** of `Ratrapage` → `Rattrapage`.
4. **Clarify what `E-PLANT` means** — ask the school.
5. **Add a dropdown** for each service column so the operator can only enter valid service amounts (e.g., PSY1 must be one of {2000, 3000, 5000}).

These are recommendations, not requirements — the current setup works as long as the operator understands that special-service payments don't affect the main balance.

---

**See also**:
- [[ETAT Columns - Identity (B-K)]]
- [[ETAT Columns - Quote and Balance (L-Q)]]
- [[ETAT Columns - Installments (R-Y)]]
- [[ETAT Columns - Term Tracking (AF-AL)]]
- [[P - TOTAL VERSEMENTS Formula]] — note that P does NOT include Z–AE
- [[French Terms Glossary]]
