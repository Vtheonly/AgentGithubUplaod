/**
 * T-023 — desktop homework + roll-call persistence regression suite
 * (HOMEWORK-100 + ATT-100).
 *
 * Problems covered:
 *  - HOMEWORK-100: `SupabaseHomeworkRepository.push()` omitted `tenant_id`
 *    from the INSERT payload — the canonical `homework` table requires it
 *    (migration 0029) so EVERY desktop homework push failed with a NOT NULL
 *    violation and zero rows were persisted. It also invoked a
 *    non-existent `push-homework-notification` Edge Function with a
 *    swallowed error — a fake side-effect now removed.
 *  - ATT-100: `SupabaseAttendanceRepository.recordRollCall()` was
 *    triple-broken — payload omitted `tenant_id`, omitted the legacy NOT
 *    NULL `date` column, and used a 3-column onConflict matching NO unique
 *    index. Every roll call failed; `attendance_records` never received
 *    desktop rows; parents saw "Aucune absence enregistrée" forever.
 *
 * The fake client captures INSERT/UPSERT payloads and options so the tests
 * assert the exact wire contract PostgREST receives.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseHomeworkRepository,
  SupabaseAttendanceRepository,
} from "../../infrastructure/supabase/repositories/supabase-academic-repository";
import type { AttendanceSession, AttendanceStatus } from "../../domain/model/academic";

// T-053 (TENANT-103): getTenantId() no longer falls back to the demo tenant —
// tests that exercise tenant-scoped repositories set an explicit working
// tenant (the value the old fallback used to inject implicitly).
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});


type Row = Record<string, any>;

interface InsertCapture {
  table: string;
  payload: Row | Row[];
  options?: { onConflict?: string };
}

function homeworkRow(id: string): Row {
  return {
    id,
    tenant_id: "00000000-0000-0000-0000-000000000001",
    class_id: "aaaaaaaa-1111-1111-1111-111111111111",
    subject_id: "bbbbbbbb-2222-2222-2222-222222222222",
    subject_name: "Mathématiques",
    teacher_id: "cccccccc-3333-3333-3333-333333333333",
    teacher_name: "Teacher",
    title: "Devoir maison",
    description: "Exercices 1 à 5",
    due_date: "2026-09-30",
    attachments: [],
    academic_year: "2026-2027",
    acknowledged_count: 0,
    pushed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

function makeHomeworkClient(captures: InsertCapture[]) {
  const homeworkRowData = homeworkRow("hwk-1");
  return {
    from(table: string) {
      const q: any = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        order() {
          return q;
        },
        maybeSingle() {
          if (table === "subjects") {
            return Promise.resolve({ data: { name_fr: "Mathématiques" }, error: null });
          }
          if (table === "academic_years") {
            return Promise.resolve({ data: { code: "2026-2027", label: null }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert(payload: Row) {
          captures.push({ table, payload });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: { ...homeworkRowData, ...payload }, error: null });
                },
              };
            },
          };
        },
        upsert(payload: Row | Row[], options?: { onConflict?: string }) {
          captures.push({ table, payload, options });
          return {
            select() {
              return Promise.resolve({
                data: (Array.isArray(payload) ? payload : [payload]).map((r, i) => ({
                  id: `att-${i}`,
                  ...r,
                })),
                error: null,
              });
            },
          };
        },
      };
      return q;
    },
    functions: {
      invoked: [] as string[],
      invoke(name: string) {
        this.invoked.push(name);
        return Promise.resolve({ error: null });
      },
    },
  } as unknown as SupabaseClient & { functions: { invoked: string[] } };
}

// ============================================================================
// HOMEWORK-100 — push() persists (tenant_id present, dead EF removed)
// ============================================================================

describe("T-023 — SupabaseHomeworkRepository.push() (HOMEWORK-100)", () => {
  it("includes tenant_id in the INSERT payload", async () => {
    const captures: InsertCapture[] = [];
    const client = makeHomeworkClient(captures);
    const repo = new SupabaseHomeworkRepository(client);
    const result = await repo.push({
      classId: "aaaaaaaa-1111-1111-1111-111111111111",
      subjectId: "bbbbbbbb-2222-2222-2222-222222222222",
      teacherId: "cccccccc-3333-3333-3333-333333333333",
      teacherName: "Teacher",
      title: "Devoir maison",
      description: "Exercices 1 à 5",
      dueDate: "2026-09-30",
      attachments: [],
    });
    expect(result.ok).toBe(true);
    const hw = captures.find((c) => c.table === "homework");
    expect(hw).toBeDefined();
    expect((hw!.payload as Row).tenant_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("no longer invokes the non-existent push-homework-notification Edge Function", async () => {
    const captures: InsertCapture[] = [];
    const client = makeHomeworkClient(captures);
    const repo = new SupabaseHomeworkRepository(client);
    const result = await repo.push({
      classId: "aaaaaaaa-1111-1111-1111-111111111111",
      subjectId: "bbbbbbbb-2222-2222-2222-222222222222",
      teacherId: "cccccccc-3333-3333-3333-333333333333",
      teacherName: "Teacher",
      title: "Devoir maison",
      description: "Exercices 1 à 5",
      dueDate: "2026-09-30",
      attachments: [],
    });
    expect(result.ok).toBe(true);
    expect(client.functions.invoked).toEqual([]);
  });
});

// ============================================================================
// ATT-100 — recordRollCall persists (tenant_id + date + canonical onConflict)
// ============================================================================

describe("T-023 — SupabaseAttendanceRepository.recordRollCall() (ATT-100)", () => {
  it("payload carries tenant_id, the legacy NOT NULL date column, and record_date", async () => {
    const captures: InsertCapture[] = [];
    const client = makeHomeworkClient(captures);
    const repo = new SupabaseAttendanceRepository(client);
    const statuses = new Map<string, AttendanceStatus>([
      ["11111111-1111-1111-1111-111111111111", "present"],
      ["22222222-2222-2222-2222-222222222222", "absent_unexcused"],
    ]);
    const result = await repo.recordRollCall({
      classId: "aaaaaaaa-1111-1111-1111-111111111111",
      date: "2026-08-31",
      session: "morning" as AttendanceSession,
      statuses,
      recordedBy: "cccccccc-3333-3333-3333-333333333333",
    });
    expect(result.ok).toBe(true);
    const att = captures.find((c) => c.table === "attendance_records");
    expect(att).toBeDefined();
    const rows = att!.payload as Row[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
      expect(row.date).toBe("2026-08-31");
      expect(row.record_date).toBe("2026-08-31");
    }
  });

  it("upserts against the canonical 4-column unique index (tenant_id, student_id, record_date, session)", async () => {
    const captures: InsertCapture[] = [];
    const client = makeHomeworkClient(captures);
    const repo = new SupabaseAttendanceRepository(client);
    const statuses = new Map<string, AttendanceStatus>([
      ["11111111-1111-1111-1111-111111111111", "late"],
    ]);
    const result = await repo.recordRollCall({
      classId: "aaaaaaaa-1111-1111-1111-111111111111",
      date: "2026-08-31",
      session: "afternoon" as AttendanceSession,
      statuses,
      arrivalTimes: new Map([["11111111-1111-1111-1111-111111111111", "08:20"]]),
      recordedBy: "cccccccc-3333-3333-3333-333333333333",
    });
    expect(result.ok).toBe(true);
    const att = captures.find((c) => c.table === "attendance_records");
    expect(att).toBeDefined();
    expect(att!.options?.onConflict).toBe("tenant_id,student_id,record_date,session");
    const row = (att!.payload as Row[])[0];
    expect(row.arrival_time).toBe("08:20");
  });
});
