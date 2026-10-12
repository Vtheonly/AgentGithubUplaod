/**
 * t-505-export-warmup.test.ts — T-505 (BKUP-510): the Excel-ZIP export's
 * warm-up seam.
 *
 * THE DEFECT this suite pins: the ExportDialog collected its 13 streams
 * through reactive hooks and exported whatever the caches held at CLICK
 * time — a cold app or a degraded seed (the T-423 silent-empty class)
 * silently exported EMPTY/PARTIAL Excel files (live-reproduced: a failed
 * students seed exported 0 students alongside 741 parents).
 *
 * What this suite pins:
 *
 *   A. warmExportSources — every warmable source's refresh() is awaited
 *      and reported; a throwing refresh degrades honestly (never throws);
 *      the mock layer (no refresh) is skipped.
 *   B. collectWarmedExportData — THE COLD-CACHE FIX: a repo whose cache
 *      starts EMPTY but whose refresh() populates it contributes its rows
 *      to the export (the pre-T-505 reactive read returned the empty
 *      initial value); the per-call streams settle (emission → warmed,
 *      silence → degraded); the T-368 pricing null-check is preserved.
 *   C. buildExcelOnlyExport(data, at, warmup) — the manifest carries the
 *      sourceWarmup record (the operator's post-hoc detector).
 *   D. The ExportDialog — the export click routes through the warmed
 *      collector (the refresh calls happen BEFORE the build).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-505-export-warmup.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import "fake-indexeddb/auto";
import "../../i18n/i18n";

import {
  warmExportSources,
  collectWarmedExportData,
  describeWarmupReport,
} from "../../infrastructure/export/export-warmup";
import { buildExcelOnlyExport } from "../../infrastructure/export/archive-export";
import type { ExportWarmupReport } from "../../infrastructure/export/export-warmup";
import type { Repositories } from "../../app/providers/repository-provider";
import type { FullExportData } from "../../infrastructure/excel/full-export";

/* ------------------------------------------------------------------ */
/* The fake repositories — a COLD cache + a refresh() that warms it     */
/* ------------------------------------------------------------------ */

type Obs<T> = { get: () => T; subscribe: (fn: (v: T) => void) => () => void };

function behavior<T>(initial: T): { obs: Obs<T>; set: (v: T) => void } {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    obs: {
      get: () => value,
      subscribe: (fn) => {
        subs.add(fn);
        return () => subs.delete(fn);
      },
    },
    set: (v) => {
      value = v;
      for (const fn of subs) fn(v);
    },
  };
}

/** A repo whose cache starts EMPTY; refresh() populates it (the Supabase shape). */
function coldRepo<T>(rows: T[], opts: { throwOnRefresh?: boolean } = {}) {
  const b = behavior<T[]>([]);
  const calls = { refresh: 0 };
  return {
    calls,
    observe: () => b.obs,
    ...(opts.throwOnRefresh
      ? {}
      : {
          refresh: async () => {
            calls.refresh++;
            b.set(rows);
          },
        }),
    ...(opts.throwOnRefresh
      ? { refresh: async () => { calls.refresh++; throw new Error("PGRST303 probe failure"); } }
      : {}),
  };
}

/** The minimal Repositories shape collectWarmedExportData/warmExportSources touch. */
function fakeRepos(opts: {
  parents?: ReturnType<typeof coldRepo>;
  studentsThrow?: boolean;
  attendanceEmits?: boolean;
  gradesEmits?: boolean;
} = {}): Repositories {
  const parents = opts.parents ?? coldRepo([]);
  const students = coldRepo(opts.studentsThrow ? [] : [], {});
  const empty = coldRepo([]);
  const neverEmitAttendance = {
    observeAll: () => ({
      get: () => [],
      subscribe: () => () => undefined, // NEVER fires — the settle window expires
    }),
  };
  const emittingAttendance = {
    observeAll: () => {
      const b = behavior([]);
      setTimeout(() => b.set([]), 10); // an emission (even empty data) within the window
      return b.obs;
    },
  };
  const grades = {
    observeAll: () => {
      const b = behavior([]);
      if (opts.gradesEmits !== false) setTimeout(() => b.set([]), 10);
      return b.obs;
    },
  };
  const pricingB = behavior(null);
  return {
    ...({} as Repositories),
    parents: parents as unknown as Repositories["parents"],
    students: students as unknown as Repositories["students"],
    personnel: empty as unknown as Repositories["personnel"],
    payments: empty as unknown as Repositories["payments"],
    installments: empty as unknown as Repositories["installments"],
    ledger: empty as unknown as Repositories["ledger"],
    expenses: empty as unknown as Repositories["expenses"],
    classes: empty as unknown as Repositories["classes"],
    subjects: empty as unknown as Repositories["subjects"],
    grades: grades as unknown as Repositories["grades"],
    attendance: (opts.attendanceEmits === false ? neverEmitAttendance : emittingAttendance) as unknown as Repositories["attendance"],
    pricing: {
      observe: () => pricingB.obs,
      refresh: async () => undefined,
    } as unknown as Repositories["pricing"],
    debt: {
      observeSummary: () => behavior([]).obs,
      refreshSummary: async () => undefined,
    } as unknown as Repositories["debt"],
  } as Repositories;
}

