# Deep Excel Inspection & Reverse-Engineering Report

*Generated on: 2026-09-25 22:36:00 UTC*

This report reverse-engineers the logical schemas, calculations, formulas, and data models of the inspected Excel workbooks.

## 1. Executive Summary
| Workbook File | Sheets | Total Used Rows | Formulas Found | Formula Errors | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **`Suivis clients  2026_2027.xlsx`** | 4 | 634 | 1,513 | 16 | ⚠️ Has Errors |
| **`2027-2026.xlsx`** | 2 | 1,960 | 7,564 | 1,871 | ⚠️ Has Errors |

## 2. Cross-Workbook Schema & Evolution Diff
Comparing **`Suivis clients  2026_2027.xlsx`** ➔ **`2027-2026.xlsx`**:

- **Sheets removed or renamed from WB1**: `Devis, BON , REF`
- **Sheets new in WB2**: `statistiques `
- **Common Sheets Analyzed**: `ETAT 20262027`

### Diff for Sheet: `ETAT 20262027`
- **Archetype**: `FLAT_TABULAR_MASTER` ➔ `FLAT_TABULAR_MASTER`
- **Dimensions**: Rows: `404` ➔ `1289` | Cols: `40` ➔ `47`
- **Runtime Formula Errors**: `1` (WB1) vs `0` (WB2)
- **New Columns in WB2**: `PSY14, PSY13, PSY10, PSY5, PSY7, CLUB, COL_F, COURS SUP, PSY8, CREANCE SEPT, PSY12, PSY9, TT CREANCE, PSY4, PSY3, SORTIES, PSY11, LIVRES, V1, PSY6`
- **Columns Absent in WB2**: `MARS, E-PLANT, DECEMBRE, CREANCES SEPTEMBRE, V2, Ratrapage, CREANCES DECEMBRE, ORTH2, TOTAL, COL_AM, SEPTEMBRE, ORTH1, NOM, CREANCES MARS, #REF!`
- **New Formula Patterns in WB2**:
  - `=355000-J{row}+52000`
  - `=300000+40000-J{row}+55000`
  - `=S{row}+J{row}+N{row}-114000+W{row}-20000`
  - `=S{row}+J{row}+N{row}-117000`
  - `=228000+40000-J{row}`

## 3. Deep Workbook & Worksheet Inspections

---
### Workbook: `Suivis clients  2026_2027.xlsx`
- **Path**: `/home/mersel/Downloads/Excel/Suivis clients  2026_2027.xlsx`
- **Size**: 208.7 KB
- **Defined Named Ranges**: 4
  - `CLIENT, NIVEAU, parent, TUTEUR`

#### Worksheet: `ETAT 20262027`
- **Inferred Archetype**: `FLAT_TABULAR_MASTER` (State: `visible`)
- **Active Boundaries**: `A1:AN404` (404 data rows, 40 columns)
- **Layout Controls**: Freeze Panes: `None` | Merged Cells: 0 | Hidden Rows: 0 | Hidden Cols: 0
- **Cell Breakdown**: Text: 1606 | Numeric: 1295 | Dates: 0 | Formulas: 1422 | Empty: 11837 | **Errors: 1**

> ⚠️ **Excel Calculation Errors in `ETAT 20262027`**:
> - **#REF!**: 1 cells
>   - Location `AN1`: Formula=`None` | Evaluated=`#REF!`

