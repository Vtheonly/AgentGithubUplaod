/**
 * Full-name splitter — splits a single `NOM` string from the ETAT sheet
 * into `firstName` + `lastName` for the `CreateStudentInput` shape.
 *
 * Handles both Latin (French) and Arabic names.
 *
 * IMPORTANT — NOM format in the real ETAT sheet:
 *   Per `Clients_Sheet_Merged.md` → "03 - ETAT Columns / 01 - Identity (B-K)":
 *   > `F (NOM)` — **Name** — the student's full name
 *   > (e.g., `ZIREG LEA`, `MERABTI RIHAM`). **Always in `LASTNAME FIRSTNAME` order.**
 *
 * So for input `"ZIREG LEA"` we must return `lastName="ZIREG", firstName="LEA"`.
 * The original implementation assumed `FIRSTNAME LASTNAME` order, which
 * produced swapped names for every imported student.
 *
 * For the TUTEUR field (column E), the docs say:
 *   > Usually just the family name (e.g., `ABDELAOUI`, `BELRECHID`).
 *
 * So TUTEUR is typically a single token = family name. When TUTEUR contains
 * multiple tokens (e.g. "AMRANI Karim" used as a full parent name), we treat
 * the first token as lastName and the rest as firstName — same as NOM, since
 * parents are also entered in `LASTNAME FIRSTNAME` order in the real sheet.
 */
export interface SplitNameResult {
  readonly firstName: string;
  readonly lastName: string;
}

const EMPTY: SplitNameResult = { firstName: "", lastName: "" };

/** Normalize whitespace and trim a raw name string. */
function normalize(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a full name in `LASTNAME FIRSTNAME` order into first + last.
 *
 * - Empty input → `{ firstName: "", lastName: "" }`.
 * - Single token → that token becomes `lastName` and `firstName` is left
 *   empty (so the row still imports — students/parents with mononyms are
 *   valid in the system).
 * - Two or more tokens → first token is `lastName`, remaining tokens
 *   joined with a space become `firstName`.
 */
export function splitFullName(rawName: unknown): SplitNameResult {
  const name = normalize(rawName);
  if (!name) return EMPTY;

  const tokens = name.split(" ");
  if (tokens.length === 1) {
    return { firstName: "", lastName: tokens[0] };
  }
  // LASTNAME FIRSTNAME order — first token is the family name.
  const lastName = tokens[0];
  const firstName = tokens.slice(1).join(" ");
  return { firstName, lastName };
}

/** Returns true when both first and last name are non-empty. */
export function isCompleteName(result: SplitNameResult): boolean {
  return result.firstName.length > 0 && result.lastName.length > 0;
}