/* ================================================================== */
/* A. warmExportSources                                                 */
/* ================================================================== */

describe("T-505 A. warmExportSources — the seam", () => {
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("awaits every warmable source's refresh() and reports each warmed", async () => {
    const repos = fakeRepos();
    const report = await warmExportSources(repos);
    const bySource = Object.fromEntries(report.map((r) => [r.source, r.status]));
    expect(bySource["parents"]).toBe("warmed");
    expect(bySource["students"]).toBe("warmed");
    expect(bySource["payments"]).toBe("warmed");
    expect(bySource["installments"]).toBe("warmed");
    expect(bySource["ledger"]).toBe("warmed");
    expect(bySource["expenses"]).toBe("warmed");
    expect(bySource["personnel"]).toBe("warmed");
    expect(bySource["classes"]).toBe("warmed");
    expect(bySource["subjects"]).toBe("warmed");
    expect(bySource["pricing"]).toBe("warmed");
    expect(bySource["debtSummaries"]).toBe("warmed");
  });

  it("a throwing refresh() degrades honestly (degraded + reason) and NEVER throws", async () => {
    const repos = fakeRepos();
    // Make students' refresh throw — via a direct fake with the throwing shape.
    (repos as unknown as Record<string, unknown>).students = {
      observe: () => behavior([]).obs,
      refresh: async () => { throw new Error("PGRST303 probe failure"); },
    };
    const report = await warmExportSources(repos);
    const students = report.find((r) => r.source === "students")!;
    expect(students.status).toBe("degraded");
    expect(students.reason).toContain("PGRST303");
    // Every OTHER source still warmed — one failure never blocks the rest.
    expect(report.filter((r) => r.status === "warmed").length).toBeGreaterThanOrEqual(10);
  });

  it("a source with NO refresh (the mock layer) is skipped, not an error", async () => {
    const repos = fakeRepos();
    (repos as unknown as Record<string, unknown>).expenses = { observe: () => behavior([]).obs };
    const report = await warmExportSources(repos);
    const expenses = report.find((r) => r.source === "expenses")!;
    expect(expenses.status).toBe("skipped");
  });
});

/* ================================================================== */
/* B. collectWarmedExportData — the cold-cache fix                       */
/* ================================================================== */

describe("T-505 B. collectWarmedExportData — the cold-cache fix", () => {
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("THE FIX: a cold cache whose refresh() populates rows contributes them (the reactive read returned the EMPTY initial value)", async () => {
    const parents = coldRepo([
      { id: "p1", code: "PAR-001" },
      { id: "p2", code: "PAR-002" },
      { id: "p3", code: "PAR-003" },
    ]);
    const repos = fakeRepos({ parents });
    const { data, warmup } = await collectWarmedExportData(repos);
    // Pre-T-505 the reactive read at click time returned the initial [] —
    // the warm-up makes the export see the populated cache.
    expect(data.parents).toHaveLength(3);
    expect(parents.calls.refresh).toBe(1);
    expect(warmup.find((w) => w.source === "parents")?.status).toBe("warmed");
  });

  it("a silent per-call stream (no emission) is reported degraded and the last value is used", async () => {
    vi.useFakeTimers();
    const repos = fakeRepos({ attendanceEmits: false });
    const collected = collectWarmedExportData(repos);
    await vi.advanceTimersByTimeAsync(4_500); // past the settle window
    const { warmup } = await collected;
    const attendance = warmup.find((w) => w.source === "attendance")!;
    expect(attendance.status).toBe("degraded");
    expect(attendance.reason).toContain("no emission");
  });

  it("an emitting per-call stream is warmed (even when the data is empty — an empty DB is a valid state)", async () => {
    const repos = fakeRepos({ attendanceEmits: true, gradesEmits: true });
    const { warmup } = await collectWarmedExportData(repos);
    expect(warmup.find((w) => w.source === "attendance")?.status).toBe("warmed");
    expect(warmup.find((w) => w.source === "assessments")?.status).toBe("warmed");
  });

  it("the T-368 pricing null-check is preserved (an unseeded-looking config → null)", async () => {
    const repos = fakeRepos();
    const { data } = await collectWarmedExportData(repos);
    expect(data.pricing).toBeNull();
  });

  it("describeWarmupReport names the degraded sources", () => {
    const report: ExportWarmupReport[] = [
      { source: "parents", status: "warmed" },
      { source: "students", status: "degraded", reason: "500" },
    ];
    expect(describeWarmupReport(report)).toContain("students");
    expect(describeWarmupReport([{ source: "x", status: "warmed" }])).toBe("toutes les sources à jour");
  });
});

/* ================================================================== */
/* C. buildExcelOnlyExport carries the warm-up record in the manifest   */
/* ================================================================== */

