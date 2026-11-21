/**
 * Type declarations for scripts/preflight-target.mjs (T-575 — the one-command
 * target preflight, the packager's preflight of record). The root tsconfig does
 * not compile .mjs sources; this adjacent declaration file gives tsc the
 * surface while vitest imports the real module (the package-target.d.mts
 * convention).
 */

export interface ConsolidatedBaseline {
  readonly migrationCount: number;
  readonly migrationVersion: string;
  readonly publicTables: number;
  readonly views: number;
  readonly matviews: number;
  readonly matviewNames: readonly string[];
  readonly buckets: number;
  readonly publicPolicies: number;
  readonly storagePolicies: number;
  readonly functions: number;
  readonly publicTriggers: number;
  readonly authMirrorTriggers: number;
  readonly rlsEnabledTables: number;
  readonly t376Checks: number;
}

export declare const CONSOLIDATED_BASELINE: ConsolidatedBaseline;
export declare const RLS_HELPERS: readonly string[];
export declare const MANAGEMENT_TOKEN_ENV: string;
export declare const MANAGEMENT_QUERY_ENDPOINT: string;
export declare const MANAGEMENT_USER_AGENT: string;
export declare const CENSUS_SQL: Readonly<Record<string, string>>;

export interface CensusAxis {
  id: string;
  expected: unknown;
  observed: unknown;
  ok: boolean;
  detail: string;
}

export interface CensusVerdict {
  ok: boolean;
  axes: CensusAxis[];
  failures: string[];
}

export interface NormalizedCensus {
  migrations: { count: number; version?: string };
  publicTables: number;
  views: string[];
  matviews: string[];
  buckets: number;
  publicPolicies: number;
  storagePolicies: number;
  functions: number;
  publicTriggers: number;
  authMirrorTriggers: number;
  rlsEnabled: number;
  rlsHelpers: Array<{ proname: string; prosecdef: boolean; proconfig?: string | null }>;
}

export declare function evaluateCensus(observed: NormalizedCensus): CensusVerdict;
export declare function rowsToCensus(
  responses: Record<string, Array<Record<string, unknown>>>,
): NormalizedCensus;

export interface T376Verdict {
  ok: boolean;
  passed: number;
  total: number;
  failures: string[];
  detail: string;
}

export declare function evaluateT376(
  rows: Array<{ check_id?: string; ok?: boolean | string; detail?: string }>,
): T376Verdict;

export declare function prepareManagementSql(sql: string): string;

export interface ManagementQueryVerdict {
  ok: boolean;
  kind: "ok" | "fail-closed" | "auth" | "http" | "network";
  status: number;
  rows: Array<Record<string, unknown>>;
  detail: string;
}

export declare function runManagementQuery(input: {
  projectRef: string;
  accessToken: string;
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<ManagementQueryVerdict>;

export interface RestSmokeVerdict {
  ok: boolean;
  lanes: Array<{ lane: string; ok: boolean; status: number; detail: string }>;
}

export declare function probeAuthenticatedRest(input: {
  targetUrl: string;
  publicKey: string;
  jwt?: string;
  fetchImpl?: typeof fetch;
}): Promise<RestSmokeVerdict>;

export declare function parseFunctionsTomlEntries(text: string): string[];
export declare function censusFunctionsTree(functionsDir: string): string[] | null;

export interface FunctionsCensusVerdict {
  ok: boolean;
  tomlCount: number;
  treeCount: number;
  failures: string[];
  detail: string;
}

export declare function evaluateFunctionsCensus(
  tomlNames: string[] | null,
  treeNames: string[] | null,
): FunctionsCensusVerdict;

export interface MigrationsLayoutVerdict {
  ok: boolean;
  files: string[];
  failures: string[];
  detail: string;
}

export declare function evaluateMigrationsLayout(fileNames: string[]): MigrationsLayoutVerdict;

export interface AppendOnlyGuardVerdict {
  ok: boolean;
  stdout: string;
  failures: string[];
  detail: string;
}

export declare function runAppendOnlyGuard(input?: {
  cwd?: string;
  execImpl?: typeof import("node:child_process").execFileSync;
}): AppendOnlyGuardVerdict;

export declare function deriveTargetRef(url: unknown): string | null;

export interface PreflightVerdict {
  ok: boolean;
  projectRef?: string;
  lanes: Array<Record<string, unknown> & { id: string; ok: boolean }>;
  failures: string[];
  summary: string;
}

export declare function runPreflight(options?: {
  targetUrl?: string;
  publicKey?: string;
  jwt?: string;
  processEnv?: Record<string, string | undefined>;
  repoDir?: string;
  fetchImpl?: typeof fetch;
  execImpl?: typeof import("node:child_process").execFileSync;
}): Promise<PreflightVerdict>;
