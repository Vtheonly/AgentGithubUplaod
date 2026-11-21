/**
 * Type declarations for scripts/relocate-auth.mjs (T-574 — the relocation
 * auth tooling: the UUID-preserving export/import pair + the email-match
 * remap + the password-reset flow). The root tsconfig does not compile .mjs
 * sources; this adjacent declaration file gives tsc the surface while vitest
 * imports the real module (the preflight-target.d.mts convention).
 */

export declare const ADMIN_USERS_PATH: string;
export declare const ADMIN_GENERATE_LINK_PATH: string;
export declare const RECOVER_PATH: string;
export declare const DEFAULT_PER_PAGE: number;
export declare const MAX_PAGES: number;
export declare const MANIFEST_SCHEMA_VERSION: string;
export declare const SERVICE_KEY_ENV_SOURCE: string;
export declare const SERVICE_KEY_ENV_TARGET: string;
export declare const URL_ENV_SOURCE: string;
export declare const URL_ENV_TARGET: string;
export declare const MANAGEMENT_TOKEN_ENV_CANDIDATES: readonly string[];
export declare const REMAP_SQL_FILE: string;
export declare const REMAP_CONFIRM_WORD: string;
export declare const REMAP_DRY_RUN_SENTINELS: { readonly open: string; readonly close: string };
export declare const REMAP_APPLY_SENTINELS: { readonly open: string; readonly close: string };
export declare const REMAP_SURFACES: readonly string[];
export declare const REPORT_SURFACES: readonly string[];
export declare const HAZARD_SURFACE: string;
export declare const PATH2_HARD_FLAGS: string;
export declare const MANIFEST_USER_FIELDS: readonly string[];
export declare const CREATE_BODY_KEYS: readonly string[];

export interface SanitizeVerdict {
  ok: boolean;
  user?: Record<string, unknown>;
  reason?: string;
  passwordMaterialSeen?: boolean;
}

export declare function sanitizeExportedUser(raw: unknown): SanitizeVerdict;

export interface BuildBodyVerdict {
  ok: boolean;
  body?: {
    id: string;
    email: string;
    email_confirm: true;
    user_metadata: Record<string, unknown>;
    app_metadata: Record<string, unknown>;
    phone?: string;
    phone_confirm?: true;
  };
  reason?: string;
}

export declare function buildCreateUserBody(user: unknown): BuildBodyVerdict;

export interface PreservationVerdict {
  ok: boolean;
  idPreserved: boolean;
  emailPreserved: boolean;
  detail: string;
}

export declare function evaluatePreservation(intended: unknown, created: unknown): PreservationVerdict;
export declare function classifyCreateFailure(
  status: number,
  body: unknown,
): { kind: "email-exists" | "auth" | "http"; detail: string };

export interface RemapSectionsVerdict {
  ok: boolean;
  dryRun?: string;
  apply?: string;
  reason?: string;
}

export declare function parseRemapSqlSections(fileText: string): RemapSectionsVerdict;
export declare function readRemapSections(repoDir?: string): RemapSectionsVerdict;
export declare function assertApplySql(sql: string): { ok: boolean; sql?: string; reason?: string };

export interface RemapSurfaceRow {
  mode: "remap" | "report";
  rowsTotal: number;
  rowsWithEmail: number;
  rowsMatched: number;
  rowsWouldChange: number;
  rowsAlreadyCorrect: number;
  rowsUnmatched: number;
  rowsDangling: number;
}

export interface RemapReport {
  ok: boolean;
  surfaces: Record<string, RemapSurfaceRow>;
  hazards: string[];
  failures: string[];
  footer: string;
  detail: string;
}

export declare function evaluateRemapReport(rows: Array<Record<string, unknown>>): RemapReport;
export declare function evaluateConvergence(report: RemapReport): {
  ok: boolean;
  failures: string[];
  detail: string;
};

export interface AdminRequestVerdict {
  ok: boolean;
  kind: "ok" | "fail-closed" | "auth" | "http" | "network";
  status: number;
  data: unknown;
  detail: string;
}

export declare function authAdminRequest(input: {
  baseUrl?: string;
  serviceKey?: string;
  method?: string;
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<AdminRequestVerdict>;

export declare function exportAllAuthUsers(input: {
  baseUrl?: string;
  serviceKey?: string;
  perPage?: number;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  users: Array<Record<string, unknown>>;
  pages: number;
  failures: string[];
  detail: string;
}>;

export declare function importAuthUser(input: {
  baseUrl?: string;
  serviceKey?: string;
  user: unknown;
  verifyOnly?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; outcome: string; preserved: boolean; detail: string }>;

export declare function runImport(input: {
  baseUrl?: string;
  serviceKey?: string;
  manifest: { schemaVersion?: string; users?: unknown[] };
  verifyOnly?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  results: Array<{ id?: string; email?: string; outcome: string; preserved: boolean; detail: string }>;
  created: number;
  alreadyPresent: number;
  conflicts: number;
  failed: number;
  failures: string[];
  detail: string;
}>;

export declare function generateRecoveryLink(input: {
  baseUrl?: string;
  serviceKey?: string;
  email: string;
  redirectTo?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  email?: string;
  action_link?: string;
  email_otp?: string | null;
  verification_type?: string | null;
  status?: number;
  detail?: string;
}>;

export declare function sendRecoveryEmail(input: {
  baseUrl?: string;
  serviceKey?: string;
  email: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; email?: string; status?: number; detail?: string }>;

export declare function buildResetReport(
  results: Array<{ ok: boolean; email?: string | null; action_link?: string; email_otp?: string | null; detail?: string }>,
  meta?: { generatedAt?: string; targetUrl?: string | null },
): string;
export declare function writeResetReportFile(path: string, text: string): string;

export declare function runRemapDryRun(input: {
  targetUrl?: string;
  managementToken?: string;
  repoDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  kind?: string;
  report?: RemapReport;
  rows?: Array<Record<string, unknown>>;
  detail: string;
  footer?: string;
}>;

export declare function runRemapApply(input: {
  targetUrl?: string;
  managementToken?: string;
  confirm?: string;
  repoDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  kind?: string;
  applied?: boolean;
  postVerify?: RemapReport;
  convergence?: { ok: boolean; failures: string[]; detail: string };
  footer?: string;
  detail: string;
}>;
