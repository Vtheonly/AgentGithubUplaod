# REF — The Foundation

> **One-line role**: A static lookup table that defines the controlled vocabulary (parent names, class codes, towns) used by every other sheet.

## At a glance

| Property | Value |
|---|---|
| Position in workbook | 4th (last) tab |
| Size | 224 rows × 4 columns |
| Formulas | 0 (pure data) |
| Data validations | 0 |
| Conditional formatting | 0 |
| Merged cells | 0 |
| Frozen panes | None |
| Hidden | No |
| Sheet protection | Off |

## What each column holds

### Column A — Parent / Tutor family names

The named range `CLIENT` points to `REF!$A:$A`. It contains **8 family names** (rows 1–8):

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

>  This list is **far shorter** than the actual number of families in the school (the ETAT sheet tracks 390 students across hundreds of distinct parent names). It looks like a leftover from a much earlier version of the workbook — possibly the seed list used to demonstrate the dropdown concept. It is not actively maintained.

### Column B — Class level codes

The named range `NIVEAU` points to `REF!$B:$B`. It contains **26 class codes** (rows 1–26):

```
MS, GS, PS, TPS, CP, CE1, CE2, CM1, CM2,
1AP, 2AP, 3AP, 4AP, 5AP,
1AAM, 2AAM, 3AAM, 4AAM,
1AS, 2AS, 3AS,
1CS, 2CS, 3CS, 4CS,
autiste
```

These represent every possible class the school offers, from pre-school (MS/GS/PS/TPS) through primary (CP–CM2), middle school (1AP–5AP, 1AAM–4AAM, 1AS–3AS), high school (1CS–4CS), and a special-needs class (autiste).

See [[Class Codes (CLASSE)]] for what each code means.

### Column C — empty

Column C is entirely empty. It may have been intended for an additional attribute (perhaps "tuition tier" or "section") but was never used.

### Column D — Town / Transport destinations

Contains **20 town names** (rows 1–20), representing the geographic area the school's transport service covers:

```
BOUMERDES, CORSO, SAHEL, FIGUIER, ZEMOURI, BOUDOUAOU, REGHIAA, ROUIBA,
BORDJ MNAIL, SI MUSTAPHA, ISSER, THENIA, BENI AMRANE, OULED MOUSSA,
OULED HEDDAJ /HOUCHE MEKHEFI, KHEMIS KHENCHELA, TIDJELABINE, BENYOUNES,
SOUK ELHAD, CAP DJENET
```

All of these are towns in or near **Boumerdès Province** in northern Algeria, which confirms the school's location. See [[Town List (DISTINATION)]].

## Named ranges that point here

| Name | Refers to | Status | Used by |
|---|---|---|---|
| `CLIENT` | `REF!$A:$A` |  Working | (nothing actively — BON was supposed to use it but uses `parent` instead, which is broken) |
| `NIVEAU` | `REF!$B:$B` |  Working | (nothing actively — should be used by Devis and ETAT dropdowns, but they reference other broken names) |

Both named ranges cover **whole columns** (`$A:$A` rather than `$A$1:$A$8`), which means any dropdown using them would include the empty cells below the data. This is a minor design flaw: it would be cleaner to use a bounded range like `$A$1:$A$50` or an Excel Table.

## How REF connects to the rest of the workbook

```
REF!A:A  ──(named range CLIENT)──►  (should feed) ──►  BON!F8 dropdown   broken
REF!B:B  ──(named range NIVEAU)──►  (should feed) ──►  Devis!D15:D24 dropdown (and all blocks)   broken
                                                              ETAT!H dropdown   doesn't exist
REF!D:D  ──(no named range)──────►  (should feed) ──►  Devis!G15:G24 dropdown   broken
                                                              ETAT!V dropdown   doesn't exist
```

In practice, **no formula or data validation in the workbook actually reads from REF**. The two named ranges (`CLIENT`, `NIVEAU`) are defined but unused. The operators type class codes and town names by hand into ETAT, and the Devis dropdowns reference five other named ranges (`CLASSE`, `FI`, `FRAISSCOLAIRE`, `SERVICE`, `transport`) that don't exist at all — see [[Missing Devis Dropdowns]].

So today, REF is effectively a **dormant** sheet: it stores useful reference data, but nothing in the workbook actively consumes it. The design intent was clearly to use it for dropdown validation; the implementation just isn't wired up.

## What REF is missing

Looking at what the Devis dropdowns want, REF should ideally also contain:

| Missing list | Used by | Should hold |
|---|---|---|
| `CLASSE` | Devis column D | Same as NIVEAU essentially — class codes |
| `FI` (registration fee tiers) | Devis column E | The set of valid FI amounts: 18000, 25000, 28000, 30000, 33000 |
| `FRAISSCOLAIRE` (tuition tiers) | Devis column F | The set of valid tuition amounts: 125000, 170000, 180000, 205000, 210000, 220000, 230000, 248000, 250000, 280000, 285000, 320000, etc. |
| `SERVICE` (service types) | Devis column G | Transport, PSY, ORTH, Ratrapage, etc. |
| `transport` (transport amount tiers) | Devis column H | 35000, 43000, 52000, 55000 |
| `TUTEUR` (parent list, full) | ETAT column E | All ~250 distinct parent names, not just 8 |

If you wanted to repair the workbook, the highest-leverage change would be to extend REF with these lists and repoint the broken named ranges at them. See [[Missing Devis Dropdowns]] for the fix.

## Why the sheet is called "REF"

`REF` is short for **Référence** (French) or **Reference** (English). It's the school's "lookup table" sheet — a common pattern in Excel workbooks that need to standardize data entry across multiple sheets.

Some operators might also interpret `REF` as a hint that the sheet is **referenced by** other sheets, but as we've seen, that referencing is currently broken.

---

**See also**:
- [[REF Sheet Full Content]] — the full row-by-row dump
- [[Named Ranges]] — the four workbook-scoped names
- [[Missing Devis Dropdowns]] — why REF is currently dormant
- [[Class Codes (CLASSE)]] — what every code in column B means
- [[Town List (DISTINATION)]] — the 20 towns in column D
