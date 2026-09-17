/**
 * T-393 — the deterministic Supabase diagnostics screen (handed-over Task 21).
 *
 * What this suite pins:
 *
 *   A. The RUNNER (pure logic, mocked client — no network):
 *      - the healthy authenticated run: 18 checks, the ordered category
 *        sequence, every probe PASS;
 *      - the AUTH-302 signature: a domain session present while the SDK
 *        session is gone → auth.sdk-session FAIL + the domain-vs-sdk
 *        cross-check FAIL with the operator instruction;
 *      - mock mode / unconfigured client: per-category NON TESTÉ rows,
 *        zero network calls;
 *      - honest failure shapes: network error, RLS 42501, tenant
 *        resolution null, storage permission-denied → NON TESTÉ,
 *        realtime timeout;
 *      - SAFETY: no token ever appears in the report or its text form.
 *
 *   B. The VIEW (injected fake runner + fake client):
 *      - the run button invokes the runner with the canonical client +
 *        the domain session;
 *      - the PASS/FAIL/NON TESTÉ matrix + the AUTH-302 warning banner
 *        render;
 *      - the OPS-317 seed-diagnostics card renders the recorded
 *        degradation reason (the empty-list explainer).
 *
 * Run:
 *   npx vitest run src/tests/features/t-393-supabase-diagnostics.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runSupabaseDiagnostics,
  expectedCheckCount,
  formatDiagnosticsReportText,
} from "../../features/settings/supabase-diagnostics/diagnostics-runner";
import type { DiagnosticsReport, DiagnosticsRunOptions } from "../../features/settings/supabase-diagnostics/diagnostics-types";
import { SupabaseDiagnosticsTab } from "../../features/settings/supabase-diagnostics/supabase-diagnostics-tab";
import {
  SupabaseParentRepository,
  getSeedDiagnostics,
  __resetSeedDiagnosticsForTests,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

/* ------------------------------------------------------------------ */
/* The view needs useAuth — mock the provider (the t-384 pattern).     */
/* ------------------------------------------------------------------ */

const mockAuthSession: { userId: string; email: string } | null = {
  userId: "user-1",
  email: "admin@elimtiyaz.dz",
};
vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockAuthSession }),
}));

/* ================================================================== */
/* Mock client factory                                                 */
/* ================================================================== */

type SupabaseErrorShape = { code?: string | number; message?: string } | null;

interface MockClientOptions {
  sdkSession?: { expires_at?: number } | null;
  user?: { id: string; email: string } | null;
  getUserError?: SupabaseErrorShape;
  profiles?: Array<{ id: string; tenant_id: string | null; display_name?: string | null }>;
  tenantId?: string | null;
  profileId?: string | null;
  roles?: string[];
  tableCounts?: Record<string, number>;
  selectError?: SupabaseErrorShape;
  networkError?: boolean;
  buckets?: Array<{ name: string }> | null;
  bucketsError?: SupabaseErrorShape;
  realtimeStatus?: "SUBSCRIBED" | "TIMED_OUT" | "CHANNEL_ERROR" | "NEVER";
}

