/**
 * T-299 (OFFLINE-400) — the realtime attributed-activity broadcast suite.
 *
 * Pins:
 *   1. the attributed sentence formatter (the mandate's "Actor (Role)
 *      action · target" — with role, without role, long-id truncation);
 *   2. the mock repository emits on `log()` (mock-mode realtime parity);
 *   3. the Supabase repository arms the audit_logs INSERT subscription on
 *      first subscribe and maps an incoming postgres_changes payload to
 *      the attributed event (actor_name/actor_role/actor_id/action/
 *      entity_type/entity_id — the denormalized columns, no joins);
 *   4. the toaster's self-suppression (the local actor's own writes are
 *      not toasted) and its wiring into the topbar;
 *   5. migration 0085 adds audit_logs to the realtime publication WITHOUT
 *      touching any RLS policy (the documented security design).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatAttributedActivity,
  type AttributedActivityEvent,
} from "../../domain/model/audit";
import { MockAuditRepository } from "../../infrastructure/mock/repositories/personnel-audit-repository";
import { SupabaseAuditLogRepository } from "../../infrastructure/supabase/repositories/supabase-audit-log-repository";
import type { SupabaseClient } from "@supabase/supabase-js";

const ROOT = join(__dirname, "../../..");

// ============================================================================
// 1. The attributed sentence
// ============================================================================

describe("T-299 — formatAttributedActivity (the mandate's sentence)", () => {
  const event: AttributedActivityEvent = {
    actorName: "Yacine Benali",
    actorRole: "finance",
    actorId: "acc-9f2a",
    action: "payment.status_changed",
    entityType: "payment",
    entityId: "0192f0aa-1111-4222-8333-444455556666",
    occurredAt: new Date().toISOString(),
  };

  it("renders 'Name (Role) — action · entity shortId' with the role", () => {
    const { title, body } = formatAttributedActivity(event);
    expect(title).toBe("Activité — Yacine Benali (finance)");
    expect(body).toBe(
      "Yacine Benali (finance) — payment.status_changed · payment 0192f0aa…",
    );
  });

  it("omits the parenthesis when the role is null (no fabricated role)", () => {
    const { title, body } = formatAttributedActivity({ ...event, actorRole: null });
    expect(title).toBe("Activité — Yacine Benali");
    expect(body).toBe("Yacine Benali — payment.status_changed · payment 0192f0aa…");
  });

  it("renders the System fallback for an empty actor name", () => {
    const { body } = formatAttributedActivity({ ...event, actorName: "", actorRole: null });
    expect(body).toBe("Système — payment.status_changed · payment 0192f0aa…");
  });

  it("short ids pass through untouched; an empty id renders the dash", () => {
    const short = formatAttributedActivity({ ...event, entityId: "PAR-2026-A12" });
    expect(short.body).toContain("payment PAR-2026-A12");
    const none = formatAttributedActivity({ ...event, entityId: "" });
    expect(none.body).toContain("payment —");
  });
});

// ============================================================================
// 2. The mock repository's realtime parity
// ============================================================================

describe("T-299 — MockAuditRepository.observeActivity", () => {
  it("emits one attributed event per log() call", async () => {
    const repo = new MockAuditRepository();
    const events: AttributedActivityEvent[] = [];
    const unsub = repo.observeActivity().subscribe((e) => events.push(e));

    await repo.log({
      action: "payment.status_changed",
      entityType: "payment",
      entityId: "pay-001",
      actorId: "u-1",
      actorName: "Yacine Benali",
      actorRole: "finance",
      tenantId: "t-1",
      diff: null,
      note: null,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorName: "Yacine Benali",
      actorRole: "finance",
      actorId: "u-1",
      action: "payment.status_changed",
      entityType: "payment",
      entityId: "pay-001",
    });
    unsub();
  });
});

// ============================================================================
// 3. The Supabase repository's realtime subscription
// ============================================================================

/** Channel-capturing stub (the t-099 chat-repository pattern). */
class RealtimeCapturingClient {
  readonly channels: string[] = [];
  handlers: Array<(payload: { new: Record<string, unknown> | null }) => void> = [];

  channel(name: string): {
    on: (
      _event: string,
      _filter: Record<string, unknown>,
      cb: (payload: { new: Record<string, unknown> | null }) => void,
    ) => { subscribe: () => void };
    subscribe: () => void;
  } {
    this.channels.push(name);
    const registerHandler = (cb: (payload: { new: Record<string, unknown> | null }) => void) => {
      this.handlers.push(cb);
    };
    const builder: {
      on: (
        _event: string,
        _filter: Record<string, unknown>,
        cb: (payload: { new: Record<string, unknown> | null }) => void,
      ) => { subscribe: () => void };
      subscribe: () => void;
    } = {
      on: (_event, _filter, cb) => {
        registerHandler(cb);
        return builder;
      },
      subscribe: () => undefined,
    };
    return builder;
  }
}

