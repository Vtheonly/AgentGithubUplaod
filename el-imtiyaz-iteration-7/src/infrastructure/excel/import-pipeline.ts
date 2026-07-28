/**
 * Excel bulk import pipeline — plan §14.
 *
 * 5-step desktop-only pipeline:
 *   1. Select .xlsx
 *   2. ExcelJS parse
 *   3. Map headers (Student Name → students.full_name, Parent Contact → parents.primary_phone, etc.)
 *   4. Validate (required fields, dup codes, parent links, valid grade codes)
 *   5. Atomic bulk insert — if any row fails, entire import rolls back
 *
 * Per plan §14: ExcelJS is restricted to import/export service modules
 * only. No formula parsing in runtime code.
 */
import ExcelJS from "exceljs";
import { Ok, Err, type Result } from "../../core/result/result";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ImportRow {
  readonly rowIndex: number; // 1-based, matches Excel row
  readonly parentFirstName: string;
  readonly parentLastName: string;
  readonly parentPhone: string;
  readonly parentWhatsapp: string | null;
  readonly parentEmail: string | null;
  readonly parentCityTier: "t1" | "t2" | "t3" | null;
  readonly studentFirstName: string;
  readonly studentLastName: string;
  readonly studentBirthDate: string; // ISO yyyy-MM-dd
  readonly studentLevel: "primaire" | "cem" | "lycee";
  readonly studentGradeYear: number;
}

export interface ImportError {
  readonly rowIndex: number;
  readonly field: string;
  readonly message: string;
}

export interface ImportPreview {
  readonly rows: readonly ImportRow[];
  readonly errors: readonly ImportError[];
  readonly canCommit: boolean;
  readonly sheetNames: readonly string[];
}

export interface ImportCommitResult {
  readonly inserted: number;
  readonly skipped: number;
}

/* ------------------------------------------------------------------ */
/*  Header mapping (plan §14)                                          */
/* ------------------------------------------------------------------ */

const HEADER_ALIASES: Record<keyof ImportRow, readonly string[]> = {
  rowIndex: [],
  parentFirstName: ["parent_first_name", "parentfirstname", "parent first name", "père prénom", "mère prénom", "tuteur prénom"],
  parentLastName: ["parent_last_name", "parentlastname", "parent last name", "père nom", "mère nom", "tuteur nom"],
  parentPhone: ["parent_phone", "parentphone", "parent phone", "parent contact", "téléphone parent", "tel parent"],
  parentWhatsapp: ["parent_whatsapp", "whatsapp", "parent whatsapp"],
  parentEmail: ["parent_email", "email", "parent email", "courriel parent"],
  parentCityTier: ["parent_city_tier", "city_tier", "zone", "tier", "zone de résidence"],
  studentFirstName: ["student_first_name", "studentfirstname", "student first name", "élève prénom", "prénom élève"],
  studentLastName: ["student_last_name", "studentlastname", "student last name", "élève nom", "nom élève"],
  studentBirthDate: ["student_birth_date", "birthdate", "birth_date", "date de naissance", "naissance", "élève date de naissance"],
  studentLevel: ["student_level", "level", "niveau", "niveau scolaire"],
  studentGradeYear: ["student_grade_year", "grade_year", "année", "annee"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s_-]+/g, " ");
}