**Column Definitions & Inferred Business Semantics:**
| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `A` | **COL_A** | `GENERIC_DATA` | text | 3 | `PAR MOIS 62600`, `31800 PAR MOIS`, `32800 PAR MOIS` |
| `B` | **INFOS** | `GENERIC_DATA` | text | 1 | `INFOS` |
| `C` | **E-MAIL** | `CONTACT_INFO` | text | 2 | `E-MAIL`, `BON01` |
| `D` | **NEM** | `CONTACT_INFO` | numeric | 253 | `NEM`, `0663701834/0660800317`, `799534750/558498673` |
| `E` | **TUTEUR** | `PARENT_TUTEUR` | text | 2 | `TUTEUR`, `NV` |
| `F` | **NOM** | `STUDENT_IDENTITY` | text | 390 | `NOM`, `ZIREG LEA`, `MERABTI RIHAM` |
| `G` | **niveau** | `ACADEMIC_LEVEL` | text | 12 | `niveau`, `PRIM`, `COLG` |
| `H` | **CLASSE** | `ACADEMIC_LEVEL` | text | 25 | `CLASSE`, `CE1`, `1AAM` |
| `I` | **OPTION** | `ACADEMIC_LEVEL` | text | 4 | `OPTION`, `TRNSP`, `TENSP` |
| `J` | **REMISE** | `FINANCIAL_AMOUNT` | numeric | 98 | `REMISE`, `25500.0`, `5000.0` |
| `K` | **JUSTIFICATION** | `FINANCIAL_AMOUNT` | text | 1 | `JUSTIFICATION` |
| `L` | **DEVIS ANNUEL** | `FINANCIAL_AMOUNT` | numeric | 175 | `DEVIS ANNUEL`, `239500`, `294500` |
| `M` | **REMBOURCEMENT** | `GENERIC_DATA` | text | 1 | `REMBOURCEMENT` |
| `N` | **DETTES** | `FINANCIAL_AMOUNT` | numeric | 3 | `DETTES`, `7000.0`, `8000.0` |
| `O` | **REGLEMENTS DETTES** | `FINANCIAL_AMOUNT` | text | 1 | `REGLEMENTS DETTES` |
| `P` | **TOTAL VERSEMENTS** | `FINANCIAL_AMOUNT` | text | 175 | `TOTAL VERSEMENTS`, `239500`, `294500` |
| `Q` | **TOTAL*CREANCE** | `FINANCIAL_AMOUNT` | text | 147 | `TOTAL*CREANCE`, `0`, `143000` |
| `R` | **FI** | `FINANCIAL_AMOUNT` | numeric | 6 | `FI`, `25000.0`, `30000.0` |
| `S` | **V2** | `FINANCIAL_AMOUNT` | numeric | 180 | `V2`, `71500.0`, `92000` |
| `T` | **2V** | `GENERIC_DATA` | numeric | 39 | `2V`, `71500.0`, `100000.0` |
| `U` | **v3** | `FINANCIAL_AMOUNT` | numeric | 36 | `v3`, `71500.0`, `98000.0` |
| `V` | **DISTINATION** | `TRANSPORT_SERVICE` | text | 30 | `DISTINATION`, `DJENAT`, `BOUDOUAOU` |
| `W` | **1T** | `FINANCIAL_AMOUNT` | numeric | 3 | `1T`, `30000.0`, `20000.0` |
| `X` | **T2** | `FINANCIAL_AMOUNT` | numeric | 7 | `T2`, `15000.0`, `12000.0` |
| `Y` | **t3** | `FINANCIAL_AMOUNT` | numeric | 4 | `t3`, `10000.0`, `12000.0` |
| `Z` | **PSY1** | `GENERIC_DATA` | text | 1 | `PSY1` |
| `AA` | **PSY2** | `GENERIC_DATA` | text | 1 | `PSY2` |
| `AB` | **ORTH1** | `GENERIC_DATA` | text | 1 | `ORTH1` |
| `AC` | **ORTH2** | `GENERIC_DATA` | text | 1 | `ORTH2` |
| `AD` | **E-PLANT** | `GENERIC_DATA` | text | 1 | `E-PLANT` |
| `AE` | **Ratrapage** | `GENERIC_DATA` | text | 1 | `Ratrapage` |
| `AF` | **SEPTEMBRE** | `GENERIC_DATA` | text | 1 | `SEPTEMBRE` |
| `AG` | **CREANCES SEPTEMBRE** | `FINANCIAL_AMOUNT` | text | 1 | `CREANCES SEPTEMBRE` |
| `AH` | **DECEMBRE** | `GENERIC_DATA` | text | 1 | `DECEMBRE` |
| `AI` | **CREANCES DECEMBRE** | `FINANCIAL_AMOUNT` | text | 1 | `CREANCES DECEMBRE` |
| `AJ` | **MARS** | `GENERIC_DATA` | text | 1 | `MARS` |
| `AK` | **CREANCES MARS** | `FINANCIAL_AMOUNT` | text | 1 | `CREANCES MARS` |
| `AL` | **TOTAL** | `FINANCIAL_AMOUNT` | text | 1 | `TOTAL` |
| `AM` | **COL_AM** | `GENERIC_DATA` | text | 1 | `-` |
| `AN` | **#REF!** | `GENERIC_DATA` | text | 1 | `#REF!` |

