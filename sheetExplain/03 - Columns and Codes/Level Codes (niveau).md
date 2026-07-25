# Level Codes (niveau)

Column G (`niveau`) on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] classifies each student by **broad school level**. The values are short codes derived from French educational terminology.

> The header is lowercase `niveau` (not `NIVEAU`) — that's just the operator's typing style. The named range `NIVEAU` (uppercase) points to `REF!$B:$B` and contains class-level codes, not these broad-level codes — confusingly, the same word is used for two related but different concepts.

## The codes used in column G

| Code | Full French term | English meaning | Frequency in 2026/2027 |
|---|---|---|---|
| `PRIM` | Primaire | Primary school (ages 6–10) | 204 |
| `COLG` | Collège | Middle school (ages 11–15) | 113 |
| `LYC` | Lycée | High school (ages 16–18) | 40 |
| `GS` | Grande Section | Senior pre-school (age 5) | 21 |
| `MS` | Moyenne Section | Middle pre-school (age 4) | 4 |
| `AUTISTE` | Autiste | Special-needs class (autism spectrum) | 2 |
| `NV2` | Niveau 2 | "Level 2" — possibly a non-standard placement | 1 |
| `NV3` | Niveau 3 | "Level 3" | 1 |
| `NV4` | Niveau 4 | "Level 4" | 2 |
| `NV5` | Niveau 5 | "Level 5" | 1 |
| `CLYC` | (unclear — possibly "Collège/Lycée") | Mixed or transitional class | 1 |
| `LYCI` | (unclear — possibly "Lycée Integration") | Lycée with integration support | 1 |
| **Total** | | | **390** |

## What each level means in the Algerian school system

Algeria follows a French-influenced educational structure:

### Pre-school (optional)

- **MS** (Moyenne Section) — age 3–4. Optional pre-school.
- **GS** (Grande Section) — age 5. Optional pre-school, the year before primary.

The school also has the codes **PS** (Petite Section, age 2–3) and **TPS** (Très Petite Section, age 2) defined in `REF!B:B` but doesn't appear to have any students at those levels in 2026/2027.

### Primary school (PRIM, ages 6–10)

Five years: CP, CE1, CE2, CM1, CM2. See [[Class Codes (CLASSE)]].

### Middle school / Collège (COLG, ages 11–15)

Four years: 1AM, 2AM, 3AM, 4AM (in Arabic: السنة الأولى متوسط etc.). The school uses codes like `1AAM`, `2AAM`, `3AAM`, `4AAM` — see [[Class Codes (CLASSE)]] for the explanation of the double-A.

### High school / Lycée (LYC, ages 16–18)

Three years: 1AS, 2AS, 3AS (in Arabic: السنة الأولى ثانوي etc.). The school uses codes like `1AS`, `2AS`, `3AS`.

### Other codes

- **AUTISTE** — A special-needs class for students on the autism spectrum. The school appears to have a small inclusive program (2 students in 2026/2027).
- **NV2–NV5** — "Niveau" (Level) 2 through 5. These are non-standard codes that may indicate:
  - A student who is repeating a year (held back)
  - A student in a multi-age classroom
  - A non-gradeable placement (e.g., a transfer student whose level is being assessed)
- **CLYC** — Possibly a transitional class between collège and lycée.
- **LYCI** — Possibly a lycée integration class (for students with special needs mainstreamed into lycée).

## How the level drives pricing

The level code in column G is one of the factors the operator uses to choose the formula in column L:

| Level | Registration fee (FI) | Typical tuition |
|---|---|---|
| MS / GS (pre-school) | 18,000 | 125,000 |
| PRIM (primary) | 25,000 | 205,000–220,000 |
| COLG (collège) | 25,000 or 30,000 | 305,000–330,000 |
| LYC (lycée) | 30,000 | 340,000–365,000 |

So a PRIM student typically has `L = 25000+205000+...` while a COLG student has `L = 25000+305000+...` and a LYC student has `L = 30000+340000+...`. The level code doesn't drive a lookup — it just informs the operator's manual choice of L formula.

See [[L - DEVIS ANNUEL Formula]] and [[Price Table]] for the full pricing structure.

## The naming convention

The codes follow a pattern:
- **Pre-school**: French acronym (MS, GS, PS, TPS)
- **Primary**: French acronym (CP, CE1, CE2, CM1, CM2)
- **Middle school (collège)**: French + Arabic mix (1AAM, 2AAM, etc.)
- **High school (lycée)**: French + Arabic mix (1AS, 2AS, 3AS)

The "A" in `1AAM` is the French *année* (year). The "AM" is Arabic *أوسط متوسط* (awwasṭ mutawassiṭ) meaning "middle year" — so `1AAM` = "Year 1 Middle". Similarly, "AS" is Arabic *ثانوي* (thanawī) meaning "secondary" — so `1AS` = "Year 1 Secondary".

## How this differs from REF!B:B

The named range `NIVEAU` (which points to `REF!$B:$B`) actually contains the **class codes** (CP, CE1, CM2, 1AAM, etc.), not the broad-level codes (PRIM, COLG, LYC). This is a naming inconsistency:

- Column G on ETAT is called `niveau` but holds broad-level codes (PRIM, COLG, etc.).
- The named range `NIVEAU` points to class-specific codes (CP, CE1, 1AAM).
- Column H on ETAT is called `CLASSE` and holds the same class-specific codes as `REF!B:B`.

So `niveau` (the column) and `NIVEAU` (the named range) refer to different things despite the same word. This is a confusion trap if you're trying to wire up dropdowns.

## Where this value comes from

The operator types the level code by hand when enrolling a student. There's no dropdown — column G has no data validation. So spelling and capitalization vary slightly (e.g., `PRIM` vs `Prim` vs `prim`).

## Where this value goes next

| Used by | How |
|---|---|
| The L formula | Operator chooses the L formula components based on G |
| Nowhere else | No formula reads G |

The level code is **informational** — it doesn't drive any automatic calculation, only the operator's manual choice.

## Recommendations

- Add a dropdown to column G with the valid level codes.
- Standardize the spelling (e.g., always uppercase: PRIM, COLG, LYC, GS, MS, AUTISTE).
- Clarify what NV2–NV5 mean (ask the school).
- Consider renaming the `NIVEAU` named range to `CLASSE_CODES` to avoid the confusion with the `niveau` column.

---

**See also**:
- [[Class Codes (CLASSE)]] — the more specific codes in column H
- [[L - DEVIS ANNUEL Formula]] — how G drives the L formula choice
- [[Price Table]] — fees per level
- [[French Terms Glossary]]
- [[REF - The Foundation]] — what the `NIVEAU` named range actually holds
