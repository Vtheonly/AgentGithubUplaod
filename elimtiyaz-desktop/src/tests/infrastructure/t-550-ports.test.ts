/**
 * T-550 (ARCH-033) — the port-seam verification suite.
 *
 * Three gates, zero runtime change to production code:
 *
 *  1. THE SLOT CENSUS (the runtime half of the exhaustiveness gate): the 54
 *     `Repositories` slots are pinned through a `satisfies readonly (keyof
 *     Repositories)[]` literal — ADDING a slot to `Repositories` without
 *     updating the census fails `npx tsc --noEmit` (the Records stop being
 *     mutually exhaustive); DRIFTING the composite's key set away from the
 *     census fails the runtime equality below.
 *  2. THE FACTORY EXHAUSTIVENESS (the compile half): the Supabase factory
 *     literal carries `satisfies Repositories` — a missing/typo'd slot is a
 *     compile error ON THE LITERAL (the `satisfies` gate itself; its
 *     negative control is a compile-time fact, not a runtime assertion).
 *  3. THE PORTS ARE IMPLEMENTABLE AND BEHAVED: minimal REAL adapters for the
 *     five ports (LOCAL-FIRST-BLUEPRINT §5 shapes) — each adapter exercises
 *     its contract's load-bearing semantics (RPC-shaped execute, the SAME
 *     port bound as the tx parameter, the 0143 keyset pull cursor, the
 *     optional supabase-only CRUD probe, the signed-URL-only storage rule).
 *     No hollow mocks: every adapter is called through and its Result
 *     contract checked.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Repositories } from "../../app/providers/repository-provider";
import { mockRepositories } from "../../infrastructure/mock/mock-composite";
import type {
  AuthPort,
  BackendChange,
  DataBackendPort,
  DiagnosticsPort,
  KeysetCursor,
  PortMediaBucket,
  ReadSpec,
  StoragePort,
  SyncOperation,
  SyncTransportPort,
} from "../../infrastructure/backend/ports";
import { Err, Ok, type Result } from "../../core/result";
import type { Observable } from "../../domain/repository/repository";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";

// ============================================================================
// 1. The slot census — the satisfies-guarded literal + the runtime equality
// ============================================================================

/** The 54 `Repositories` slots (repository-provider.tsx, the T-550 census). */
const REPOSITORY_SLOTS = [
  "auth",
  "userAccounts",
  "parents",
  "students",
  "classes",
  "subjects",
  "grades",
  "attendance",
  "homework",
  "promotion",
  "studentNarratives",
  "classPlacement",
  "promotionCycles",
  "reEnrollment",
  "identityResolution",
  "timetable",
  "academicYears",
  "academicLevels",
  "clubs",
  "psychology",
  "orthophonie",
  "teachers",
  "payments",
  "installments",
  "debt",
  "expenses",
  "personnel",
  "releve",
  "audit",
  "notifications",
  "dashboard",
  "dashboardLayouts",
  "pricing",
  "ledger",
  "workflows",
  "workflowRuns",
  "aiConfig",
  "backups",
  "departments",
  "shifts",
  "schedules",
  "tasks",
  "workforceAttendance",
  "leaveRequests",
  "performanceReviews",
  "chat",
  "onboarding",
  "suppliers",
  "purchaseRequests",
  "deliveries",
  "inventory",
  "warehouseTasks",
  "calendar",
  "overdueAlerts",
] as const;

// THE EXHAUSTIVENESS GATE (compile-time): the census literal must name
// EXACTLY the `Repositories` keys — no more, no less. Both Records are
// keyed maps; `toEqualTypeOf` is mutually invariant, so a slot added to
// `Repositories` without a census update (or vice versa) is a tsc error.
expectTypeOf<Record<(typeof REPOSITORY_SLOTS)[number], true>>().toEqualTypeOf<
  Record<keyof Repositories, true>
>();

describe("T-550 — the 54-slot repository census (ARCH-033)", () => {
  it("the mock composite carries EXACTLY the census slots — no drift, no extras", () => {
    const compositeKeys = Object.keys(mockRepositories).sort();
    const census = [...REPOSITORY_SLOTS].sort();
    expect(compositeKeys).toEqual(census);
  });

  it("the census is pinned at 54 slots (the S24-verified count)", () => {
    expect(REPOSITORY_SLOTS).toHaveLength(54);
    expect(Object.keys(mockRepositories)).toHaveLength(54);
  });
});

