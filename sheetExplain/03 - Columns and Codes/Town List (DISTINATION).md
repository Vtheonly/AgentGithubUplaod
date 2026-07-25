# Town List (DISTINATION)

Column V (`DISTINATION`) on [[ETAT 20262027 - The Master Ledger|ETAT 20262027]] holds the **transport destination town** — the town where the student is picked up or dropped off. It's only filled in when column I (OPTION) = `TRNSP`.

> The header is misspelled: `DISTINATION` should be **DESTINATION** (French: *destination*). The misspelling has propagated through the workbook and is now the canonical header.

## The 20 canonical towns (from REF!D1:D20)

These are the town names the school officially recognizes, stored in column D of the [[REF - The Foundation|REF sheet]]:

| # | Town | Notes |
|---|---|---|
| 1 | BOUMERDES | The school's home town — provincial capital |
| 2 | CORSO | Coastal town just east of Boumerdès |
| 3 | SAHEL | Hillside area near Boumerdès |
| 4 | FIGUIER | Neighborhood near Boumerdès (literally "fig tree") |
| 5 | ZEMOURI | Coastal town ~20 km east |
| 6 | BOUDOUAOU | Town ~25 km southwest of Boumerdès |
| 7 | REGHIAA | (Reghaia) — town ~30 km southwest, near Rouiba |
| 8 | ROUIBA | District ~30 km south of Boumerdès |
| 9 | BORDJ MNAIL | (Bordj Ménaïl) — town ~40 km east |
| 10 | SI MUSTAPHA | Town ~35 km east |
| 11 | ISSER | Town ~50 km east |
| 12 | THENIA | (Thénia) — town ~20 km west |
| 13 | BENI AMRANE | Town ~30 km south, inland |
| 14 | OULED MOUSSA | Town ~25 km south |
| 15 | OULED HEDDAJ /HOUCHE MEKHEFI | Two adjacent areas combined |
| 16 | KHEMIS KHENCHELA | (Khemis el-Khechna) — town ~20 km south |
| 17 | TIDJELABINE | Town ~25 km southwest |
| 18 | BENYOUNES | Neighborhood in Boumerdès |
| 19 | SOUK ELHAD | Town ~30 km east |
| 20 | CAP DJENET | Coastal town ~25 km east |

All 20 are in or near **Boumerdès Province** in northern Algeria, confirming the school's location.

## How the town drives the transport fee

The transport fee component in column L is determined by the town's distance from the school. Based on the actual L formulas in the file:

| Transport amount (DZD) | Towns (canonical) |
|---|---|
| 35,000 | BOUMERDES, CORSO, SAHEL, FIGUIER, BENYOUNES (nearby) |
| 43,000 | (rarely used — possibly ZEMOURI, THENIA) |
| 52,000 | BOUDOUAOU, OULED MOUSSA, KHEMIS KHENCHELA, TIDJELABINE (medium distance) |
| 55,000 | DJENAT (Cap Djenet), BORDJ MNAIL, ISSER, SI MUSTAPHA, REGHIAA, ROUIBA (far) |

Note: 43,000 appears frequently on the Devis sheet but rarely on the ETAT sheet — the operator may have switched to a 4-tier system (35K / 43K / 52K / 55K) at quote time but consolidated to 3 tiers (35K / 52K / 55K) when entering into the ledger.

## Inconsistent spellings in column V

Because there's no working dropdown, operators type town names by hand, leading to many spelling variations of the same town. Here are some examples from the actual data:

| Canonical (REF) | Variants found in column V |
|---|---|
| BOUMERDES | BOUMERDES, BOUMERDES20000, BOUMREDES, BOUMRDES, BOUMREDES |
| BOUDOUAOU | BOUDOUAOU |
| OULED MOUSSA | OULEDMOUSSA, OULED MOUSSA, OULEDMOUSA |
| OULED HEDDAJ | OULEDHEDADJ, OULEDHDADADJ, OULEDHADADJ, OULEDHEDADJ |
| KHEMIS KHENCHELA | KHEMIS KHCHNA, KHEMISKHCHNA, KHEMISELKHCHNA, KHEMIS KHECHNA |
| ZEMOURI | ZEMMOURI, ZEMOURI |
| BORDJ MNAIL | BORDJMNAIL |
| REghaia | REGHAIA |
| DJENAT | DJENAT |
| THENIA | THENIA |

