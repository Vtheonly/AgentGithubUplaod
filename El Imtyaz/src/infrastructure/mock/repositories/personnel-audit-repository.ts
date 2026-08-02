/**
 * Mock personnel, relevé, and audit repositories.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim.
 */
import type {
  PersonnelRepository,
  ReleveRepository,
  AuditRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { SubjectBehavior } from "../subject-behavior";
import type { Personnel, ReleveEntry, ReleveActivity } from "../../../domain/model/personnel";
import type { AuditEntry, AuditLogFilter, AuditLogQueryResult } from "../../../domain/model/audit";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

// ============================================================================
// Personnel
// ============================================================================

export class MockPersonnelRepository implements PersonnelRepository {
  observe(): Observable<Personnel[]> {
    return store.personnel$;
  }
  observeByCategory(category: string): Observable<Personnel[]> {
    return new SubjectBehavior(store.personnel.filter((p) => p.staffCategory === category));
  }
  observeById(id: string): Observable<Personnel | null> {
    return new SubjectBehavior(store.personnel.find((p) => p.id === id) ?? null);
  }
  observeByUserId(userId: string): Observable<Personnel | null> {
    // Iteration 9: returns a SubjectBehavior that re-emits whenever the personnel
    // store changes, so callers stay reactive across mutations.
    const find = () => store.personnel.find((p) => p.userId === userId) ?? null;
    const subject = new SubjectBehavior<Personnel | null>(find());
    // Subscribe to the underlying personnel$ stream to keep this subject fresh.
    store.personnel$.subscribe(() => subject.set(find()));
    return subject;
  }
  async createPersonnel(input: Omit<Personnel, "id" | "tenantId" | "weeklyHoursLogged">): Promise<Result<Personnel>> {
    await delay(200);
    const p: Personnel = {
      ...input,
      id: `per-${String(store.personnel.length + 1).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      weeklyHoursLogged: 0,
    };
    store.personnel.push(p);
    store.notifyPersonnel();
    appendAudit({
      action: AuditActions.PersonnelCreate,
      entityType: "personnel",
      entityId: p.id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(p);
  }
  async updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Result<Personnel>> {
    await delay(180);
    const idx = store.personnel.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Personnel", id));
    const after = { ...store.personnel[idx], ...updates };
    store.personnel[idx] = after;
    store.notifyPersonnel();
    return Ok(after);
  }
  async deletePersonnel(id: string): Promise<Result<void>> {
    await delay(180);
    store.personnel = store.personnel.filter((p) => p.id !== id);
    store.notifyPersonnel();
    return Ok(undefined);
  }
}

// ============================================================================
// Relevé (personnel timesheet)
// ============================================================================

export class MockReleveRepository implements ReleveRepository {
  /**
   * Iteration 6: Returns real seeded relevé entries (previously returned empty).
   */
  observeByPersonnel(personnelId: string, from: string, to: string): Observable<ReleveEntry[]> {
    return new SubjectBehavior(
      store.releve.filter(
        (r) => r.personnelId === personnelId && r.date >= from && r.date <= to,
      ),
    );
  }
  async logEntry(input: {
    personnelId: string;
    personnelName: string;
    date: string;
    hoursIn: number;
    hoursOut: number | null;
    activity: ReleveActivity;
    classId: string | null;
    subjectId: string | null;
  }): Promise<Result<ReleveEntry>> {
    await delay(180);
    const entry: ReleveEntry = { ...input, id: `rel-${Date.now()}`, recordedAt: nowIso() };
    // Iteration 6: persist the entry so the relevé tab shows it.
    store.releve = [entry, ...store.releve];
    store.notifyReleve();
    appendAudit({
      action: AuditActions.ReleveCreate,
      entityType: "releve",
      entityId: entry.id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(entry);
  }
}

// ============================================================================
// Audit (queryable log of all state changes)
// ============================================================================

export class MockAuditRepository implements AuditRepository {
  async query(filter: AuditLogFilter): Promise<Result<AuditLogQueryResult>> {
    await delay(120);
    let rows = [...store.audit];
    if (filter.action) rows = rows.filter((r) => r.action === filter.action);
    if (filter.entityType) rows = rows.filter((r) => r.entityType === filter.entityType);
    if (filter.entityId) rows = rows.filter((r) => r.entityId === filter.entityId);
    if (filter.actorId) rows = rows.filter((r) => r.actorId === filter.actorId);
    if (filter.actorNameContains) {
      const q = filter.actorNameContains.toLowerCase();
      rows = rows.filter((r) => r.actorName.toLowerCase().includes(q));
    }
    if (filter.from) rows = rows.filter((r) => r.at >= filter.from!);
    if (filter.to) rows = rows.filter((r) => r.at <= filter.to!);
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const entries = rows.slice(offset, offset + limit);
    return Ok({ entries, total, hasMore: offset + limit < total });
  }

  async byEntity(entityType: string, entityId: string): Promise<Result<AuditEntry[]>> {
    await delay(80);
    return Ok(store.audit.filter((r) => r.entityType === entityType && r.entityId === entityId));
  }

  async recent(limit = 50): Promise<Result<AuditEntry[]>> {
    await delay(80);
    return Ok(store.audit.slice(0, limit));
  }

  async log(input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    actorName: string;
    tenantId: string;
    diff?: { before?: unknown; after?: unknown } | null;
    note?: string | null;
  }): Promise<Result<AuditEntry>> {
    const entry: AuditEntry = {
      id: `aud-${Date.now()}`,
      tenantId: TENANT_ID,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: input.diff ? JSON.stringify(input.diff) : null,
      note: input.note ?? null,
      ipAddress: "10.0.1.42",
      userAgent: "El-Imtiyaz-Desktop/0.1.0",
      at: nowIso(),
    };
    store.audit.unshift(entry);
    store.notifyAudit();
    return Ok(entry);
  }
}

// ============================================================================
// Singletons — exported for the barrel re-export in `mock-repositories.ts`.
// ============================================================================

export const mockPersonnelRepository: PersonnelRepository = new MockPersonnelRepository();
export const mockReleveRepository: ReleveRepository = new MockReleveRepository();
export const mockAuditRepository: AuditRepository = new MockAuditRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