// ============================================================================
// 2. The port adapters — the five ports are implementable AND behaved
// ============================================================================

/** Minimal live Observable for the fake adapters (the repository.ts contract). */
class FakeObservable<T> implements Observable<T> {
  private value: T;
  private readonly subscribers = new Set<(value: T) => void>();
  constructor(initial: T) {
    this.value = initial;
  }
  subscribe(fn: (value: T) => void): () => void {
    this.subscribers.add(fn);
    fn(this.value);
    return () => {
      this.subscribers.delete(fn);
    };
  }
  get(): T {
    return this.value;
  }
  set(next: T): void {
    this.value = next;
    for (const fn of this.subscribers) fn(next);
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    email: "admin@elimtiyaz.test",
    displayName: "Admin",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: new Set(),
    accessToken: "token",
    refreshToken: null,
    expiresAt: Date.now() + 60_000,
    locale: "fr",
    ...overrides,
  };
}

/** A REAL in-memory DataBackendPort — tables, an RPC registry, tx binding. */
class FakeDataBackendPort implements DataBackendPort {
  readonly id = "mock" as const;
  private readonly tables = new Map<string, Record<string, unknown>[]>();
  private readonly rpcs = new Map<
    string,
    (args: Record<string, unknown>) => Promise<Result<unknown>>
  >();
  private readonly changeLog: BackendChange[] = [];
  private txDepth = 0;
  private readonly changes$ = new FakeObservable<BackendChange[]>([]);

  constructor() {
    this.tables.set("students", [{ id: "s-1", name: "Étudiant" }]);
  }

  registerRpc(
    name: string,
    fn: (args: Record<string, unknown>) => Promise<Result<unknown>>,
  ): void {
    this.rpcs.set(name, fn);
  }

  /** Test helper: the transaction-reentrancy depth (the nesting contract). */
  currentTxDepth(): number {
    return this.txDepth;
  }

  observe<T>(spec: ReadSpec): Observable<T[]> {
    const rows = (this.tables.get(spec.table) ?? []) as T[];
    return new FakeObservable<T[]>(rows);
  }

  async read<T>(spec: ReadSpec): Promise<T[]> {
    return (this.tables.get(spec.table) ?? []) as T[];
  }

  async execute<T>(op: { rpc: string; args: Record<string, unknown> }): Promise<Result<T>> {
    const fn = this.rpcs.get(op.rpc);
    if (!fn) {
      return Err({ code: "404", message: `rpc not found: ${op.rpc}`, userMessage: "" });
    }
    return (await fn(op.args)) as Result<T>;
  }

  async upsertMany(
    table: string,
    rows: Record<string, unknown>[],
  ): Promise<Result<number>> {
    const existing = this.tables.get(table) ?? [];
    this.tables.set(table, [...existing, ...rows]);
    this.changeLog.push({ table, kind: "insert" });
    return Ok(rows.length);
  }

  async transaction<T>(fn: (tx: DataBackendPort) => Promise<T>): Promise<T> {
    this.txDepth += 1;
    try {
      return await fn(this);
    } finally {
      this.txDepth -= 1;
    }
  }

  changes(): Observable<BackendChange[]> {
    return this.changes$;
  }

  async migrate(target?: number): Promise<Result<{ applied: number }>> {
    return Ok({ applied: target ?? 1 });
  }

  /** Test helper: the change stream got the upsert notification. */
  lastChange(): BackendChange | undefined {
    return this.changeLog.at(-1);
  }
}

