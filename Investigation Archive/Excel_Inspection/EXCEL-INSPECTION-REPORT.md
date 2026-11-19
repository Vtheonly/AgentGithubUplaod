# Excel Inspection Report — متابعة تمدرس التلاميذ.xlsx (the school pedagogy workbook)

**Session 14 (2026-11-20) · Investigation Archive charter: read-only on the app; this folder + `Deep Sweep/10` are the only writes.**
**Companion analysis (entity model + unified design): `Investigation Archive/Deep Sweep/10-DEEP-SCHOOL-EXCEL-PEDAGOGY-UNIFICATION-2026-11-20.md`**

---

## 1. Provenance & method

| Item | Value |
|---|---|
| Source | `/home/z/my-project/upload/متابعة تمدرس التلاميذ.xlsx` (owner-supplied upload, Session 14) |
| Size | 195,516 bytes |
| SHA-256 | `15174e1b77e82e34e4878868d8a6d240fc7e93e6d5d827943b6e462e9bf69958` |
| Archived copy | `Investigation Archive/Excel_Inspection/source/متابعة تمدرس التلاميذ.xlsx` (byte-identical; kept so future runs re-verify formulas/layouts at any HEAD) |
| Tool | openpyxl 3.1.5 — the workbook loaded **twice**: `data_only=False` (raw formulas) and `data_only=True` (cached values). Sheet inventory incl. hidden sheets, merged ranges, data validations, defined names, freeze panes, protection. |
| Script | `/home/z/my-project/scripts/excel_inspect_s14.py` (outside the repo, per the S7/S13 convention). Re-runnable: `python3 scripts/excel_inspect_s14.py` regenerates every CSV + the structure JSON. |
| Outputs | `csv/` (per sheet: `*_values.csv` + `*_formulas.csv`), `structure/` (`workbook-structure.json`, `formulas-catalog.tsv`, `formula-pattern-census.csv`), `source/` (the archived workbook). |
| Workbook census scope | The ONLY other Excel workbooks in the repo are the two financial ones already deep-audited in Session 8 (`Excel/2027-2026.xlsx`, `Excel/Suivis clients 2026_2027.xlsx` — the C-21 "two-workbook price-era" pair). No pedagogy workbook existed anywhere in the repo before this upload — this file is the first pedagogy-side workbook input of the investigation. |

**Nothing in this report is guessed**: every label, position, and count below was extracted programmatically from the archived copy; the CSVs under `csv/` are the authority.

---

## 2. Sheet inventory (all 8 sheets, none hidden)

| # | Sheet (verbatim name) | State | Dims (rows×cols) | Merged ranges | Non-empty cells | Numeric cells | Formula cells | Blocks (class rosters) |
|---|---|---|---|---|---|---|---|---|
| 1 | `جع مشترك` *(sic — reads جذع مشترك in the block titles)* | visible | 205×105 | 108 | 859 | 150 | **0** | 6 |
| 2 | `الرياضات` *(sic — block titles read الرياضيات)* | visible | 101×105 | 54 | 413 | 75 | **0** | 3 |
| 3 | `تقني رياضي` | visible | 138×116 | 72 | 602 | 100 | **0** | 4 |
| 4 | `علوم تجريبية` | visible | 74×105 | 35 | 279 | 50 | **0** | 2 |
| 5 | `تسيير واقتصاد` | visible | 66×116 | 36 | 301 | 50 | **0** | 2 |
| 6 | `لغات اجنبية` | visible | 63×105 | 36 | 208 | 0 | **0** | 2 |
| 7 | `Feuil7` | visible | 1×1 | 0 | 1 | 1 | **0** | 0 (single cell, value `12`) |
| 8 | `Feuil8` | visible | 1×1 | 0 | 0 | 0 | **0** | 0 (empty stub) |

**Totals: 8 sheets · 19 class blocks · 305 merged ranges · 2,663 non-empty cells · 426 numeric cells · 0 formula cells.**

---

## 3. The verdict that drives everything else