**Calculated Logic & Formula Templates (Row-Shift Invariant):**
| Target Col | Normalized Formula Template | Span | Rows | Example Formula |
| :---: | :--- | :---: | :---: | :--- |
| `P` | `=R{row}+S{row}+T{row}+U{row}+W{row}+X{row}+Y{row}` | 403 | `2..404` | `=R2+S2+T2+U2+W2+X2+Y2` |
| `Q` | `=L{row}-P{row}` | 403 | `2..404` | `=L2-P2` |
| `L` | `=25000+185000+35000-J{row}` | 26 | `21..224` | `=25000+185000+35000-J21` |
| `L` | `=25000+330000-J{row}` | 16 | `10..241` | `=25000+330000-J10` |
| `L` | `=25000+305000-J{row}` | 15 | `36..213` | `=25000+305000-J36` |
| `L` | `=25000+205000+35000-J{row}` | 13 | `2..217` | `=25000+205000+35000-J2` |
| `L` | `=25000+220000+35000-J{row}` | 13 | `52..222` | `=25000+220000+35000-J52` |
| `L` | `=30000+250000+20000-J{row}` | 11 | `20..231` | `=30000+250000+20000-J20` |
| `L` | `=245000-J{row}` | 10 | `246..383` | `=245000-J246` |
| `L` | `=355000-J{row}` | 10 | `256..384` | `=355000-J256` |
| `L` | `=25000+320000-J{row}` | 9 | `29..357` | `=25000+320000-J29` |
| `L` | `=300000-J{row}` | 9 | `235..385` | `=300000-J235` |
| `L` | `=280000-J{row}` | 9 | `238..373` | `=280000-J238` |
| `L` | `=25000+230000+35000-J{row}` | 8 | `13..216` | `=25000+230000+35000-J13` |
| `L` | `=25000+355000-J{row}` | 8 | `26..337` | `=25000+355000-J26` |


#### Worksheet: `BON `
- **Inferred Archetype**: `REPEATING_DOCUMENT_BLOCKS` (State: `visible`)
- **Active Boundaries**: `A1:I31` (20 data rows, 9 columns)
- **Layout Controls**: Freeze Panes: `None` | Merged Cells: 22 | Hidden Rows: 2 | Hidden Cols: 0
- **Cell Breakdown**: Text: 17 | Numeric: 0 | Dates: 0 | Formulas: 16 | Empty: 246 | **Errors: 15**

> ⚠️ **Excel Calculation Errors in `BON `**:
> - **#REF!**: 15 cells
>   - Location `C10`: Formula=`=+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)` | Evaluated=`#REF!`
>   - Location `H12`: Formula=`=+VLOOKUP(E12,'PAR PARENT'!A4:E785,3,0)` | Evaluated=`#REF!`
>   - Location `I12`: Formula=`=+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)` | Evaluated=`#REF!`

**Cross-Sheet Dependencies:**
- References sheet **`PAR PARENT`** at cells: `A5:K787, A4:K786, A4:E785, A5:E786`
- References sheet **`Etat General Versement`** at cells: `G7:AS1255`

**Column Definitions & Inferred Business Semantics:**
| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `A` | **DEVIS ANNUEL** | `FINANCIAL_AMOUNT` | text | 9 | `Situation Client 2021-2022`, `Etat des versements`, `DEVIS ANNUEL` |
| `B` | **COL_B** | `GENERIC_DATA` | EMPTY | 0 |  |
| `C` | **COL_C** | `GENERIC_DATA` | EMPTY | 1 | `#REF!` |
| `D` | **COL_D** | `GENERIC_DATA` | EMPTY | 0 |  |
| `E` | **ELEVES** | `STUDENT_IDENTITY` | text | 4 | `CLIENT`, `ELEVES`, `ABDELAOUI INES` |
| `F` | **COL_F** | `GENERIC_DATA` | text | 1 | `ABDELAOUI` |
| `G` | **DEVIS** | `FINANCIAL_AMOUNT` | text | 1 | `DEVIS` |
| `H` | **TOTAL VERSE** | `FINANCIAL_AMOUNT` | text | 3 | `DATE`, `TOTAL VERSE`, `#REF!` |
| `I` | **RESTE VERSE** | `GENERIC_DATA` | text | 3 | `2026-07-24 00:00:00`, `RESTE VERSE`, `#REF!` |

