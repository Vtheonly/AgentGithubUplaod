/**
 * useCurrentAcademicYear — resolves the CURRENT academic year from the
 * AcademicYearRepository, replacing the hard-coded "ay-2025-2026" /
 * "2025-2026" literals that were sprinkled through club, therapy, class and
 * subject creation flows (vault §05.05 — "Dynamic year management": entities
 * must be scoped to the real current year, not a frozen one).
 *
 * Falls back to the seeded "ay-2025-2026" / "2025-2026" pair when no year is
 * flagged current (mock seeds always mark one) so behavior stays identical
 * for existing data.
 */
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";

export const FALLBACK_ACADEMIC_YEAR_ID = "ay-2025-2026";
export const FALLBACK_ACADEMIC_YEAR_CODE = "2025-2026";

export interface CurrentAcademicYear {
  readonly id: string;
  readonly code: string;
}

export function useCurrentAcademicYear(): CurrentAcademicYear {
  const repos = useRepositories();
  const years = useObservable(() => repos.academicYears.observeAll(), []);
  const current = years.find((y) => y.isCurrent && !y.isArchived) ?? years.find((y) => y.isCurrent);
  return {
    id: current?.id ?? FALLBACK_ACADEMIC_YEAR_ID,
    code: current?.code ?? FALLBACK_ACADEMIC_YEAR_CODE,
  };
}