describe("T-299 — SupabaseAuditLogRepository realtime", () => {
  it("arms the audit_logs INSERT subscription on first subscribe (once)", () => {
    const fake = new RealtimeCapturingClient();
    const repo = new SupabaseAuditLogRepository(fake as unknown as SupabaseClient);
    repo.observeActivity().subscribe(() => undefined)();
    repo.observeActivity().subscribe(() => undefined)();
    expect(fake.channels).toEqual(["desktop-audit-realtime"]);
    expect(fake.handlers).toHaveLength(1); // armed ONCE, not per subscription
  });

  it("maps an INSERT payload to the attributed event (denormalized columns, no joins)", () => {
    const fake = new RealtimeCapturingClient();
    const repo = new SupabaseAuditLogRepository(fake as unknown as SupabaseClient);
    const events: AttributedActivityEvent[] = [];
    repo.observeActivity().subscribe((e) => events.push(e));

    expect(fake.handlers).toHaveLength(1);
    fake.handlers[0]({
      new: {
        id: "aud-1",
        actor_name: "Yacine Benali",
        actor_role: "financial_officer",
        actor_id: "11111111-1111-4111-8111-111111111111",
        action: "payment.status_changed",
        entity_type: "payment",
        entity_id: "0192f0aa-1111-4222-8333-444455556666",
        occurred_at: "2026-09-11T12:00:00Z",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      actorName: "Yacine Benali",
      actorRole: "financial_officer",
      actorId: "11111111-1111-4111-8111-111111111111",
      action: "payment.status_changed",
      entityType: "payment",
      entityId: "0192f0aa-1111-4222-8333-444455556666",
      occurredAt: "2026-09-11T12:00:00Z",
    });
  });

  it("a null payload row emits nothing (malformed events are dropped)", () => {
    const fake = new RealtimeCapturingClient();
    const repo = new SupabaseAuditLogRepository(fake as unknown as SupabaseClient);
    const events: AttributedActivityEvent[] = [];
    repo.observeActivity().subscribe((e) => events.push(e));
    fake.handlers[0]({ new: null });
    expect(events).toHaveLength(0);
  });
});

// ============================================================================
// 4. The toaster wiring
// ============================================================================

describe("T-299 — the toaster surface", () => {
  it("is mounted in the topbar next to the sync indicator", () => {
    const topbar = readFileSync(join(ROOT, "src/shared/layout/topbar.tsx"), "utf8");
    expect(topbar).toContain("<AuditActivityToaster />");
    expect(topbar).toContain("<SyncIndicator />");
  });

  it("subscribes once and unsubscribes on unmount", () => {
    const toaster = readFileSync(join(ROOT, "src/shared/layout/audit-activity-toaster.tsx"), "utf8");
    expect(toaster).toContain("observeActivity().subscribe");
    expect(toaster).toContain("return unsub");
    // Self-suppression: the local actor's own writes are not toasted.
    expect(toaster).toContain("event.actorId === sessionRef.current.userId");
  });
});

// ============================================================================
// 5. Migration 0085 — publication membership, NO RLS change
// ============================================================================

describe("T-299 — migration 0085 (the realtime publication)", () => {
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/0085_audit_logs_realtime_publication.sql"),
    "utf8",
  );

  it("adds audit_logs to the supabase_realtime publication (idempotent guard)", () => {
    expect(sql).toContain("alter publication supabase_realtime add table public.audit_logs");
    expect(sql).toContain("pg_publication_tables");
  });

  it("touches NO RLS policy (the security design — RLS still gates the stream)", () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).not.toMatch(/alter table[^;]*enable row level security/i);
    expect(sql).not.toMatch(/security definer/i);
  });

  it("needs no REPLICA IDENTITY change (append-only table — INSERT events only)", () => {
    // Guard the DDL, not prose (the header COMMENT explains why there is none).
    expect(sql).not.toMatch(/alter table[^;]*replica identity/i);
  });
});

// ============================================================================
// 6. The Android half (source-scan parity guards — the JUnit suites pin
//    the behavior on the Android side; these guards pin the WIRING's
//    existence so neither platform silently loses the route).
// ============================================================================

describe("T-299 — the Android mirror wiring (source guards)", () => {
  const androidRepo = join(ROOT, "../../../elimtiyaz-android");

  function readAndroid(rel: string): string | null {
    try {
      return readFileSync(join(androidRepo, rel), "utf8");
    } catch {
      return null; // The Android repo may not be checked out as a sibling.
    }
  }

  it("routes audit_logs events to pullAudits in RealtimeSyncManager", () => {
    const src = readAndroid("app/src/main/java/com/example/infrastructure/sync/RealtimeSyncManager.kt");
    if (!src) return; // sibling-repo guard (documented no-op when absent)
    expect(src).toContain("\"audit_logs\" to listOf");
    expect(src).toContain("pullAudits()");
  });

  it("pullAudits decodes into the Room audit cache (before/after + role survive)", () => {
    const src = readAndroid("app/src/main/java/com/example/infrastructure/sync/PullSyncRepository.kt");
    if (!src) return;
    expect(src).toContain("from(\"audit_logs\")");
    expect(src).toContain("db.auditLogDao().upsertAll");
    expect(src).toContain("AuditLogDto");
  });
});