**Calculated Logic & Formula Templates (Row-Shift Invariant):**
| Target Col | Normalized Formula Template | Span | Rows | Example Formula |
| :---: | :--- | :---: | :---: | :--- |
| `H` | `=+VLOOKUP(E{row},'PAR PARENT'!A{row-8}:E{row+773},3,0)` | 2 | `12..13` | `=+VLOOKUP(E12,'PAR PARENT'!A4:E785,3,0)` |
| `I` | `=+VLOOKUP(E{row},'PAR PARENT'!A{row-8}:K{row+774},6,0)` | 2 | `12..13` | `=+VLOOKUP(E12,'PAR PARENT'!A4:K786,6,0)` |
| `I` | `=TODAY()` | 1 | `8..8` | `=TODAY()` |
| `C` | `=+VLOOKUP(F{row-2},'PAR PARENT'!A{row-6}:E{row+775},2,0)` | 1 | `10..10` | `=+VLOOKUP(F8,'PAR PARENT'!A4:E785,2,0)` |
| `A` | `=+VLOOKUP(F{row-14},'Etat General Versement'!G{row-15}:AS{row+1233},33,0)` | 1 | `22..22` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,33,0)` |
| `A` | `=+VLOOKUP(F{row-15},'Etat General Versement'!G{row-16}:AS{row+1232},34,0)` | 1 | `23..23` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,34,0)` |
| `A` | `=+VLOOKUP(F{row-16},'Etat General Versement'!G{row-17}:AS{row+1231},35,0)` | 1 | `24..24` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,35,0)` |
| `A` | `=+VLOOKUP(F{row-17},'Etat General Versement'!G{row-18}:AS{row+1230},36,0)` | 1 | `25..25` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,36,0)` |
| `A` | `=+VLOOKUP(F{row-18},'Etat General Versement'!G{row-19}:AS{row+1229},37,0)` | 1 | `26..26` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,37,0)` |
| `A` | `=+VLOOKUP(F{row-19},'Etat General Versement'!G{row-20}:AS{row+1228},38,0)` | 1 | `27..27` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,38,0)` |
| `A` | `=+VLOOKUP(F{row-20},'Etat General Versement'!G{row-21}:AS{row+1227},39,0)` | 1 | `28..28` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,39,0)` |
| `A` | `=+VLOOKUP(F{row-21},'Etat General Versement'!G{row-22}:AS{row+1226},40,0)` | 1 | `29..29` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,40,0)` |
| `A` | `=+VLOOKUP(F{row-22},'Etat General Versement'!G{row-23}:AS{row+1225},41,0)` | 1 | `30..30` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,41,0)` |
| `A` | `=+VLOOKUP(F{row-23},'Etat General Versement'!G{row-24}:AS{row+1224},42,0)` | 1 | `31..31` | `=+VLOOKUP(F8,'Etat General Versement'!G7:AS1255,42,0)` |


#### Worksheet: `Devis`
- **Inferred Archetype**: `REPEATING_DOCUMENT_BLOCKS` (State: `visible`)
- **Active Boundaries**: `A1:M478` (184 data rows, 13 columns)
- **Layout Controls**: Freeze Panes: `None` | Merged Cells: 180 | Hidden Rows: 0 | Hidden Cols: 0
- **Cell Breakdown**: Text: 281 | Numeric: 61 | Dates: 3 | Formulas: 75 | Empty: 5794 | **Errors: 0**

**Column Definitions & Inferred Business Semantics:**
| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `A` | **Prenom élève** | `STUDENT_IDENTITY` | text | 31 | `Client`, `Prenom élève`, `MAHDI` |
| `B` | **COL_B** | `GENERIC_DATA` | text | 10 | `MAHAMED OUSSAID`, `KOUBA`, `DJAOUD` |
| `C` | **COL_C** | `GENERIC_DATA` | EMPTY | 0 |  |
| `D` | **Classe** | `ACADEMIC_LEVEL` | text | 19 | `Classe`, `CM1`, `GS` |
| `E` | **F I** | `FINANCIAL_AMOUNT` | numeric | 12 | `F I`, `28000.0`, `18000.0` |
| `F` | **Frais Scolarisation** | `FINANCIAL_AMOUNT` | text | 17 | `Devis`, `Devis n°`, `Date` |
| `G` | **Services** | `GENERIC_DATA` | text | 9 | `Services`, `Transport`, `Sous-total` |
| `H` | **COL_H** | `GENERIC_DATA` | numeric | 2 | `43000.0`, `35000.0` |
| `I` | **Total** | `FINANCIAL_AMOUNT` | text | 49 | `0101/2021/2022`, `2026-07-24 00:00:00`, `Total` |
| `J` | **COL_J** | `GENERIC_DATA` | EMPTY | 0 |  |
| `K` | **COL_K** | `GENERIC_DATA` | EMPTY | 0 |  |
| `L` | **COL_L** | `GENERIC_DATA` | EMPTY | 0 |  |
| `M` | **COL_M** | `GENERIC_DATA` | EMPTY | 2 | `220000`, `230000` |

**Calculated Logic & Formula Templates (Row-Shift Invariant):**
| Target Col | Normalized Formula Template | Span | Rows | Example Formula |
| :---: | :--- | :---: | :---: | :--- |
| `I` | `=+SUM(A{row}:H{row})` | 23 | `15..450` | `=+SUM(A15:H15)` |
| `I` | `=TODAY()` | 10 | `9..442` | `=TODAY()` |
| `I` | `=+SUM(I{row-12}:I{row-1})` | 10 | `27..460` | `=+SUM(I15:I26)` |
| `I` | `=+I{row-5}-I{row-3}-I{row-2}` | 8 | `128..465` | `=+I123-I125-I126` |
| `D` | `=+SUM(F{row-21}:F{row-10})*0.05` | 6 | `132..374` | `=+SUM(F111:F122)*0.05` |
| `I` | `=+I{row-4}-I{row-2}` | 2 | `31..79` | `=+I27-I29` |
| `D` | `=+SUM(F{row-20}:F{row-9})*0.05` | 2 | `35..83` | `=+SUM(F15:F26)*0.05` |
| `E` | `=18000+80000+12000` | 2 | `329..378` | `=18000+80000+12000` |
| `E` | `=18000+50000+18000+80000+12000-I{row-11}` | 2 | `425..473` | `=18000+50000+18000+80000+12000-I414` |
| `E` | `=18000*2+28000+21000+25000` | 1 | `39..39` | `=18000*2+28000+21000+25000` |
| `E` | `=28000*3+72000+100000+68000-41500` | 1 | `87..87` | `=28000*3+72000+100000+68000-41500` |
| `E` | `=28000*2+100000+82000-I{row-11}` | 1 | `136..136` | `=28000*2+100000+82000-I125` |
| `I` | `=5000+16500` | 1 | `174..174` | `=5000+16500` |
| `E` | `=178000-5000` | 1 | `185..185` | `=178000-5000` |
| `I` | `=14250+10000` | 1 | `222..222` | `=14250+10000` |


#### Worksheet: `REF`
- **Inferred Archetype**: `LOOKUP_REFERENCE_TABLE` (State: `visible`)
- **Active Boundaries**: `A1:D26` (26 data rows, 4 columns)
- **Layout Controls**: Freeze Panes: `None` | Merged Cells: 0 | Hidden Rows: 0 | Hidden Cols: 0
- **Cell Breakdown**: Text: 54 | Numeric: 0 | Dates: 0 | Formulas: 0 | Empty: 50 | **Errors: 0**

**Column Definitions & Inferred Business Semantics:**
| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `A` | **MERDAS  SAMIR** | `GENERIC_DATA` | text | 8 | `MERDAS  SAMIR`, `TALAOOURAR YOUNES`, `BELRECHID` |
| `B` | **MS** | `GENERIC_DATA` | text | 26 | `MS`, `GS`, `1AP` |
| `C` | **COL_C** | `GENERIC_DATA` | EMPTY | 0 |  |
| `D` | **BOUMERDES** | `GENERIC_DATA` | text | 20 | `BOUMERDES`, `CORSO`, `SAHEL` |

---
### Workbook: `2027-2026.xlsx`
- **Path**: `/home/mersel/Downloads/Excel/2027-2026.xlsx`
- **Size**: 545.4 KB
- **Defined Named Ranges**: 4
  - `CLIENT, NIVEAU, parent, TUTEUR`

#### Worksheet: `ETAT 20262027`
- **Inferred Archetype**: `FLAT_TABULAR_MASTER` (State: `visible`)
- **Active Boundaries**: `A1:AU1310` (1289 data rows, 47 columns)
- **Layout Controls**: Freeze Panes: `None` | Merged Cells: 0 | Hidden Rows: 0 | Hidden Cols: 0
- **Cell Breakdown**: Text: 4863 | Numeric: 3656 | Dates: 0 | Formulas: 5264 | Empty: 47787 | **Errors: 0**

**Column Definitions & Inferred Business Semantics:**
| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `A` | **COL_A** | `GENERIC_DATA` | text | 32 | `P LES LIVRES`, `P LES LIVERS`, `PAR MOIS` |
| `B` | **INFOS** | `GENERIC_DATA` | text | 2 | `INFOS`, `` |
| `C` | **E-MAIL** | `CONTACT_INFO` | text | 5 | `E-MAIL`, `BON01`, `P LES LIVERS` |
| `D` | **NEM** | `CONTACT_INFO` | numeric | 729 | `NEM`, `0663701834/0660800317`, `799534750/558498673` |
| `E` | **TUTEUR** | `PARENT_TUTEUR` | text | 3 | `TUTEUR`, `NV`, `nv` |
| `F` | **COL_F** | `GENERIC_DATA` | text | 1135 | `ZIREG LEA`, `MERABTI RIHAM`, `BOUAICHA ACIL` |
| `G` | **niveau** | `ACADEMIC_LEVEL` | text | 20 | `niveau`, `PRIM`, `COLG` |
| `H` | **CLASSE** | `ACADEMIC_LEVEL` | text | 32 | `CLASSE`, `CE1`, `1AAM` |
| `I` | **OPTION** | `ACADEMIC_LEVEL` | text | 13 | `OPTION`, `TRNSP`, `TRNSP 15JOUR` |
| `J` | **REMISE** | `FINANCIAL_AMOUNT` | numeric | 163 | `REMISE`, `25500.0`, `5000.0` |
| `K` | **JUSTIFICATION** | `FINANCIAL_AMOUNT` | text | 1 | `JUSTIFICATION` |
| `L` | **DEVIS ANNUEL** | `FINANCIAL_AMOUNT` | numeric | 288 | `DEVIS ANNUEL`, `239500`, `304500` |
| `M` | **REMBOURCEMENT** | `GENERIC_DATA` | text | 2 | `REMBOURCEMENT`, `14500.0` |
| `N` | **DETTES** | `FINANCIAL_AMOUNT` | numeric | 7 | `DETTES`, `7000.0`, `8000.0` |
| `O` | **REGLEMENTS DETTES** | `FINANCIAL_AMOUNT` | numeric | 4 | `REGLEMENTS DETTES`, `34000.0`, `50000.0` |
| `P` | **TOTAL VERSEMENTS** | `FINANCIAL_AMOUNT` | text | 330 | `TOTAL VERSEMENTS`, `239500`, `304500` |
| `Q` | **TOTAL*CREANCE** | `FINANCIAL_AMOUNT` | text | 247 | `TOTAL*CREANCE`, `0`, `143000` |
| `R` | **FI** | `FINANCIAL_AMOUNT` | text | 2 | `FI`, `25000.0` |
| `S` | **V1** | `FINANCIAL_AMOUNT` | numeric | 243 | `V1`, `80500.0`, `101000.0` |
| `T` | **2V** | `GENERIC_DATA` | numeric | 80 | `2V`, `79500.0`, `16000.0` |
| `U` | **v3** | `FINANCIAL_AMOUNT` | numeric | 72 | `v3`, `79500.0`, `89500.0` |
| `V` | **DISTINATION** | `TRANSPORT_SERVICE` | text | 49 | `DISTINATION`, `DJENAT`, `BOUDOUAOU` |
| `W` | **1T** | `FINANCIAL_AMOUNT` | numeric | 13 | `1T`, `30000.0`, `20000.0` |
| `X` | **T2** | `FINANCIAL_AMOUNT` | numeric | 8 | `T2`, `15000.0`, `12000.0` |
| `Y` | **t3** | `FINANCIAL_AMOUNT` | numeric | 5 | `t3`, `10000.0`, `12000.0` |
| `Z` | **PSY1** | `GENERIC_DATA` | text | 1 | `PSY1` |
| `AA` | **PSY2** | `GENERIC_DATA` | text | 1 | `PSY2` |
| `AB` | **PSY3** | `GENERIC_DATA` | text | 1 | `PSY3` |
| `AC` | **PSY4** | `GENERIC_DATA` | text | 1 | `PSY4` |
| `AD` | **PSY5** | `GENERIC_DATA` | text | 1 | `PSY5` |
| `AE` | **PSY6** | `GENERIC_DATA` | text | 1 | `PSY6` |
| `AF` | **PSY7** | `GENERIC_DATA` | text | 1 | `PSY7` |
| `AG` | **PSY8** | `GENERIC_DATA` | text | 1 | `PSY8` |
| `AH` | **PSY9** | `GENERIC_DATA` | text | 1 | `PSY9` |
| `AI` | **PSY10** | `GENERIC_DATA` | text | 1 | `PSY10` |
| `AJ` | **PSY11** | `GENERIC_DATA` | text | 1 | `PSY11` |
| `AK` | **PSY12** | `GENERIC_DATA` | text | 1 | `PSY12` |
| `AL` | **PSY13** | `GENERIC_DATA` | text | 1 | `PSY13` |
| `AM` | **PSY14** | `GENERIC_DATA` | text | 2 | `PSY14`, `-` |
| `AN` | **CREANCE SEPT** | `FINANCIAL_AMOUNT` | text | 155 | `CREANCE SEPT`, `0`, `-110000` |
| ... | *[7 more columns omitted]* | | | | |

**Calculated Logic & Formula Templates (Row-Shift Invariant):**
| Target Col | Normalized Formula Template | Span | Rows | Example Formula |
| :---: | :--- | :---: | :---: | :--- |
| `P` | `=R{row}+S{row}+T{row}+U{row}+W{row}+X{row}+Y{row}` | 1285 | `2..1287` | `=R2+S2+T2+U2+W2+X2+Y2` |
| `Q` | `=L{row}-P{row}` | 1285 | `2..1287` | `=L2-P2` |
| `AN` | `=S{row}+J{row}+N{row}-0` | 148 | `578..1272` | `=S578+J578+N578-0` |
| `AN` | `=S{row}+J{row}+N{row}-98000` | 76 | `21..1127` | `=S21+J21+N21-98000` |
| `AN` | `=S{row}+J{row}+N{row}-132000` | 66 | `36..1126` | `=S36+J36+N36-132000` |
| `AN` | `=S{row}+J{row}+N{row}-106000` | 64 | `2..1107` | `=S2+J2+N2-106000` |
| `AN` | `=S{row}+J{row}+N{row}-112000` | 60 | `11..1064` | `=S11+J11+N11-112000` |
| `AN` | `=S{row}+J{row}+N{row}-142000` | 54 | `10..1109` | `=S10+J10+N10-142000` |
| `AN` | `=S{row}+J{row}+N{row}-120000` | 53 | `20..1075` | `=S20+J20+N20-120000` |
| `AN` | `=S{row}+J{row}+N{row}-138000` | 53 | `29..1112` | `=S29+J29+N29-138000` |
| `AN` | `=S{row}+J{row}+N{row}-114000` | 52 | `12..1101` | `=S12+J12+N12-114000` |
| `L` | `=265000-J{row}` | 47 | `245..1107` | `=265000-J245` |
| `L` | `=245000-J{row}` | 44 | `246..1127` | `=245000-J246` |
| `L` | `=345000-J{row}` | 40 | `270..1055` | `=345000-J270` |
| `L` | `=300000-J{row}` | 39 | `55..1075` | `=300000-J55` |


#### Worksheet: `statistiques `
- **Inferred Archetype**: `ANALYTICAL_DASHBOARD_MATRIX` (State: `visible`)
- **Active Boundaries**: `A1:AI672` (671 data rows, 35 columns)
- **Layout Controls**: Freeze Panes: `None` | Merged Cells: 0 | Hidden Rows: 0 | Hidden Cols: 0
- **Cell Breakdown**: Text: 2119 | Numeric: 608 | Dates: 0 | Formulas: 2300 | Empty: 18493 | **Errors: 1871**

> ⚠️ **Excel Calculation Errors in `statistiques `**:
> - **#REF!**: 1871 cells
>   - Location `F2`: Formula=`=20000+224800+15000+35000-'Etat General Versement'!$I2-'Etat General Versement'!$J2` | Evaluated=`#REF!`
>   - Location `I2`: Formula=`=33000+285000-'Etat General Versement'!$I2-'Etat General Versement'!$J2` | Evaluated=`#REF!`
>   - Location `L2`: Formula=`=18000+305000-'Etat General Versement'!$I2-'Etat General Versement'!$J2` | Evaluated=`#REF!`