1. **ZERO formulas** (`structure/formulas-catalog.tsv` is empty; `csv/*_formulas.csv` are all empty grids). Every `معدل الفصلي` cell in the workbook is a **manually-typed or blank cell** — the workbook encodes NO averaging rule, weight, threshold, lookup, or validation of its own.
2. **ZERO data validations, ZERO defined names, no freeze panes, no sheet protection, no hidden sheets** (workbook-structure.json). Nothing constrains what may be typed into any score cell.
3. **The workbook is a blank roster TEMPLATE, not a data source.** The only numeric content is the student-number column (`الرقم`, 1–25 per block: 150+75+100+50+50 = 425 numbers) plus `Feuil7`'s lone `12`. There is exactly **one partial student name in the whole workbook** (`حميد`, in a `لغات اجنبية` block) and **zero scores/grades/averages entered anywhere**.
4. Consequence for consolidation: **the math must live in the app — and the app already owns it.** The desktop app's engines define the very rules the workbook leaves implicit: `computeSubjectAverage` = (D1+D2+2·Ex)/4 with a centi-round (academic.ts:326-337), the recipe engine `Σ(mark×weight)/Σ(weight)` (subject-config.ts:159-200), the GPA `Σ(avg×coef)/Σcoef` (academic.ts:351-371), the 0..20 scale + 10.0 passing grade, the T1/T2/T3 windows (terms.ts:28-63), and the official per-level coefficients seeded in migration 0114. The unification question is therefore **not "import Excel formulas" but "cover the workbook's STRUCTURE with the app's existing model"** — plus the few gaps listed in §7.

---

## 4. The structural model the workbook DOES encode (exactly as laid out)

### 4.1 Block layout (one class roster per block)

Each block = 6 header rows + 25 student rows (+ separators), with the block title row merged across the full width (e.g. `A3:DA4` style ranges):

| Sheet | Block titles (verbatim, spaces collapsed) |
|---|---|
| جع مشترك | `الشعبة : جذع مشترك علوم — القسم : 1ع1` … `1ع5`, and `الشعبة : جذع مشترك ادب — القسم : 1آ1` |
| الرياضات | `الشعبة : الرياضيات — القسم : 2 رياضي1`, `2 رياضي2`, `3 رياضي` |
| تقني رياضي | `الشعبة : 2 تقني رياضي هندسة ميكانيكية — القسم : 2 ت رياضي`, `الشعبة : 2 تقني رياضي هندسة مدنية — القسم : 2 ت رياضي`, and the same two at `3` (year 3) |
| علوم تجريبية | `الشعبة : علوم تجريبية — القسم : 2 علوم1`, `3 علوم1` |
| تسيير واقتصاد | `الشعبة : 2 تسير و اقتصاد — القسم : 2 ت إ`, `الشعبة : 3 تسير و اقتصاد — القسم : 3 ت إ` |
| لغات اجنبية | `الشعبة : لغات اجنبية — القسم : 3 لغات`, `2 لغات` |

The block title is a **two-part key: شعبة (stream) + القسم (class/division)** — and the القسم codes embed the **study level** (`1ع`, `2`, `3` prefixes) plus a sequence number. 19 blocks × 25 rows = **475 roster slots**.

### 4.2 Column model (uniform across all sheets; verified via merged anchors, e.g. sheet 1)

| Columns (sheet 1) | Group header (row 5) | Sub-groups (row 6) | Content per sub-group |
|---|---|---|---|
| 0 | `الرقم` | — | student number 1–25 |
| 1 | `الاسم و اللقب` | — | student name (blank everywhere except `حميد`) |
| 2–10 | `تقويم تشخيصي` (merged `C5:K6`, no sub-group row) | — | one diagnostic score per subject |
| 11–46 | `المراقبة المستمرة` (`L5:AU5`) | `الكراس` (notebooks) · `المشاركة` (participation) · `الوجبات` *(sic — read الواجبات, homework)* · `السلوك` (behavior) | 4 × N subject columns |
| 47–73 | `متابعة اعمال التلاميذ` (`AV5:BV5`) | `الاستجوبات الكتابية` (written tests) · `الاستجوبات الشفاهية` (oral tests) · `الغيابات` (absences) | 3 × N subject columns |
| 74–103 | `نتائج الدراسة` (`BW5:CZ5`) | `الفصل الاول` · `الفصل الثاني` · `الفصل الثالث` | each trimester: N subject columns + one `معدل الفصلي` (term average) column |
| 104 | `الملاحظات` (`DA5:DA6`) | — | free remarks |