describe("T-550 — DataBackendPort contract (the repository seam)", () => {
  it("execute is RPC-SHAPED (name + args) and surfaces the Result honestly", async () => {
    const port = new FakeDataBackendPort();
    port.registerRpc("collect_and_allocate_payment", async (args) =>
      Ok({ receiptId: args.receiptId ?? "r-1" }),
    );
    const result = await port.execute<{ receiptId: string }>({
      rpc: "collect_and_allocate_payment",
      args: { receiptId: "r-9" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.receiptId).toBe("r-9");

    const missing = await port.execute({ rpc: "no_such_rpc", args: {} });
    expect(missing.ok).toBe(false);
  });

  it("transaction binds THE SAME port as the tx parameter (the nesting contract)", async () => {
    const port = new FakeDataBackendPort();
    let txIdentityMatched = false;
    const committed = await port.transaction(async (tx) => {
      txIdentityMatched = tx === port;
      expect(port.currentTxDepth()).toBe(1);
      const up = await tx.upsertMany("students", [{ id: "s-2" }]);
      expect(up.ok).toBe(true);
      return "committed";
    });
    expect(committed).toBe("committed");
    expect(txIdentityMatched).toBe(true);
    expect(port.currentTxDepth()).toBe(0);
    const rows = await port.read<{ id: string }>({ table: "students" });
    expect(rows).toHaveLength(2);
    expect(port.lastChange()?.table).toBe("students");
  });

  it("observe/read honor the Observable contract (subscribe pushes the current value)", async () => {
    const port = new FakeDataBackendPort();
    let observed: unknown;
    const unsubscribe = port
      .observe<{ id: string }>({ table: "students" })
      .subscribe((rows) => {
        observed = rows;
      });
    expect((observed as { id: string }[]).at(0)?.id).toBe("s-1");
    unsubscribe();
    expect(await port.read({ table: "students" })).toHaveLength(1);
  });

  it("migrate is chain-shaped and returns the applied count", async () => {
    const port = new FakeDataBackendPort();
    const applied = await port.migrate(5);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.value.applied).toBe(5);
  });
});

describe("T-550 — AuthPort contract (local identity + admin lifecycle)", () => {
  it("signIn resolves a full Session Result (the repository.ts shape survives)", async () => {
    const port: AuthPort = {
      signIn: async (email, password) =>
        password.length === 0
          ? Err({ code: "401", message: "empty password", userMessage: "" })
          : Ok(makeSession({ email })),
      signOut: async () => Ok(undefined),
      refreshSession: async () => Ok(null),
      changePassword: async () => Ok(undefined),
      createAccount: async () =>
        Ok({ userId: "u-2", email: "new@elimtiyaz.test", generatedPassword: "abc12345" }),
      deleteAccount: async () => Ok(undefined),
      listAccounts: async () =>
        Ok([{ userId: "u-2", email: "new@elimtiyaz.test", role: "admin", active: true }]),
      issueActivationCode: async () => Ok({ code: "AB12CD34" }),
      bindActivationCode: async () => Ok(undefined),
    };
    const ok = await port.signIn("parent@elimtiyaz.test", "secret");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.email).toBe("parent@elimtiyaz.test");
      expect(ok.value.tenantId).toBe("tenant-1");
    }
    const bad = await port.signIn("parent@elimtiyaz.test", "");
    expect(bad.ok).toBe(false);
    const created = await port.createAccount({ email: "x@y.z", role: "admin" });
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.value.generatedPassword).toBeTruthy();
  });
});

describe("T-550 — SyncTransportPort contract (the 0143 keyset is kept verbatim)", () => {
  it("pull is KEYSET-shaped: the (updated_at, id) cursor pages deterministically", async () => {
    const log: Array<{ updated_at: string; id: string; op: SyncOperation }> = [
      { updated_at: "2026-11-21T10:00:00Z", id: "a", op: "insert" },
      { updated_at: "2026-11-21T10:00:01Z", id: "b", op: "update" },
      { updated_at: "2026-11-21T10:00:02Z", id: "c", op: "delete" },
    ];
    const port: SyncTransportPort = {
      push: async () => Ok({ acks: [{ id: "a", seq: 1 }] }),
      pull: async (cursor: KeysetCursor, limit?: number) => {
        const start = log.findIndex((entry) => entry.id === cursor.id) + 1;
        const slice = log.slice(start, start + (limit ?? 2));
        const next = slice.at(-1);
        return Ok({
          ops: slice.map((entry) => entry.op),
          next: next
            ? { updated_at: next.updated_at, id: next.id }
            : undefined,
        });
      },
      onRemoteChange: () => () => undefined,
      status: () => new FakeObservable<"online" | "offline" | "degraded">("online"),
    };
    const page1 = await port.pull({ updated_at: "2026-11-21T10:00:00Z", id: "a" }, 2);
    expect(page1.ok).toBe(true);
    if (page1.ok) {
      expect(page1.value.ops).toEqual(["update", "delete"]);
      expect(page1.value.next).toEqual({ updated_at: "2026-11-21T10:00:02Z", id: "c" });
    }
    const page2 = await port.pull({ updated_at: "2026-11-21T10:00:02Z", id: "c" });
    expect(page2.ok).toBe(true);
    if (page2.ok) expect(page2.value.ops).toEqual([]);
  });

  it("push is idempotent-shaped (acks carry the id + the relay sequence)", async () => {
    const port: SyncTransportPort = {
      push: async () => Ok({ acks: [{ id: "op-1", seq: 7 }] }),
      pull: async () => Ok({ ops: [] }),
      onRemoteChange: () => () => undefined,
      status: () => new FakeObservable<"online" | "offline" | "degraded">("degraded"),
    };
    const ack = await port.push(["insert", "delete"]);
    expect(ack.ok).toBe(true);
    if (ack.ok) expect(ack.value.acks[0]).toEqual({ id: "op-1", seq: 7 });
    expect(port.status().get()).toBe("degraded");
  });

  it("onRemoteChange registers and unregisters the invalidation bus", () => {
    let stream: string[] = [];
    const port: SyncTransportPort = {
      push: async () => Ok({ acks: [] }),
      pull: async () => Ok({ ops: [] }),
      onRemoteChange: (cb) => {
        stream = ["students"];
        cb({ streams: stream });
        return () => {
          stream = [];
        };
      },
      status: () => new FakeObservable<"online" | "offline" | "degraded">("offline"),
    };
    let notified: { streams: string[] } | undefined;
    const off = port.onRemoteChange((n) => {
      notified = n;
    });
    expect(notified?.streams).toEqual(["students"]);
    off();
    expect(stream).toEqual([]);
    expect(port.status().get()).toBe("offline");
  });
});