**Cross-Sheet Dependencies:**
- References sheet **`Etat General Versement`** at cells: `$I262, $I264, $I345, $I470, $J420, $J464, $I151, $I313, $J376, $J216`

**Column Definitions & Inferred Business Semantics:**
| Col | Header | Semantic Role | Dominant Type | Uniques | Sample Values |
| :--- | :--- | :--- | :--- | :---: | :--- |
| `A` | **Chiffre d'affaire 2021/2022** | `GENERIC_DATA` | text | 33 | `DESIGNATION`, `ENTRÉE  ANNEE 2020/2021 (AVRIL-JUILLET )`, `ENTREE ANNÉE 2021/2022 (avril-juillet )` |
| `B` | **272 114 885,00 DZD** | `GENERIC_DATA` | text | 13 | `MONTANT`, `66407500.0`, `20656450.0` |
| `C` | **COL_C** | `GENERIC_DATA` | numeric | 19 | `1.0`, `2.0`, `670.0` |
| `D` | **COL_D** | `GENERIC_DATA` | EMPTY | 0 |  |
| `E` | **CE2** | `GENERIC_DATA` | text | 10 | `CM2`, `CE2`, `CE1` |
| `F` | **COL_F** | `GENERIC_DATA` | numeric | 54 | `#REF!`, `247998`, `283000` |
| `G` | **2.0** | `GENERIC_DATA` | numeric | 2 | `1.0`, `2.0` |
| `H` | **2.0** | `GENERIC_DATA` | numeric | 3 | `1.0`, `2.0`, `1AAM` |
| `I` | **COL_I** | `GENERIC_DATA` | numeric | 15 | `#REF!`, `298000`, `0.0` |
| `J` | **COL_J** | `GENERIC_DATA` | EMPTY | 0 |  |
| `K` | **2AS** | `GENERIC_DATA` | text | 3 | `1AS`, `3AS`, `2AS` |
| `L` | **323000.0** | `GENERIC_DATA` | numeric | 9 | `#REF!`, `323000.0`, `0.0` |
| `M` | **COL_M** | `GENERIC_DATA` | EMPTY | 0 |  |
| `N` | **GS** | `GENERIC_DATA` | text | 2 | `MS`, `GS` |
| `O` | **COL_O** | `GENERIC_DATA` | text | 18 | `123000`, `#REF!`, `153000` |
| `P` | **COL_P** | `GENERIC_DATA` | EMPTY | 0 |  |
| `Q` | **COL_Q** | `GENERIC_DATA` | EMPTY | 0 |  |
| `R` | **3CS** | `GENERIC_DATA` | text | 9 | `AUTISTE`, `1cs`, `3CS` |
| `S` | **COL_S** | `GENERIC_DATA` | text | 11 | `#REF!`, `243000`, `311000` |
| `T` | **COL_T** | `GENERIC_DATA` | EMPTY | 0 |  |
| `U` | **COL_U** | `GENERIC_DATA` | EMPTY | 0 |  |
| `V` | **CE2** | `GENERIC_DATA` | text | 10 | `CM1`, `CE1`, `CP` |
| `W` | **COL_W** | `GENERIC_DATA` | numeric | 30 | `#REF!`, `283000`, `0.0` |
| `X` | **COL_X** | `GENERIC_DATA` | EMPTY | 0 |  |
| `Y` | **2AM** | `GENERIC_DATA` | text | 6 | `3AM`, `1AM`, `2AM` |
| `Z` | **COL_Z** | `GENERIC_DATA` | numeric | 9 | `#REF!`, `278000`, `0.0` |
| `AA` | **COL_AA** | `GENERIC_DATA` | EMPTY | 0 |  |
| `AB` | **1AS** | `GENERIC_DATA` | text | 3 | `3AS`, `2AS`, `1AS` |
| `AC` | **COL_AC** | `GENERIC_DATA` | numeric | 9 | `#REF!`, `323000`, `0.0` |
| `AD` | **COL_AD** | `GENERIC_DATA` | EMPTY | 0 |  |
| `AE` | **MS** | `GENERIC_DATA` | text | 2 | `MS`, `GS` |
| `AF` | **COL_AF** | `GENERIC_DATA` | text | 12 | `52000`, `#REF!`, `113000` |
| `AG` | **COL_AG** | `GENERIC_DATA` | EMPTY | 0 |  |
| `AH` | **2CS** | `GENERIC_DATA` | text | 9 | `AUTISTE`, `3CS`, `2CS` |
| `AI` | **COL_AI** | `GENERIC_DATA` | numeric | 9 | `#REF!`, `228000`, `0.0` |

