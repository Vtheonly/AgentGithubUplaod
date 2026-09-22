// ============================================================================
// FILE: src/infrastructure/mock/repositories/academic-level-repository.ts
// ============================================================================
/**
 * MockAcademicLevelRepository — T-407 (ACAD-506).
 *
 * The mock twin of `SupabaseAcademicLevelRepository`, seeded with the SAME
 * canonical 14-row Algerian ladder as migration 0023 §5 (prescolaire_1..2,
 * 1ap..5ap, 1am..4am, 1ere..3eme_annee). The ids mirror the grade_code
 * (`al-<grade_code>`) — mock-mode consumers may rely on the stable shape,
 * but NOTE (ACAD-506 lesson): mock ids are NEVER valid Supabase uuids; any
 * payload built from them must go through `getByGradeCode` at the call
 * site, which resolves the REAL uuid in Supabase mode.
 */

import type { Observable } from "../../../domain/repository/repository";
import { SubjectBehavior } from "../subject-behavior";
import type {
  AcademicLevelRepository,
} from "../../../domain/repository/academic-repository";
import type {
  AcademicLevelModel,
} from "../../../domain/model/academic";
import type { GradeLevel } from "../../../domain/model/student";
import { Ok, type Result } from "../../../core/result";

interface LevelSeed {
  readonly gradeCode: GradeLevel;
  readonly cycle: AcademicLevelModel["cycle"];
  readonly yearLabel: string;
  readonly yearNumber: number;
  readonly sortOrder: number;
}

/** The canonical 14-row Algerian ladder — verbatim from 0023 §5. */
const LEVEL_SEEDS: readonly LevelSeed[] = [
  { gradeCode: "prescolaire_1", cycle: "prescolaire", yearLabel: "Moyenne Section", yearNumber: 1, sortOrder: 1 },
  { gradeCode: "prescolaire_2", cycle: "prescolaire", yearLabel: "Grande Section", yearNumber: 2, sortOrder: 2 },
  { gradeCode: "1ap", cycle: "primaire", yearLabel: "1ère Année Primaire", yearNumber: 1, sortOrder: 11 },
  { gradeCode: "2ap", cycle: "primaire", yearLabel: "2ème Année Primaire", yearNumber: 2, sortOrder: 12 },
  { gradeCode: "3ap", cycle: "primaire", yearLabel: "3ème Année Primaire", yearNumber: 3, sortOrder: 13 },
  { gradeCode: "4ap", cycle: "primaire", yearLabel: "4ème Année Primaire", yearNumber: 4, sortOrder: 14 },
  { gradeCode: "5ap", cycle: "primaire", yearLabel: "5ème Année Primaire", yearNumber: 5, sortOrder: 15 },
  { gradeCode: "1am", cycle: "cem", yearLabel: "1ère Année Moyenne", yearNumber: 1, sortOrder: 21 },
  { gradeCode: "2am", cycle: "cem", yearLabel: "2ème Année Moyenne", yearNumber: 2, sortOrder: 22 },
  { gradeCode: "3am", cycle: "cem", yearLabel: "3ème Année Moyenne", yearNumber: 3, sortOrder: 23 },
  { gradeCode: "4am", cycle: "cem", yearLabel: "4ème Année Moyenne", yearNumber: 4, sortOrder: 24 },
  { gradeCode: "1ere_annee", cycle: "lycee", yearLabel: "1ère Année Secondaire", yearNumber: 1, sortOrder: 31 },
  { gradeCode: "2eme_annee", cycle: "lycee", yearLabel: "2ème Année Secondaire", yearNumber: 2, sortOrder: 32 },
  { gradeCode: "3eme_annee", cycle: "lycee", yearLabel: "3ème Année Secondaire", yearNumber: 3, sortOrder: 33 },
];

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

function seedToModel(seed: LevelSeed): AcademicLevelModel {
  return {
    id: `al-${seed.gradeCode}`,
    tenantId: TENANT_ID,
    cycle: seed.cycle,
    gradeCode: seed.gradeCode,
    labelFr: seed.yearLabel,
    labelAr: null,
    yearNumber: seed.yearNumber,
    sortOrder: seed.sortOrder,
    isActive: true,
  };
}

export class MockAcademicLevelRepository implements AcademicLevelRepository {
  private readonly subject = new SubjectBehavior<AcademicLevelModel[]>(
    LEVEL_SEEDS.map(seedToModel),
  );

  observeAll(): Observable<AcademicLevelModel[]> {
    return this.subject;
  }

  async getByGradeCode(
    gradeCode: GradeLevel,
  ): Promise<Result<AcademicLevelModel | null>> {
    const found = this.subject
      .get()
      .find((l) => l.gradeCode === gradeCode && l.isActive);
    return Ok(found ?? null);
  }
}

export const mockAcademicLevelRepository: AcademicLevelRepository =
  new MockAcademicLevelRepository();