describe("T-550 — StoragePort contract (the 0018 vault rules)", () => {
  it("uploads name PRIVATE buckets and the signed URL is fresh per display", async () => {
    const uploads: Array<{ bucket: PortMediaBucket; path: string }> = [];
    const port: StoragePort = {
      uploadPrivateMedia: async (params) => {
        uploads.push({ bucket: params.bucket, path: `${params.tenantId}/${params.entityId}/f` });
        return Ok({
          path: `${params.tenantId}/${params.entityId}/f`,
          bucket: params.bucket,
          sizeBytes: 3,
          contentType: "image/png",
        });
      },
      freshSignedMediaUrl: async () => Ok(`signed-${Date.now()}-${Math.random()}`),
      listMedia: async () =>
        Ok({
          buckets: [
            { id: "payment-proofs", private: true },
            { id: "student-documents", private: true },
          ],
        }),
    };
    const up = await port.uploadPrivateMedia({
      bucket: "payment-proofs",
      entityId: "p-1",
      tenantId: "t-1",
      file: new File(["abc"], "receipt.png", { type: "image/png" }),
    });
    expect(up.ok).toBe(true);
    if (up.ok) {
      expect(up.value.bucket).toBe("payment-proofs");
      expect(up.value.path.startsWith("t-1/p-1/")).toBe(true);
    }
    expect(uploads).toHaveLength(1);
    const first = await port.freshSignedMediaUrl({ bucket: "payment-proofs", path: "t-1/p-1/f" });
    const second = await port.freshSignedMediaUrl({ bucket: "payment-proofs", path: "t-1/p-1/f" });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.value).not.toBe(second.value);
    const census = await port.listMedia();
    if (census.ok) {
      for (const bucket of census.value.buckets) expect(bucket.private).toBe(true);
    }
  });
});

describe("T-550 — DiagnosticsPort contract (the Settings door)", () => {
  it("describes the backend, probes reads, and the CRUD probe is OPTIONAL (absent locally)", async () => {
    const localDiagnostics: DiagnosticsPort = {
      describeBackend: () => ({ kind: "local-pglite", writable: true }),
      runReadProbe: async (table) => Ok({ rows: table === "students" ? 1 : 0, ms: 3 }),
      // NO runCrudProbe — absent in local mode by contract
    };
    expect(localDiagnostics.describeBackend().kind).toBe("local-pglite");
    expect(localDiagnostics.runCrudProbe).toBeUndefined();
    const probe = await localDiagnostics.runReadProbe("students");
    expect(probe.ok).toBe(true);
    if (probe.ok) expect(probe.value.rows).toBe(1);

    const supabaseDiagnostics: DiagnosticsPort = {
      ...localDiagnostics,
      describeBackend: () => ({ kind: "supabase-relay", writable: true, lastCheck: "2026-11-21" }),
      runCrudProbe: async () => Ok({ ok: true as const }),
    };
    expect(supabaseDiagnostics.describeBackend().kind).toBe("supabase-relay");
    expect(supabaseDiagnostics.runCrudProbe).toBeDefined();
    if (supabaseDiagnostics.runCrudProbe) {
      const crud = await supabaseDiagnostics.runCrudProbe("students");
      expect(crud.ok).toBe(true);
    }
  });
});