**Two label observations (to confirm with the school, recorded verbatim — not silently "fixed"):**
- The sheet places `الكراس/المشاركة/الوجبات/السلوك` under **المراقبة المستمرة** and the **tests** under **متابعة اعمال التلاميذ** — the transpose of the official Algerian bulletin, where متابعة أعمال التلاميذ covers notebook/participation/homework/behavior and المراقبة المستمرة covers the tests. The merged anchors prove this is the sheet's own grouping, not an extraction artifact.
- `الوجبات` (meals) is almost certainly `الواجبات` (homework) — one-letter typo in the source.

### 4.3 Per-sheet subject lists (verbatim; expansions flagged where uncertain)

| Sheet | N | Subjects (verbatim) |
|---|---|---|
| جع مشترك | 9 | عربية · رياضيات · تكنولوجيا · فيزياء · علوم طبيعية · فرنسية · انجليزية · تا / ج · ت اسلا |
| الرياضات (رياضيات) | 8 | عربية · رياضيات · فيزياء · علوم طبيعية · فرنسية · انجليزية · تا / ج · ت اسلا |
| تقني رياضي | 9 | عربية · رياضيات · تكنولوجيا · فيزياء · علوم طبيعية · فرنسية · انجليزية · تا / ج · ت اسلا |
| علوم تجريبية | 8 | عربية · رياضيات · فيزياء · علوم طبيعية · فرنسية · انجليزية · تا / ج · ت اسلا |
| تسيير واقتصاد | 9 | عربية · رياضيات · محاسبة · مناجمنت · القانون · فرنسية · انجليزية · تا / ج · ت اسلا |
| لغات اجنبية | 8 | عربية · فرنسية · انجليزية · اسباية *(sic — الأسبانية, Spanish)* · تا / ج · رياضيات · ت اسلا · فلسفة |

Abbreviation readings (probable, flagged for school confirmation): `تا / ج` → التاريخ والجغرافيا (History-Geography); `ت اسلا` → التربية الإسلامية (Islamic education); `تكنولوجيا` → the technology/informatics slot.

---

## 5. Excel ↔ desktop-app consolidation map

The app's catalogs were read directly for this table (`src/domain/model/filiere.ts:62-81` mirrors migration 0107's `filieres` seed; `supabase/migrations/0114` seeds the 14-subject catalog + per-level `subject_configurations`).

### 5.1 Streams (شعبة) — a near-exact 1:1 match onto the app's filière catalog

| Workbook stream (block/sheet) | Level | App `filiere.ts` code | Match |
|---|---|---|---|
| جذع مشترك علوم (`1ع1..1ع5`) | 1ère année | `tronc_commun_sciences` (applicableGrades: 1ere_annee) | exact |
| جذع مشترك ادب (`1آ1`) | 1ère année | `tronc_commun_lettres` | exact |
| الرياضيات (`2/3 رياضي`) | 2ème/3ème | `mathematiques` | exact |
| تقني رياضي — هندسة ميكانيكية | 2ème/3ème | `technique_mathematique` + specialite `genie_mecanique` | exact |
| تقني رياضي — هندسة مدنية | 2ème/3ème | `technique_mathematique` + specialite `genie_civil` | exact |
| علوم تجريبية (`2/3 علوم`) | 2ème/3ème | `sciences_experimentales` | exact |
| تسيير واقتصاد (`2/3 ت إ`) | 2ème/3ème | `gestion_economie` | exact |
| لغات اجنبية (`2/3 لغات`) | 2ème/3ème | `langues_etrangeres` | exact |

The app is RICHER: the catalog also carries `tronc_commun_technologie`, `lettres_philosophie`, and specialites `genie_electrique`/`genie_procedes` (no workbook blocks use them). **No stream in the workbook is missing from the app — the owner's "fragmented تخصص" pain is therefore not about the catalog itself but about the 6 model-level fault lines in Deep Sweep/10 §5.**

### 5.2 Levels — the workbook's implicit ladder maps exactly onto GRADE_LEVELS

`1ع` → `1ere_annee`; `2/3` prefixes → `2eme_annee`/`3eme_annee` — three of the app's 14 `GRADE_LEVELS` codes (student.ts:125-156; DB `academic_levels` 14-row seed, 0023:272-287). The workbook only exercises the secondary band; the app additionally models prescolaire/primaire/cem.

### 5.3 Classes (القسم) — same concept, different code conventions