**Calculated Logic & Formula Templates (Row-Shift Invariant):**
| Target Col | Normalized Formula Template | Span | Rows | Example Formula |
| :---: | :--- | :---: | :---: | :--- |
| `F` | `=18000+195000-G{row}-H{row}` | 41 | `103..658` | `=18000+195000-G103-H103` |
| `O` | `=18000+135000-P{row}-Q{row}` | 32 | `4..94` | `=18000+135000-P4-Q4` |
| `AC` | `=18000+305000-'Etat General Versement'!$I{row}-'Etat General Versement'!$J{row}` | 24 | `5..79` | `=18000+305000-'Etat General Versement'!$I5-'Etat General Versement'!$J5` |
| `L` | `=18000+305000-'Etat General Versement'!$I{row}-'Etat General Versement'!$J{row}` | 22 | `2..80` | `=18000+305000-'Etat General Versement'!$I2-'Etat General Versement'!$J2` |
| `AF` | `=18000+125000-AG{row}-AK{row}` | 22 | `23..96` | `=18000+125000-AG23-AK23` |
| `Z` | `=18000+280000-'Etat General Versement'!$I{row}-'Etat General Versement'!$J{row}` | 20 | `2..81` | `=18000+280000-'Etat General Versement'!$I2-'Etat General Versement'!$J2` |
| `I` | `=18000+280000-'Etat General Versement'!$I{row+4}-'Etat General Versement'!$J{row+4}` | 20 | `143..220` | `=18000+280000-'Etat General Versement'!$I147-'Etat General Versement'!$J147` |
| `I` | `=18000+280000-'Etat General Versement'!$I{row}-'Etat General Versement'!$J{row}` | 18 | `4..81` | `=18000+280000-'Etat General Versement'!$I4-'Etat General Versement'!$J4` |
| `I` | `=18000+280000-'Etat General Versement'!$I{row+3}-'Etat General Versement'!$J{row+3}` | 18 | `108..172` | `=18000+280000-'Etat General Versement'!$I111-'Etat General Versement'!$J111` |
| `AF` | `=18000+125000-'Etat General Versement'!$I{row}-'Etat General Versement'!$J{row}` | 16 | `13..53` | `=18000+125000-'Etat General Versement'!$I13-'Etat General Versement'!$J13` |
| `Z` | `=18000+280000-'Etat General Versement'!$I{row+3}-'Etat General Versement'!$J{row+3}` | 15 | `108..164` | `=18000+280000-'Etat General Versement'!$I111-'Etat General Versement'!$J111` |
| `Z` | `=18000+280000-'Etat General Versement'!$I{row+4}-'Etat General Versement'!$J{row+4}` | 15 | `145..222` | `=18000+280000-'Etat General Versement'!$I149-'Etat General Versement'!$J149` |
| `O` | `=18000+105000-P{row}-Q{row}` | 14 | `2..82` | `=18000+105000-P2-Q2` |
| `I` | `=18000+280000-J{row}-K{row}` | 14 | `235..268` | `=18000+280000-J235-K235` |
| `L` | `=33000+320000-'Etat General Versement'!$I{row}-'Etat General Versement'!$J{row}` | 12 | `5..78` | `=33000+320000-'Etat General Versement'!$I5-'Etat General Versement'!$J5` |