function findColumnIndex(headerRow: ExcelJS.Row, key: keyof ImportRow): number {
  const aliases = HEADER_ALIASES[key].map(normalizeHeader);
  for (let i = 1; i <= (headerRow.cellCount || 0); i++) {
    const cell = headerRow.getCell(i);
    const text = normalizeHeader(String(cell.value ?? ""));
    if (aliases.includes(text)) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/*  Step 1+2 — Parse                                                   */
/* ------------------------------------------------------------------ */

export async function parseWorkbook(file: File): Promise<ExcelJS.Workbook> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/* ------------------------------------------------------------------ */
/*  Step 3 — Map headers                                               */
/* ------------------------------------------------------------------ */

export function extractRows(wb: ExcelJS.Workbook): ImportPreview {
  const sheetNames = wb.worksheets.map((s) => s.name);
  if (wb.worksheets.length === 0) {
    return { rows: [], errors: [{ rowIndex: 0, field: "file", message: "Aucune feuille trouvée." }], canCommit: false, sheetNames };
  }

  // Use the first sheet by default
  const sheet = wb.worksheets[0];
  const headerRow = sheet.getRow(1);
  if (!headerRow || headerRow.cellCount === 0) {
    return { rows: [], errors: [{ rowIndex: 0, field: "header", message: "Aucune ligne d'en-tête trouvée." }], canCommit: false, sheetNames };
  }

  const colMap: Record<keyof ImportRow, number> = {
    rowIndex: -1,
    parentFirstName: findColumnIndex(headerRow, "parentFirstName"),
    parentLastName: findColumnIndex(headerRow, "parentLastName"),
    parentPhone: findColumnIndex(headerRow, "parentPhone"),
    parentWhatsapp: findColumnIndex(headerRow, "parentWhatsapp"),
    parentEmail: findColumnIndex(headerRow, "parentEmail"),
    parentCityTier: findColumnIndex(headerRow, "parentCityTier"),
    studentFirstName: findColumnIndex(headerRow, "studentFirstName"),
    studentLastName: findColumnIndex(headerRow, "studentLastName"),
    studentBirthDate: findColumnIndex(headerRow, "studentBirthDate"),
    studentLevel: findColumnIndex(headerRow, "studentLevel"),
    studentGradeYear: findColumnIndex(headerRow, "studentGradeYear"),
  };

  const missingRequired: ImportError[] = [];
  const required: Array<keyof ImportRow> = [
    "parentFirstName", "parentLastName", "parentPhone",
    "studentFirstName", "studentLastName", "studentBirthDate",
    "studentLevel", "studentGradeYear",
  ];
  for (const key of required) {
    if (colMap[key] === -1) {
      missingRequired.push({
        rowIndex: 0,
        field: String(key),
        message: `Colonne manquante pour "${key}". Vérifiez l'en-tête.`,
      });
    }
  }
  if (missingRequired.length > 0) {
    return { rows: [], errors: missingRequired, canCommit: false, sheetNames };
  }

  // Step 4 — Validate + collect rows
  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seenPhones = new Set<string>();

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const get = (key: keyof ImportRow): string => {
      const idx = colMap[key];
      if (idx < 0) return "";
      const v = row.getCell(idx).value;
      if (v == null) return "";
      if (typeof v === "object" && "text" in v) return String((v as { text: string }).text ?? "");
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).trim();
    };

    const parentPhone = get("parentPhone");
    const studentLevel = get("studentLevel").toLowerCase();
    const gradeYear = Number(get("studentGradeYear")) || 0;
    const birthDate = get("studentBirthDate");
    const tier = get("parentCityTier").toLowerCase();

    // Validate
    if (!parentPhone) errors.push({ rowIndex: rowNum, field: "parentPhone", message: "Téléphone parent requis." });
    else if (!/^[+]?[0-9\s]{8,15}$/.test(parentPhone)) errors.push({ rowIndex: rowNum, field: "parentPhone", message: "Format téléphone invalide." });
    else if (seenPhones.has(parentPhone)) errors.push({ rowIndex: rowNum, field: "parentPhone", message: `Doublon: ${parentPhone} déjà vu dans cet import.` });
    else seenPhones.add(parentPhone);

    if (!["primaire", "cem", "lycee"].includes(studentLevel)) {
      errors.push({ rowIndex: rowNum, field: "studentLevel", message: `Niveau invalide: ${studentLevel}. (primaire / cem / lycee)` });
    }
    if (gradeYear < 1 || gradeYear > 5) {
      errors.push({ rowIndex: rowNum, field: "studentGradeYear", message: `Année invalide: ${gradeYear}. (1-5)` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      errors.push({ rowIndex: rowNum, field: "studentBirthDate", message: `Date invalide: ${birthDate}. Format attendu: YYYY-MM-DD.` });
    }
    if (tier && !["t1", "t2", "t3"].includes(tier)) {
      errors.push({ rowIndex: rowNum, field: "parentCityTier", message: `Zone invalide: ${tier}. (t1 / t2 / t3)` });
    }

    rows.push({
      rowIndex: rowNum,
      parentFirstName: get("parentFirstName"),
      parentLastName: get("parentLastName"),
      parentPhone,
      parentWhatsapp: get("parentWhatsapp") || null,
      parentEmail: get("parentEmail") || null,
      parentCityTier: (tier || null) as "t1" | "t2" | "t3" | null,
      studentFirstName: get("studentFirstName"),
      studentLastName: get("studentLastName"),
      studentBirthDate: birthDate,
      studentLevel: studentLevel as "primaire" | "cem" | "lycee",
      studentGradeYear: gradeYear,
    });
  });

  return {
    rows,
    errors,
    canCommit: errors.length === 0 && rows.length > 0,
    sheetNames,
  };
}

/* ------------------------------------------------------------------ */
/*  Step 5 — Atomic commit                                             */
/* ------------------------------------------------------------------ */

export type AtomicInserter = (rows: readonly ImportRow[]) => Promise<Result<ImportCommitResult, Error>>;

/**
 * Commit the import via the provided atomic inserter.
 *
 * The inserter is responsible for wrapping the entire batch in a single
 * transaction. If ANY row fails, the entire batch must roll back — this
 * is the "atomic" part of "atomic bulk insert" per plan §14.
 */
export async function commitImport(
  preview: ImportPreview,
  inserter: AtomicInserter,
): Promise<Result<ImportCommitResult, Error>> {
  if (!preview.canCommit) {
    return Err(new Error("Impossible de committer: validation a échoué."));
  }
  return inserter(preview.rows);
}

/* ------------------------------------------------------------------ */
/*  Convenience: parse + preview in one call                           */
/* ------------------------------------------------------------------ */

export async function parseAndPreview(file: File): Promise<Result<ImportPreview, Error>> {
  try {
    const wb = await parseWorkbook(file);
    const preview = extractRows(wb);
    return Ok(preview);
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)));
  }
}