| Aspect | Workbook | App (`AcademicClass`) |
|---|---|---|
| Identity | `1ع1`, `2 رياضي1` (level+stream+sequence, Arabic) | code `CLS-3AP-B`-style + `section` "A"/"B" + `gradeCode` (0004:55-70, 0029:33-34) |
| Capacity | 25 rows/roster (implicit) | explicit `capacity` (create-section-dialog default 28) |
| Stream link | implicit in the sheet/block | explicit `filiere_code`/`specialite_code` (0107:177-178) |

→ Unification needs ONE class-code normalization rule (school's real codes as `name`/alias, app code as canonical) — designed in Deep Sweep/10 §5.

### 5.4 Subjects — 12 of 14 map; 4 workbook subjects are missing from the app catalog

| Workbook subject | App subject code (0114 seed) | Status |
|---|---|---|
| عربية | `ARABE` | match |
| رياضيات | `MATHS` | match |
| فيزياء | `PHYSIQUE` | match |
| علوم طبيعية | `SVT` | match |
| فرنسية | `FRANCAIS` | match |
| انجليزية | `ANGLAIS` | match |
| تا / ج (تاريخ وجغرافيا) | `HIST_GEO` | match (reading to confirm) |
| ت اسلا (تربية إسلامية) | `EDU_ISLAM` | match (reading to confirm) |
| فلسفة (لغات sheet) | `PHILO` | match |
| تكنولوجيا | `INFORMATIQUE`? | **to confirm** — the app has no standalone Technology subject; INFORMATIQUE is the likely slot |
| محاسبة (تسيير واقتصاد) | — | **MISSING** from the 14-subject catalog |
| مناجمنت (تسيير واقتصاد) | — | **MISSING** |
| القانون (تسيير واقتصاد) | — | **MISSING** |
| اسباية (الأسبانية; لغات sheet) | — | **MISSING** |

### 5.5 Assessment dimensions — the workbook wants 8; the app models 4

| Workbook column family | App representation | Status |
|---|---|---|
| تقويم تشخيصي (diagnostic) | — | **GAP** (no assessment kind) |
| الكراس (notebook) / المشاركة (participation) / الوجبات-الواجبات (homework) / السلوك (behavior) | — | **GAP** (qualitative follow-up not modeled as marks) |
| الاستجوبات الكتابية (written tests) | `devoir_1`/`devoir_2` (+ `examen`) | match (D1/D2 = the written tests) |
| الاستجوبات الشفاهية (oral tests) | — | **GAP** (no oral kind; could be a recipe component) |
| الغيابات (absences) | `attendance_records` (0004:161-180, roll-call screen) | match |
| نتائج الدراسة per trimester + معدل الفصلي | `assessments` per `T1/T2/T3` + `computeOverallGpa` | match |

The app's `GradingRecipe` is a weighted-component engine by design (`{d1, d2, ex, cc}` jsonb, 0094:31-77; `computeSubjectAverageFromRecipe` = Σ(mark×weight)/Σ(weight)) — so the four gaps are **component extensions of an existing engine, not a new engine** (design in Deep Sweep/10 §5.4).

### 5.6 Rosters/import — the one hard pipeline gap

The existing student Excel import writes `classId: null` for every imported student (repository-adapter.ts:1385-1391; the `classe` column only feeds grade-level derivation via niveau-mapper.ts). The workbook's rosters live in **block headers**, not per-row columns — a pedagogy-workbook importer must parse the `الشعبة/القسم` block titles, resolve-or-create the class, then assign students. Registered as **BUG-064** (Deep Sweep/10 §6).

---

## 6. What this workbook does NOT decide (kept open, not guessed)

1. The averaging rule the school intends between the 8 dimension families (the official bulletin's composite vs the app's current per-subject recipe) — an **owner curriculum decision** (see Deep Sweep/10 §5.4 option A/B).
2. Whether `تكنولوجيا` ≡ `INFORMATIQUE`, and the exact readings of `تا / ج` / `ت اسلا` — one confirmation message to the school closes all three.
3. The real per-class rosters (the template is blank) — the filled workbook is the eventual import input; the engine must be ready before it arrives.

## 7. Immediate unification value (summary)

- The workbook CONFIRMS the app's stream/level/class/subject/trimester model is the right spine (a 1:1 stream match with zero missing streams).
- It exposes exactly four coverage gaps: 4 missing subjects, 4 missing assessment dimensions, the class-code convention, and the classless-import pipeline gap.
- It contains zero logic to migrate — consolidating means extending the app's existing (repaired) model, not porting Excel math.