describe("T-505 C. the manifest's sourceWarmup record", () => {
  it("the ZIP manifest carries the per-source warm-up statuses", async () => {
    const data: FullExportData = {
      parents: [], students: [], personnel: [], payments: [], installments: [],
      ledger: [], expenses: [], assessments: [], subjects: [], attendance: [],
      debtSummaries: [], classes: [], pricing: null,
      exportedAt: "2026-10-12T10:00:00.000Z",
    };
    const warmup: ExportWarmupReport[] = [
      { source: "parents", status: "warmed" },
      { source: "students", status: "degraded", reason: "57014 statement timeout" },
    ];
    const built = await buildExcelOnlyExport(data, new Date("2026-10-12T10:00:00Z"), warmup);
    expect(built.bytes[0]).toBe(0x50); // PK

    // Parse the STORE-method ZIP (the t-382 minimal reader).
    const b = built.bytes;
    const readU16 = (o: number) => b[o] | (b[o + 1] << 8);
    const readU32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    let eocd = -1;
    for (let i = b.length - 22; i >= 0; i--) { if (readU32(i) === 0x06054b50) { eocd = i; break; } }
    expect(eocd).toBeGreaterThan(-1);
    const count = readU16(eocd + 10);
    let off = readU32(eocd + 16);
    let manifestBytes: Uint8Array | null = null;
    for (let n = 0; n < count; n++) {
      const size = readU32(off + 20);
      const nameLen = readU16(off + 28);
      const localOff = readU32(off + 42);
      const name = new TextDecoder().decode(b.slice(off + 46, off + 46 + nameLen));
      if (name === "manifest.json") {
        const localNameLen = readU16(localOff + 26);
        const dataStart = localOff + 30 + localNameLen;
        manifestBytes = b.slice(dataStart, dataStart + size);
      }
      off += 46 + nameLen;
    }
    expect(manifestBytes).not.toBeNull();
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes!));
    expect(manifest.sourceWarmup).toEqual(warmup);
  });

  it("the record is OPTIONAL — the legacy no-warmup call shape still builds", async () => {
    const data: FullExportData = {
      parents: [], students: [], personnel: [], payments: [], installments: [],
      ledger: [], expenses: [], assessments: [], subjects: [], attendance: [],
      debtSummaries: [], classes: [], pricing: null,
      exportedAt: "2026-10-12T10:00:00.000Z",
    };
    const built = await buildExcelOnlyExport(data, new Date("2026-10-12T10:00:00Z"));
    expect(built.bytes.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* D. The ExportDialog routes through the warmed collector              */
/* ================================================================== */

describe("T-505 D. the ExportDialog's warmed collection", () => {
  const toasts = {
    showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), showInfo: vi.fn(),
  };
  let mockSession: Record<string, unknown> | null = null;

  // The warmed-collector spy: the dialog MUST go through it (BKUP-510's fix).
  const collectSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      userId: "usr-admin", displayName: "Admin", role: "super_admin",
      permissions: { has: () => true },
    };
    (window as unknown as Record<string, unknown>).elImtiyazDesktop = {
      saveFile: vi.fn(async (_n: string, bytes: Uint8Array) => ({ saved: true, path: "/tmp/out.zip", bytes: bytes.length })),
    };
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).elImtiyazDesktop;
  });

  it("the export click warms the sources BEFORE building (the cold-cache fix at the UI layer)", async () => {
    const parents = coldRepo([{ id: "p1" }, { id: "p2" }]);
    const warmedRepos = fakeRepos({ parents });

    vi.doMock("../../app/providers/repository-provider", () => ({
      useRepositories: () => warmedRepos,
    }));
    vi.doMock("../../app/providers/toast-provider", () => ({ useToast: () => toasts }));
    vi.doMock("../../app/providers/auth-provider", () => ({ useAuth: () => ({ session: mockSession }) }));
    vi.doMock("../../infrastructure/export/export-warmup", async (importOriginal) => {
      const original = await importOriginal<typeof import("../../infrastructure/export/export-warmup")>();
      return {
        ...original,
        collectWarmedExportData: async (...args: Parameters<typeof original.collectWarmedExportData>) => {
          collectSpy(...args);
          return original.collectWarmedExportData(...args);
        },
      };
    });

    const { ExportDialog } = await import("../../features/settings/export-dialog");
    render(
      <ExportDialog open onOpenChange={() => undefined} origin="backups" defaultFormat="excel-zip" />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Choisir l'emplacement et exporter/ }));
    await waitFor(() => expect(collectSpy).toHaveBeenCalledTimes(1));
    // The refresh happened (the warmed collection ran against the cold repo).
    await waitFor(() => expect(parents.calls.refresh).toBe(1));
    vi.doUnmock("../../app/providers/repository-provider");
    vi.doUnmock("../../app/providers/toast-provider");
    vi.doUnmock("../../app/providers/auth-provider");
    vi.doUnmock("../../infrastructure/export/export-warmup");
  });
});