function makeMockClient(opts: MockClientOptions = {}): {
  client: SupabaseClient;
  calls: { from: string[]; rpc: string[]; storage: number; realtime: number };
} {
  const calls: { from: string[]; rpc: string[]; storage: number; realtime: number } = {
    from: [],
    rpc: [],
    storage: 0,
    realtime: 0,
  };
  const tableCounts = opts.tableCounts ?? {};

  const selectBuilder = (table: string, columns: string, selectOpts?: { count?: string; head?: boolean }) => {
    // head+count shape: the select() result itself is the awaitable.
    if (selectOpts?.head) {
      void columns;
      return Promise.resolve({
        count: tableCounts[table] ?? 0,
        data: null,
        error: opts.selectError ?? null,
      });
    }
    // Chained shape: .select(cols).limit(n) — the limit result is awaitable.
    return {
      limit: (n: number) => {
        void n;
        if (table === "user_profiles") {
          return Promise.resolve({ data: opts.profiles ?? [], error: opts.selectError ?? null });
        }
        return Promise.resolve({
          data: opts.networkError ? null : [],
          error: opts.networkError
            ? { message: "TypeError: fetch failed", code: "network" }
            : (opts.selectError ?? null),
        });
      },
    };
  };

  const client = {
    from: (table: string) => {
      calls.from.push(table);
      return {
        select: (columns: string, selectOpts?: { count?: string; head?: boolean }) =>
          selectBuilder(table, columns, selectOpts),
      };
    },
    rpc: (name: string) => {
      calls.rpc.push(name);
      const data =
        name === "current_tenant_id"
          ? (opts.tenantId ?? null)
          : name === "current_user_profile_id"
            ? (opts.profileId ?? null)
            : name === "current_user_roles"
              ? (opts.roles ?? [])
              : null;
      return Promise.resolve({ data, error: null });
    },
    auth: {
      getSession: async () => ({
        data: { session: opts.sdkSession === undefined ? { expires_at: Math.floor(Date.now() / 1000) + 3600 } : opts.sdkSession },
        error: null,
      }),
      getUser: async () => ({
        data: { user: opts.getUserError ? null : (opts.user ?? { id: "user-1", email: "admin@el-imtiyaz.dz" }) },
        error: opts.getUserError ?? null,
      }),
    },
    storage: {
      listBuckets: async () => {
        calls.storage += 1;
        return { data: opts.bucketsError ? null : (opts.buckets ?? []), error: opts.bucketsError ?? null };
      },
    },
    channel: (name: string) => {
      void name;
      calls.realtime += 1;
      const status = opts.realtimeStatus ?? "SUBSCRIBED";
      return {
        on: (event: string, chanOpts: unknown, cb: () => void) => {
          void event;
          void chanOpts;
          void cb;
          return { subscribe: () => ({}) };
        },
        subscribe: (cb: (status: string) => void) => {
          if (status === "NEVER") return {};
          // emit asynchronously like the real SDK
          setTimeout(() => cb(status), 1);
          return {};
        },
        unsubscribe: async () => {
          /* best-effort cleanup in the mock too */
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const HEALTHY: MockClientOptions = {
  sdkSession: { expires_at: Math.floor(Date.now() / 1000) + 3600 },
  user: { id: "a148fe34-0000-0000-0000-000000000001", email: "admin@elimtiyaz.dz" },
  profiles: [{ id: "42e369e9-0000-0000-0000-000000000001", tenant_id: "00000000-0000-0000-0000-000000000001" }],
  tenantId: "00000000-0000-0000-0000-000000000001",
  profileId: "42e369e9-0000-0000-0000-000000000001",
  roles: ["super_admin"],
  tableCounts: { parents: 3, students: 2, classes: 0, payments: 4, payment_allocations: 5, attendance_records: 0, personnel: 0 },
  buckets: [{ name: "student-documents" }],
  realtimeStatus: "SUBSCRIBED",
};

/* ================================================================== */
/* A. The runner                                                       */
/* ================================================================== */

describe("T-393 A. diagnostics-runner — the deterministic probe sequence", () => {
  it("healthy authenticated run: 18 checks, every probe PASS, the ordered category sequence", async () => {
    const { client } = makeMockClient(HEALTHY);
    const report = await runSupabaseDiagnostics({
      client,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 500,
    });

    expect(report.checks).toHaveLength(expectedCheckCount()); // 18
    expect(report.summary).toEqual({ pass: 18, fail: 0, notTested: 0 });
    // The deterministic category order.
    const categories = [...new Set(report.checks.map((c) => c.category))];
    expect(categories).toEqual([
      "Configuration",
      "Réseau",
      "Authentification",
      "Résolution du tenant",
      "RPC serveur",
      "RLS — lectures",
      "Stockage",
      "Temps réel",
    ]);
    // The RLS matrix covers the 7 handed-over tables with row counts.
    const rls = report.checks.filter((c) => c.category === "RLS — lectures");
    expect(rls.map((c) => c.id)).toEqual([
      "parents", "students", "classes", "payments", "payment_allocations", "attendance_records", "personnel",
    ]);
    expect(rls.find((c) => c.id === "parents")?.detail).toContain("3 ligne(s)");
    // Config describes the canonical project WITHOUT the key.
    const config = report.checks[0];
    expect(config.status).toBe("pass");
    expect(config.detail).toContain("vebfehrpzajhstyhinnw.supabase.co");
    expect(config.detail).toContain("publishable");
  });

  it("the AUTH-302 signature: domain session present + SDK session gone → the two auth FAILs with the operator instruction", async () => {
    const { client } = makeMockClient({
      ...HEALTHY,
      sdkSession: null, // the SDK store is EMPTY
      getUserError: { message: "User from sub claim in JWT does not exist", code: 404 },
      profiles: [], // anon read: RLS filters to 0 rows
      tenantId: null,
      profileId: null,
      roles: [],
      tableCounts: {},
    });
    const report = await runSupabaseDiagnostics({
      client,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 500,
    });

    const sdkSession = report.checks.find((c) => c.id === "auth.sdk-session");
    expect(sdkSession?.status).toBe("fail");
    expect(sdkSession?.detail).toContain("anonyme");

    const cross = report.checks.find((c) => c.id === "auth.domain-vs-sdk");
    expect(cross?.status).toBe("fail");
    expect(cross?.detail).toContain("AUTH-302");

    // Anon RLS reads stay PASS (reachable + RLS-correct) with the honest zero note.
    const parents = report.checks.find((c) => c.id === "parents");
    expect(parents?.status).toBe("pass");
    expect(parents?.detail).toContain("0 ligne(s) visible(s)");

    // Tenant resolution + RPCs fail honestly (null results, not errors).
    expect(report.checks.find((c) => c.id === "tenant.id-rpc")?.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "rpc.roles")?.status).toBe("fail");
  });

  it("unconfigured client / mock mode: per-category NON TESTÉ rows and ZERO network calls", async () => {
    const report = await runSupabaseDiagnostics({
      client: null,
      domainSession: null,
    });

    expect(report.checks[0].status).toBe("pass"); // the config describe still works
    const notTested = report.checks.filter((c) => c.status === "not_tested");
    expect(notTested).toHaveLength(7); // one per networked category
    expect(report.summary.fail).toBe(0);
    expect(notTested.every((c) => c.detail.includes("non exécutée") || c.detail.includes("non configuré"))).toBe(true);
  });

  it("network failure: the REST probe fails with the classified message, later probes still run", async () => {
    const { client } = makeMockClient({ ...HEALTHY, networkError: true, realtimeStatus: "TIMED_OUT" });
    const report = await runSupabaseDiagnostics({
      client,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 100,
    });

    const network = report.checks.find((c) => c.id === "network.rest");
    expect(network?.status).toBe("fail");
    expect(network?.detail).toContain("fetch failed");

    // The run did not abort — every check still has an honest result.
    expect(report.checks).toHaveLength(expectedCheckCount());
    const realtime = report.checks.find((c) => c.id === "realtime.channel");
    expect(realtime?.status).toBe("fail");
    expect(realtime?.detail).toContain("TIMED_OUT");
  });

  it("RLS read error: FAIL with the exact code and the table operation", async () => {
    const { client } = makeMockClient({
      ...HEALTHY,
      tableCounts: {},
      selectError: { code: "42501", message: "permission denied for table students" },
    });
    const report = await runSupabaseDiagnostics({
      client,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 500,
    });
    const students = report.checks.find((c) => c.id === "students");
    expect(students?.status).toBe("fail");
    expect(students?.detail).toContain("42501");
    expect(students?.detail).toContain("SELECT students");
  });

  it("storage permission-denied → NON TESTÉ (service-role by design); reachable buckets → PASS", async () => {
    const { client: denied } = makeMockClient({
      ...HEALTHY,
      bucketsError: { code: "42501", message: "permission denied for schema storage" },
    });
    const deniedReport = await runSupabaseDiagnostics({
      client: denied,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 500,
    });
    const storageDenied = deniedReport.checks.find((c) => c.id === "storage.buckets");
    expect(storageDenied?.status).toBe("not_tested");

    const { client: ok } = makeMockClient(HEALTHY);
    const okReport = await runSupabaseDiagnostics({
      client: ok,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 500,
    });
    const storageOk = okReport.checks.find((c) => c.id === "storage.buckets");
    expect(storageOk?.status).toBe("pass");
    expect(storageOk?.detail).toContain("1 bucket");
  });

  it("SAFETY: no token or key material ever appears in the report or its text form", async () => {
    const { client } = makeMockClient(HEALTHY);
    const report = await runSupabaseDiagnostics({
      client,
      domainSession: { userId: "user-1", email: "admin@elimtiyaz.dz" },
      realtimeTimeoutMs: 500,
    });
    const text = formatDiagnosticsReportText(report);
    const allDetails = report.checks.map((c) => `${c.label} ${c.detail}`).join("\n");

    expect(allDetails).not.toContain("sb_publishable_");
    expect(allDetails).not.toContain("eyJ"); // JWT prefix
    expect(text).not.toContain("sb_publishable_");
    expect(text).not.toContain("eyJ");
    // The text form carries the summary + every check line.
    expect(text).toContain("Résumé : 18 PASS / 0 FAIL / 0 NON TESTÉ");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(18);
  });
});

/* ================================================================== */
/* B. The view                                                         */
/* ================================================================== */

describe("T-393 B. SupabaseDiagnosticsTab — the PASS/FAIL/NON TESTÉ matrix view", () => {
  beforeEach(() => {
    __resetSeedDiagnosticsForTests();
  });
  afterEach(() => {
    cleanup();
    __resetSeedDiagnosticsForTests();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function makeReport(partial: Partial<DiagnosticsReport>): DiagnosticsReport {
    return {
      ranAt: Date.parse("2026-09-18T12:00:00Z"),
      checks: [],
      summary: { pass: 0, fail: 0, notTested: 0 },
      ...partial,
    } as DiagnosticsReport;
  }

  function renderTab(
    runner: (opts: DiagnosticsRunOptions) => Promise<DiagnosticsReport>,
    client: SupabaseClient | null = {} as unknown as SupabaseClient,
  ) {
    return render(
      <SupabaseDiagnosticsTab runDiagnostics={runner} getClient={() => client} />,
    );
  }

  it("renders the run button + the safety banner, and the runner receives the injected client", async () => {
    const healthyRunner: (opts: DiagnosticsRunOptions) => Promise<DiagnosticsReport> =
      async () =>
        makeReport({
          checks: [],
          summary: { pass: 18, fail: 0, notTested: 0 },
        });
    const runner = vi.fn(healthyRunner);
    const fakeClient = { marker: true } as unknown as SupabaseClient;

    renderTab(runner, fakeClient);
    fireEvent.click(screen.getByRole("button", { name: "Lancer le diagnostic" }));

    await waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });
    expect(runner.mock.calls[0][0].client).toBe(fakeClient);
    expect(
      screen.getByText(/Aucune clé, jeton ou secret n'est collecté/i),
    ).toBeTruthy();
  });

  it("renders the PASS/FAIL/NON TESTÉ badges + the AUTH-302 warning banner when failures exist", async () => {
    const report = makeReport({
      checks: [
        {
          id: "auth.sdk-session",
          category: "Authentification",
          label: "Session Supabase (auth.getSession)",
          status: "fail",
          detail: "AUCUNE session Supabase (JWT absent) — chaque appel REST part en rôle anonyme.",
          durationMs: 3,
        },
        {
          id: "parents",
          category: "RLS — lectures",
          label: "Parents (table parents)",
          status: "pass",
          detail: "HTTP 200 — 3 ligne(s) visible(s)",
          durationMs: 120,
        },
        {
          id: "storage.buckets",
          category: "Stockage",
          label: "Buckets de stockage (storage.listBuckets)",
          status: "not_tested",
          detail: "Listage interdit au rôle authentifié.",
          durationMs: 45,
        },
      ],
      summary: { pass: 1, fail: 1, notTested: 1 },
    });
    const runner = vi.fn(async () => report);

    renderTab(runner);
    fireEvent.click(screen.getByRole("button", { name: "Lancer le diagnostic" }));

    expect(await screen.findByText("1 PASS")).toBeTruthy();
    expect(screen.getByText("1 FAIL")).toBeTruthy();
    expect(screen.getByText("1 NON TESTÉ")).toBeTruthy();
    expect(screen.getByText("PASS")).toBeTruthy(); // the per-row status badge
    expect(screen.getByText("FAIL")).toBeTruthy();
    expect(screen.getByText("NON TESTÉ")).toBeTruthy();
    // The AUTH-302 explainer banner appears when any check fails.
    expect(screen.getByText(/signature AUTH-302/i)).toBeTruthy();
    // The failing detail is visible (safe form).
    expect(screen.getByText(/JWT absent/i)).toBeTruthy();
  });

  it("renders the OPS-317 seed-degradation card: the recorded reason explains the empty list", async () => {
    // Create a REAL seed diagnostic via the OPS-317 wiring (the t-392 pattern).
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
    );
    const chain = {
      eq: () => chain,
      is: () => chain,
      order: async () => ({ data: null, error: { code: "ERR_UNAUTHORIZED", message: "JWT expired" } }),
    };
    const failingClient = { from: () => ({ select: () => chain }) } as unknown as SupabaseClient;
    const repo = new SupabaseParentRepository(failingClient);
    await repo.search("");

    const records = getSeedDiagnostics();
    expect(records.length).toBeGreaterThanOrEqual(1);

    const runner = vi.fn(async () =>
      makeReport({ summary: { pass: 18, fail: 0, notTested: 0 }, checks: [] }),
    );
    renderTab(runner);

    expect(
      screen.getByText(/Derniers échecs de chargement/i),
    ).toBeTruthy();
    expect(screen.getByText("ERR_UNAUTHORIZED")).toBeTruthy();
    expect(screen.getByText("parents")).toBeTruthy();
  });

  it("renders the empty state when no seed degradation was ever recorded", () => {
    const runner = vi.fn(async () =>
      makeReport({ summary: { pass: 18, fail: 0, notTested: 0 }, checks: [] }),
    );
    renderTab(runner);
    expect(
      screen.getByText(/Aucun échec de chargement enregistré/i),
    ).toBeTruthy();
  });

  it("the copy button exports the safe text report to the clipboard", async () => {
    const clipboardWrite: (text: string) => Promise<void> = async () => undefined;
    const writeText = vi.fn(clipboardWrite);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const report = makeReport({
      checks: [
        {
          id: "config.connection",
          category: "Configuration",
          label: "Configuration du client Supabase",
          status: "pass",
          detail: "Hôte vebfehrpzajhstyhinnw.supabase.co, format de clé publishable",
          durationMs: 0,
        },
      ],
      summary: { pass: 1, fail: 0, notTested: 0 },
    });
    const runner = vi.fn(async () => report);
    renderTab(runner);

    fireEvent.click(screen.getByRole("button", { name: "Lancer le diagnostic" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copier le rapport" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Copier le rapport" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const exported = writeText.mock.calls[0]?.[0] as string | undefined;
    expect(exported).toBeDefined();
    expect(exported).toContain("PASS");
    expect(exported).toContain("vebfehrpzajhstyhinnw.supabase.co");
    expect(exported).not.toContain("sb_publishable_");
    expect(screen.getByText("Rapport copié")).toBeTruthy();
  });
});
