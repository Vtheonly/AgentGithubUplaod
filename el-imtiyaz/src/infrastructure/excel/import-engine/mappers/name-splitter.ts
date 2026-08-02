/**
 * Full-name splitter — splits a single `NOM` string from the ETAT sheet
 * into `firstName` + `lastName` for the `CreateStudentInput` shape.
 *
 * Handles both Latin (French) and Arabic names. The heuristic is
 * intentionally simple: the first whitespace-separated token is the
 * first name, the remainder is the last name. This matches the
 * behavior of the existing `batch-registration-modal.tsx`.
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
 * Split a full name into first + last. Returns `EMPTY` when the input is
 * blank. When the input is a single token, that token becomes the last
 * name and first name is left empty (so the row still imports — students
 * with mononyms are valid in the system).
 */
export function splitFullName(rawName: unknown): SplitNameResult {
  const name = normalize(rawName);
  if (!name) return EMPTY;

  const tokens = name.split(" ");
  if (tokens.length === 1) {
    return { firstName: "", lastName: tokens[0] };
  }
  const firstName = tokens[0];
  const lastName = tokens.slice(1).join(" ");
  return { firstName, lastName };
}

/** Returns true when both first and last name are non-empty. */
export function isCompleteName(result: SplitNameResult): boolean {
  return result.firstName.length > 0 && result.lastName.length > 0;
}