The variants are mostly:
- Removing spaces (`BOUMERDES` vs `BOUMERDES 20000`)
- Phonetic spelling (`KHEMIS KHENCHELA` vs `KHEMIS KHCHNA`)
- Adding a postal code (`BOUMERDES20000` — 20000 is Boumerdès's postal code)
- Lowercase vs uppercase
- Trailing spaces

This inconsistency means you can't reliably group students by town — a filter for `BOUMERDES` won't catch `BOUMERDES20000` or `BOUMREDES`. If the school wanted to analyze "how many students come from each town?", they'd first need to normalize the spellings.

## The 30 distinct town strings in column V

The actual unique values found in column V of the 2026/2027 file (with student counts):

| Town string (as typed) | Count |
|---|---|
| BOUMERDES | 35 |
| CORSO | 17 |
| BOUDOUAOU | 16 |
| OULEDMOUSSA | 12 |
| THENIA | 6 |
| BORDJMNAIL | 5 |
| REGHAIA | 5 |
| ZEMMOURI | 4 |
| SAHEL | 4 |
| ZEMOURI | 4 |
| OULEDHEDADJ | 3 |
| CHABET | 3 |
| DJENAT | 2 |
| OULED MOUSSA | 2 |
| BOUMRDES | 2 |
| CHABAT | 1 |
| KHEMISELKHCHNA | 1 |
| KHEMIS KHECHNA | 1 |
| ISSER | 1 |
| BENIAMRAN | 1 |
| BOUMERDES20000 | 1 |
| ERBATACHE | 1 |
| LAGATA | 1 |
| OULEDHDADADJ | 1 |
| OULEDHADADJ | 1 |
| OULEDMOUSA | 1 |
| TIDJELABINE | 1 |
| KHEMISKHCHNA | 1 |
| FIGUIER | 1 |
| (others) | — |

Note that some towns in column V aren't in REF!D:D at all:
- **CHABET** / **CHABAT** — possibly Chabet Ameur, a neighborhood
- **ERBATACHE** — possibly "Arba Ta Achra" (literally "Wednesday 10" — a market town)
- **LAGATA** — unclear
- **BENIAMRAN** — variant of BENI AMRANE

The operators are inventing new town codes as the school expands to serve new areas.

## Where the town value comes from

The operator types the town name by hand based on the family's address on their registration form. There's no dropdown — column V has no data validation. This is what causes the spelling inconsistency.

## Where the town value goes next

| Used by | How |
|---|---|
| The L formula | Operator chooses the transport tier (35K / 43K / 52K / 55K) based on the town |
| Nowhere else | No formula reads V |

Like the level and class codes, the town is **informational** — it doesn't drive any automatic calculation, only the operator's manual choice of transport amount.

## Recommendations

- Add a dropdown to column V that pulls from `REF!$D$1:$D$30` (or extend REF with new towns as needed).
- Standardize the spellings — pick one canonical form for each town.
- Consider adding a `Transport_Tier` column that auto-looks-up the fee tier from the town (using VLOOKUP against REF).
- Normalize existing data — replace `BOUMERDES20000` → `BOUMERDES`, `OULEDMOUSSA` → `OULED MOUSSA`, etc.

## Why this column matters for the school

Even though column V doesn't drive any formula directly, it's still important because it determines the transport fee component of L. Without accurate town data:

- The operator might choose the wrong transport tier when typing L.
- The school can't analyze "which towns generate the most students?" for marketing/routing.
- The school can't verify that transport fees cover the cost of bus service to each town.

Fixing the town data would unlock a lot of management insight that's currently hidden by the spelling chaos.

---

**See also**:
- [[ETAT Columns - Installments (R-Y)]] — where column V sits
- [[L - DEVIS ANNUEL Formula]] — how V drives the transport component of L
- [[Price Table]] — transport fee tiers
- [[REF - The Foundation]] — where the canonical town list lives
- [[French Terms Glossary]]
