/**
 * Mock ParentRepository — in-memory CRUD for parents with reactive observation.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including the iteration 6 logic
 * for deriving `transportDestination` from `cityTier` when not explicitly
 * provided.
 */
import type {
  ParentRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { deterministicParentCode } from "../../../core/format/id";
import { derived } from "../subject-behavior";
import type {
  Parent,
  CreateParentInput,
  UpdateParentInput,
  TransportDestination,
} from "../../../domain/model/parent";
import { cityTierToDestination } from "../../../domain/model/parent";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

export class MockParentRepository implements ParentRepository {
  observe(): Observable<Parent[]> {
    return store.parents$;
  }

  observeById(id: string): Observable<Parent | null> {
    // FIX (reactivity): derive from the store stream so the parent drawer
    // reflects edits made after the drawer was mounted.
    return derived([store.parents$], () => store.parents.find((p) => p.id === id) ?? null);
  }

  async search(query: string): Promise<Result<Parent[]>> {
    await delay(120);
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...store.parents]);
    return Ok(
      store.parents.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.phone} ${p.code}`.toLowerCase().includes(q),
      ),
    );
  }

  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    await delay(200);
    const year = new Date().getFullYear();
    // FIX (id collisions): max-seq allocation instead of `length + 1`.
    const seq = nextParentSeq();
    // Iteration 6: derive transportDestination from cityTier if not explicitly provided.
    const transportDestination: TransportDestination | null =
      input.transportDestination ?? cityTierToDestination(input.cityTier) ?? null;
    // T-018 mock alignment (19th session, migration 0065): the server CREATE
    // path (batch_register_family) is now DETERMINISTIC — the mock used to
    // mirror 0022's gen_random_bytes via randomParentSuffix(), a DEAD server
    // behavior since 0065. The mock now derives the SAME canonical code the
    // server would (identity fields, trimmed, empty-dropped, joined '|'), and
    // REFUSES duplicate identities exactly like the server's unique
    // (tenant_id, parent_code) constraint (the idempotency gate).
    const displayName = input.displayName ?? `${input.firstName} ${input.lastName}`.trim();
    const code = deterministicParentCode(year, {
      phone: input.phone,
      displayName,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    if (store.parents.some((p) => p.code === code)) {
      return Err(
        Errors.conflict(
          `Un parent avec la même identité existe déjà (code ${code}) — le code canonique est déterministe (migration 0065)`,
        ),
      );
    }
    const parent: Parent = {
      id: `par-${String(seq).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      code,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: input.displayName ?? `${input.firstName} ${input.lastName}`.trim(),
      gender: input.gender,
      phone: input.phone,
      whatsapp: input.whatsapp ?? null,
      email: input.email ?? null,
      occupation: input.occupation ?? null,
      address: input.address ?? null,
      cityTier: input.cityTier ?? null,
      transportDestination,
      preferredLanguage: input.preferredLanguage ?? "fr",
      avatarUrl: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.parents.unshift(parent);
    store.notifyParents();
    appendAudit({
      action: AuditActions.ParentCreate,
      entityType: "parent",
      entityId: parent.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: {
        before: null,
        after: { code: parent.code, name: `${parent.firstName} ${parent.lastName}` },
      },
    });
    return Ok(parent);
  }

  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    await delay(180);
    const idx = store.parents.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Parent", id));
    const before = store.parents[idx];
    const after: Parent = { ...before, ...updates, updatedAt: nowIso() };
    store.parents[idx] = after;
    store.notifyParents();
    appendAudit({
      action: AuditActions.ParentUpdate,
      entityType: "parent",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after },
    });
    return Ok(after);
  }

  async deleteParent(id: string): Promise<Result<void>> {
    await delay(180);
    if (store.students.some((s) => s.parentId === id)) {
      return Err(Errors.conflict("Cannot delete parent with linked students"));
    }
    const before = store.parents.find((p) => p.id === id);
    store.parents = store.parents.filter((p) => p.id !== id);
    store.notifyParents();
    appendAudit({
      action: AuditActions.ParentDelete,
      entityType: "parent",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after: null },
    });
    return Ok(undefined);
  }
}

/**
 * Max-seq id allocation — avoids reusing ids after deletions.
 * Scans `par-XXX` ids and returns max(seq) + 1 (min 1).
 */
function nextParentSeq(): number {
  let max = 0;
  for (const p of store.parents) {
    const m = /^par-(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Singleton instance — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockParentRepository: ParentRepository = new MockParentRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
