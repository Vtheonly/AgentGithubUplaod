/**
 * useCurrentAcademicYear — resolves the CURRENT academic year from the
 * AcademicYearRepository, replacing the hard-coded "ay-2025-2026" /
 * "2025-2026" literals that were sprinkled through club, therapy, class and
 * subject creation flows (vault §05.05 — "Dynamic year management": entities
 * must be scoped to the real current year, not a frozen one).
 *
 * T-408 (ACAD-509): the synthetic FALLBACK pair ("ay-2025-2026" /
 * "2025-2026") is REMOVED. A fabricated year id is exactly the ACAD-506
 * defect class (the `al-<gradeCode>` uuid violation) one layer up: when no
 * year is flagged current, the fallback id flowed into write payloads and
 * either (a) hit the repository's isUuid guard as a cryptic validation
 * error, or (b) in mock mode silently scoping records to a year that does
 * not exist. The honest contract is `id: null` — every creation surface
 * must GUARD and fail with a clean "no active academic year" error instead
 * of fabricating one. Read surfaces treat null as "no year context" and
 * render their honest empty state.
 */
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";

export interface CurrentAcademicYear {
  /** The REAL academic_years uuid — null when no year is flagged current. */
  readonly id: string | null;
  /** The year's code (e.g. "2026-2027") — null when no year is flagged current. */
  readonly code: string | null;
}

export function useCurrentAcademicYear(): CurrentAcademicYear {
  const repos = useRepositories();
  const years = useObservable(() => repos.academicYears.observeAll(), []);
  const current = years.find((y) => y.isCurrent && !y.isArchived) ?? years.find((y) => y.isCurrent);
  return {
    id: current?.id ?? null,
    code: current?.code ?? null,
  };
}
