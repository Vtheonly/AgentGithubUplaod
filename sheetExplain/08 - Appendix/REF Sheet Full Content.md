# REF Sheet Full Content

The complete row-by-row dump of the [[REF - The Foundation|REF sheet]]. Use this as a reference when adding new parents, class codes, or towns.

## Column A — Parent/tutor family names (named range `CLIENT`)

| Row | Value |
|---|---|
| 1 | MERDAS SAMIR |
| 2 | TALAOOURAR YOUNES |
| 3 | BELRECHID |
| 4 | HARBI |
| 5 | MOULFI |
| 6 | HAMADACHE |
| 7 | HASSAIN |
| 8 | SLIMANI |
| 9–224 | (empty) |

>  This list is incomplete — it has only 8 parents, but the ETAT sheet has hundreds of distinct parent names in column E. REF!A:A is not actively maintained.

## Column B — Class level codes (named range `NIVEAU`)

| Row | Value | Category |
|---|---|---|
| 1 | MS | Pre-school (Moyenne Section) |
| 2 | GS | Pre-school (Grande Section) |
| 3 | PS | Pre-school (Petite Section) |
| 4 | TPS | Pre-school (Très Petite Section) |
| 5 | CP | Primary (Cours Préparatoire) |
| 6 | CE1 | Primary (Cours Élémentaire 1) |
| 7 | CE2 | Primary (Cours Élémentaire 2) |
| 8 | CM1 | Primary (Cours Moyen 1) |
| 9 | CM2 | Primary (Cours Moyen 2) |
| 10 | 1AP | Middle school (variant) |
| 11 | 2AP | Middle school (variant) |
| 12 | 3AP | Middle school (variant) |
| 13 | 4AP | Middle school (variant) |
| 14 | 5AP | Middle school (variant) |
| 15 | 1AAM | Middle school (1ère Année Moyenne) |
| 16 | 2AAM | Middle school |
| 17 | 3AAM | Middle school |
| 18 | 4AAM | Middle school |
| 19 | 1AS | High school (1ère Année Secondaire) |
| 20 | 2AS | High school |
| 21 | 3AS | High school |
| 22 | 1CS | High school (variant — "Cours Secondaire"?) |
| 23 | 2CS | High school (variant) |
| 24 | 3CS | High school (variant) |
| 25 | 4CS | High school (variant) |
| 26 | autiste | Special needs |
| 27–224 | (empty) |

## Column C — empty

Column C is entirely empty across all 224 rows. Possibly intended for an additional attribute that was never used.

## Column D — Town names (no named range)

| Row | Value | Notes |
|---|---|---|
| 1 | BOUMERDES | School's home town |
| 2 | CORSO | Coastal town east of Boumerdès |
| 3 | SAHEL | Hillside area |
| 4 | FIGUIER | Neighborhood ("fig tree") |
| 5 | ZEMOURI | Coastal town ~20 km east |
| 6 | BOUDOUAOU | Town ~25 km southwest |
| 7 | REGHIAA | (Reghaia) ~30 km southwest |
| 8 | ROUIBA | District ~30 km south |
| 9 | BORDJ MNAIL | (Bordj Ménaïl) ~40 km east |
| 10 | SI MUSTAPHA | ~35 km east |
| 11 | ISSER | ~50 km east |
| 12 | THENIA | (Thénia) ~20 km west |
| 13 | BENI AMRANE | ~30 km south, inland |
| 14 | OULED MOUSSA | ~25 km south |
| 15 | OULED HEDDAJ /HOUCHE MEKHEFI | Two adjacent areas combined |
| 16 | KHEMIS KHENCHELA | (Khemis el-Khechna) ~20 km south |
| 17 | TIDJELABINE | ~25 km southwest |
| 18 | BENYOUNES | Neighborhood in Boumerdès |
| 19 | SOUK ELHAD | ~30 km east |
| 20 | CAP DJENET | Coastal town ~25 km east |
| 21–224 | (empty) | |

## All non-empty cells in one table

For quick reference, here are all the non-empty cells in REF:

```
A1: MERDAS SAMIR          B1: MS          D1: BOUMERDES
A2: TALAOOURAR YOUNES     B2: GS          D2: CORSO
A3: BELRECHID             B3: 1AP         D3: SAHEL
A4: HARBI                 B4: CP          D4: FIGUIER
A5: MOULFI                B5: 2AP         D5: ZEMOURI
A6: HAMADACHE             B6: CE1         D6: BOUDOUAOU
A7: HASSAIN               B7: 3AP         D7: REGHIAA
A8: SLIMANI               B8: CE2         D8: ROUIBA
                         B9: 4AP          D9: BORDJ MNAIL
                         B10: CM1         D10: SI MUSTAPHA
                         B11: 5AP         D11: ISSER
                         B12: CM2         D12: THENIA
                         B13: 1AAM        D13: BENI AMRANE
                         B14: 2AAM        D14: OULED MOUSSA
                         B15: 3AAM        D15: OULED HEDDAJ /HOUCHE MEKHEFI
                         B16: 4AAM        D16: KHEMIS KHENCHELA
                         B17: 1AS         D17: TIDJELABINE
                         B18: 2AS         D18: BENYOUNES
                         B19: 3AS         D19: SOUK ELHAD
                         B20: 1cs         D20: CAP DJENET
                         B21: 2cs
                         B22: 3cs
                         B23: 4cs
                         B24: autiste
                         B25: PS
                         B26: TPS
```

## What's missing from REF

Based on what the workbook's dropdowns need, REF should also contain:

| Missing list | Used by | Suggested contents |
|---|---|---|
| `CLASSE` (named range) | Devis column D dropdown | Same as column B (class codes) — just point `CLASSE` at `REF!$B$1:$B$26` |
| `FI` (named range) | Devis column E dropdown | 18000, 25000, 28000, 30000, 33000 |
| `FRAISSCOLAIRE` (named range) | Devis column F dropdown | 125000, 165000, 170000, 180000, 185000, 205000, 210000, 220000, 230000, 248000, 250000, 280000, 285000, 305000, 320000, 330000, 340000, 355000, 365000 |
| `SERVICE` (named range) | Devis column G dropdown | Transport, PSY, ORTH, Ratrapage, E-PLANT |
| `transport` (named range) | Devis column H dropdown | 35000, 43000, 52000, 55000 |
| `TUTEUR` (named range, broken) | (was) ETAT column E dropdown | All distinct parent names from ETAT!E:E |
| `parent` (named range, broken) | BON!F8 dropdown | Same as TUTEUR (unique parent names) |
| Level codes (broad) | ETAT column G dropdown (missing) | PRIM, COLG, LYC, GS, MS, AUTISTE |
| Option codes | ETAT column I dropdown (missing) | TRNSP, (empty) |

See [[Missing Devis Dropdowns]] for the full repair procedure.

## Notes on case sensitivity

Notice that some class codes are uppercase (`MS`, `GS`, `CP`, `CE1`, `CM1`, `CM2`) while others are lowercase (`1cs`, `2cs`, `3cs`, `4cs`, `autiste`). This inconsistency is in the original data — the operator typed them with different cases.

If you're adding a dropdown that uses these codes, you may want to standardize the case first. Uppercase is the most common convention.

## See also

- [[REF - The Foundation]] — the sheet overview
- [[Named Ranges]] — the named ranges that point here
- [[Class Codes (CLASSE)]] — what each code means
- [[Town List (DISTINATION)]] — the town list with transport tiers
- [[Missing Devis Dropdowns]] — what's missing and how to add it
