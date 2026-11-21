/**
 * T-574 — the relocation auth tooling verification suite
 * (scripts/relocate-auth.mjs + scripts/relocate_auth_remap.sql — the
 * UUID-preserving auth-user export/import pair + the email-match remap with
 * the dry-run report + the password-reset communication flow).
 *
 * Gates (the t-575 suite's conventions):
 *  A. THE CONSTANTS pinned (the GoTrue admin API paths, the pagination walk,
 *     the manifest schema, the operator env names, the sentinel texts, the
 *     7-surface lists, the hard-flags footer, the allowlists).
 *  B. THE REAL relocate_auth_remap.sql pinned (the §A.4.3.3b email-match
 *     updates VERBATIM; the students leg's ABSENCE — the C-28 schema-true
 *     correction; the sentinel sections parse; the apply wrapper discipline;
 *     idempotence-by-construction).
 *  C. sanitizeExportedUser (the allowlist projection; the password-material
 *     refusal; the UUID gate; the email gate).
 *  D. buildCreateUserBody (the SAME id; email_confirm; NEVER password
 *     material; the phone gate).
 *  E. evaluatePreservation RED/GREEN ("created" is NOT "preserved"; the
 *     §A.4.3.3b remediation pointer).
 *  F. exportAllAuthUsers (the multi-page walk; the short-page exhaustion
 *     rule; the MAX_PAGES guard; fail-closed zero-fetch; the 401/403 shape).
 *  G. importAuthUser + runImport (the POST body carries the SAME id; the
 *     per-user verify GET; the 422 already-present/idempotent re-run lane;
 *     the email-conflict classification; the id-drift doctrine; the manifest
 *     shape gate; per-user isolation).
 *  H. THE RESET FLOW (generate_link type=recovery; the SECRET-CLASS report
 *     written 0600; the email-mode /auth/v1/recover; fail-closed).
 *  I. runRemapDryRun (the T-446 strip through prepareManagementSql on the
 *     REAL artifact; the §11.1 wire shape; fail-closed zero network I/O).
 *  J. runRemapApply (the double-fence REFUSED without the confirm word —
 *     zero network I/O; the apply submission BEGIN…COMMIT; the post-verify
 *     convergence re-run; "N rows updated" is NOT convergence).
 *  K. evaluateRemapReport + evaluateConvergence (the per-surface verdicts;
 *     the duplicate-email hazard; the missing-surface refusal; the string
 *     coercion; the hard-flags footer).
 *  L. THE NO-SECRETS-COMMITTED SCAN over the touched script surfaces.
 */
import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

// The tool runs as PLAIN NODE (.mjs — the packager/operators invoke it;
// scripts/ is outside the root tsconfig's include, so tsc cannot see the
// .d.mts sibling). The type surface below is pinned by these gates
// themselves; vitest executes the real module.
// @ts-ignore -- .mjs outside the include tree (see scripts/relocate-auth.d.mts)
import {
  ADMIN_GENERATE_LINK_PATH,
  ADMIN_USERS_PATH,
  CREATE_BODY_KEYS,
  DEFAULT_PER_PAGE,
  HAZARD_SURFACE,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_USER_FIELDS,
  MANAGEMENT_TOKEN_ENV_CANDIDATES,
  MAX_PAGES,
  PATH2_HARD_FLAGS,
  RECOVER_PATH,
  REMAP_APPLY_SENTINELS,
  REMAP_CONFIRM_WORD,
  REMAP_DRY_RUN_SENTINELS,
  REMAP_SQL_FILE,
  REMAP_SURFACES,
  REPORT_SURFACES,
  SERVICE_KEY_ENV_SOURCE,
  SERVICE_KEY_ENV_TARGET,
  URL_ENV_SOURCE,
  URL_ENV_TARGET,
  assertApplySql,
  buildCreateUserBody,
  buildResetReport,
  classifyCreateFailure,
  evaluateConvergence,
  evaluatePreservation,
  evaluateRemapReport,
  exportAllAuthUsers,
  generateRecoveryLink,
  importAuthUser,
  parseRemapSqlSections,
  readRemapSections,
  runImport,
  runRemapApply,
  runRemapDryRun,
  sanitizeExportedUser,
  sendRecoveryEmail,
  writeResetReportFile,
} from "../../../scripts/relocate-auth.mjs";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const realSql = readFileSync(join(repoDir, "scripts", REMAP_SQL_FILE), "utf8");
const OLD_PROJECT_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const NEW_PROJECT_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
const TEST_SERVICE_KEY = "sb_secret_test-service-role-key-material";
const TEST_MANAGEMENT_TOKEN = "sbp_local-test-management-token";

const UUID_A = "123e4567-e89b-42d3-4567-426614174000";
const UUID_B = "223e4567-e89b-42d3-4567-426614174bbb";
const UUID_C = "323e4567-e89b-42d3-4567-426614174ccc";

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status });
}

function userRow(id: string, email: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    email,
    aud: "authenticated",
    role: "authenticated",
    raw_user_meta_data: { display_name: "Test User" },
    app_metadata: { provider: "email", providers: ["email"] },
    created_at: "2026-01-05T10:00:00Z",
    last_sign_in_at: null,
    ...extra,
  };
}

/** A fetch stub keyed by call sequence (URL-inspectable via the call log). */
function sequencedFetchImpl(responses: Array<unknown>) {
  const queue = [...responses];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected extra fetch call: ${url}`);
    if (typeof next === "function") return next(url, init);
    return next;
  });
  return impl;
}


/** Cast a vi.fn stub into the module's fetchImpl parameter type (the t-575 convention). */
function asFetch(impl: unknown): typeof fetch {
  return impl as unknown as typeof fetch;
}

// ============================================================================
// A. The constants (the GoTrue admin API surface + the operator conventions).
// ============================================================================

describe("T-574 A — the constants (the admin-API paths, the walk, the manifest, the env names)", () => {
  it("pins the GoTrue admin API paths (the per-project, service-role-key surface)", () => {
    expect(ADMIN_USERS_PATH).toBe("/auth/v1/admin/users");
    expect(ADMIN_GENERATE_LINK_PATH).toBe("/auth/v1/admin/generate_link");
    expect(RECOVER_PATH).toBe("/auth/v1/recover");
  });

  it("pins the offset-pagination walk (per_page default 100; the MAX_PAGES runaway guard)", () => {
    expect(DEFAULT_PER_PAGE).toBe(100);
    expect(MAX_PAGES).toBe(1000);
  });

  it("pins the manifest schema version + the operator env names (the .secrets/credentials.env names)", () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe("1");
    expect(SERVICE_KEY_ENV_SOURCE).toBe("SUPABASE_SERVICE_ROLE_KEY_OLD");
    expect(SERVICE_KEY_ENV_TARGET).toBe("SUPABASE_SERVICE_ROLE_KEY_NEW");
    expect(URL_ENV_SOURCE).toBe("SUPABASE_URL_OLD");
    expect(URL_ENV_TARGET).toBe("SUPABASE_URL_NEW");
    expect(MANAGEMENT_TOKEN_ENV_CANDIDATES).toContain("SUPABASE_ACCESS_TOKEN");
    expect(MANAGEMENT_TOKEN_ENV_CANDIDATES).toContain("SUPABASE_ACCESS_TOKEN_NEW");
  });

  it("pins the remap artifact name + the confirm word + BOTH sentinel pairs", () => {
    expect(REMAP_SQL_FILE).toBe("relocate_auth_remap.sql");
    expect(REMAP_CONFIRM_WORD).toBe("REMAP");
    expect(REMAP_DRY_RUN_SENTINELS.open).toContain("REMAP DRY-RUN (read-only)");
    expect(REMAP_DRY_RUN_SENTINELS.close).toBe("-- <<< REMAP DRY-RUN <<<");
    expect(REMAP_APPLY_SENTINELS.open).toContain("REMAP APPLY");
    expect(REMAP_APPLY_SENTINELS.open).toContain("--confirm REMAP");
    expect(REMAP_APPLY_SENTINELS.close).toBe("-- <<< REMAP APPLY <<<");
  });

  it("pins the 7-surface map (2 remap + 4 report + the hazard row)", () => {
    expect([...REMAP_SURFACES]).toEqual(["user_profiles", "parents"]);
    expect([...REPORT_SURFACES]).toEqual([
      "students",
      "activation_codes",
      "personnel",
      "account_approval_requests",
    ]);
    expect(HAZARD_SURFACE).toBe("auth_users_dupes");
  });

  it("pins the PATH-2 hard flags footer (the runbook blocker 7 — ARCH-029 + BUG-061/072)", () => {
    expect(PATH2_HARD_FLAGS).toContain("ARCH-029");
    expect(PATH2_HARD_FLAGS).toContain("BUG-061/BUG-072");
    expect(PATH2_HARD_FLAGS).toContain("Path-2");
  });

  it("pins the allowlists — password material is NEVER among them (Layer 3.3)", () => {
    expect([...MANIFEST_USER_FIELDS]).toContain("raw_user_meta_data");
    expect([...MANIFEST_USER_FIELDS]).toContain("app_metadata");
    for (const forbidden of ["password", "password_hash", "encrypted_password"]) {
      expect([...MANIFEST_USER_FIELDS]).not.toContain(forbidden);
      expect([...CREATE_BODY_KEYS]).not.toContain(forbidden);
    }
    expect([...CREATE_BODY_KEYS]).toContain("email_confirm");
  });
});

// ============================================================================
// B. The REAL relocate_auth_remap.sql (the §A.4.3.3b remap, schema-true).
// ============================================================================

describe("T-574 B — the REAL remap SQL artifact (§A.4.3.3b, schema-true per C-28)", () => {
  it("carries the §A.4.3.3b email-match updates VERBATIM (modulo the public. qualification)", () => {
    expect(realSql).toContain(
      "update public.user_profiles up set auth_user_id = au.id\n  from auth.users au where lower(au.email) = lower(up.email);",
    );
    expect(realSql).toContain(
      "update public.parents p set auth_user_id = au.id\n  from auth.users au where lower(au.email) = lower(p.email);",
    );
  });

  it("DELIBERATELY carries NO students update in the APPLY section — the C-28 correction (the baseline has no students.email; the header comment quotes the runbook leg it refuses)", () => {
    expect(sections_apply(realSql)).not.toMatch(/update\s+(public\.)?students\b/i);
    expect(realSql).toContain("C-28");
    expect(realSql).toContain("the consolidated baseline's students table carries no email column");
  });

  it("never SQL-rewrites the report-only surfaces (activation/personnel/approvals re-bind via their designed flows)", () => {
    expect(realSql).not.toMatch(/update\s+(public\.)?activation_codes\b/i);
    expect(realSql).not.toMatch(/update\s+(public\.)?personnel\b/i);
    expect(realSql).not.toMatch(/update\s+(public\.)?account_approval_requests\b/i);
  });

  it("the sentinel sections parse out of the REAL artifact (both sections, non-empty)", () => {
    const sections = parseRemapSqlSections(realSql);
    expect(sections.ok).toBe(true);
    expect(sections.dryRun).toBeTruthy();
    expect(sections.apply).toBeTruthy();
    expect(sections.dryRun).toMatch(/^begin\b/i);
    expect(sections.dryRun).toMatch(/rollback\s*;?\s*$/i);
    expect(sections.apply).toMatch(/^begin\b/i);
    expect(sections.apply).toMatch(/commit\s*;?\s*$/i);
  });

  it("REFUSES an artifact with a missing section (fail-closed, never improvised SQL)", () => {
    expect(parseRemapSqlSections("").ok).toBe(false);
    expect(parseRemapSqlSections("select 1;").ok).toBe(false);
    const missingDryRun = realSql.replace(REMAP_DRY_RUN_SENTINELS.open, "-- gone");
    expect(parseRemapSqlSections(missingDryRun).ok).toBe(false);
    const missingApply = realSql.replace(REMAP_APPLY_SENTINELS.close, "-- gone");
    expect(parseRemapSqlSections(missingApply).ok).toBe(false);
  });

  it("the dry-run censuses ALL 7 surfaces + the duplicate-email hazard row", () => {
    for (const surface of [...REMAP_SURFACES, ...REPORT_SURFACES, HAZARD_SURFACE]) {
      expect(realSql).toContain(`'${surface}'`);
    }
    // the two remap surfaces count would_change + already-correct + dangling
    expect(realSql).toContain("rows_would_change");
    expect(realSql).toContain("rows_already_correct");
    expect(realSql).toContain("rows_dangling");
    // the hazard row counts the duplicated lower(email) groups
    expect(realSql).toContain("having count(*) > 1");
  });

  it("idempotence-by-construction: the updates key on lower()-cased email equality ONLY", () => {
    expect(sections_apply(realSql)).toMatch(/lower\(au\.email\) = lower\(up\.email\)/);
    expect(sections_apply(realSql)).toMatch(/lower\(au\.email\) = lower\(p\.email\)/);
  });

  it("assertApplySql enforces the BEGIN…COMMIT wrapper discipline on the REAL apply section", () => {
    const sections = parseRemapSqlSections(realSql);
    const verdict = assertApplySql(sections.apply!);
    expect(verdict.ok).toBe(true);
    // RED: an apply section without the closing COMMIT is REFUSED
    const noCommit = assertApplySql(sections.apply!.replace(/commit\s*;?\s*$/i, ""));
    expect(noCommit.ok).toBe(false);
    expect(noCommit.reason).toContain("COMMIT");
    // RED: unwrapped write SQL is REFUSED
    const noBegin = assertApplySql("update public.user_profiles set auth_user_id = gen_random_uuid();");
    expect(noBegin.ok).toBe(false);
    expect(noBegin.reason).toContain("BEGIN");
  });

  it("readRemapSections resolves the REAL artifact from the module's own repo layout", () => {
    const verdict = readRemapSections(undefined);
    expect(verdict.ok).toBe(true);
    expect(verdict.dryRun).toBeTruthy();
    expect(verdict.apply).toBeTruthy();
    const explicit = readRemapSections(repoDir);
    expect(explicit.ok).toBe(true);
    expect(explicit.dryRun).toBe(verdict.dryRun);
  });
});

function sections_apply(sqlText: string): string {
  return parseRemapSqlSections(sqlText).apply ?? "";
}

// ============================================================================
// C. sanitizeExportedUser (the manifest allowlist).
// ============================================================================

describe("T-574 C — sanitizeExportedUser (the allowlist; password material never lands in the manifest)", () => {
  it("projects a full GoTrue row onto the allowlist (unknown fields dropped)", () => {
    const verdict = sanitizeExportedUser(userRow(UUID_A, "owner@elimtiyaz.dz", { weird_future_field: "x" }));
    expect(verdict.ok).toBe(true);
    const user = verdict.user as Record<string, unknown>;
    expect(user.id).toBe(UUID_A);
    expect(user.email).toBe("owner@elimtiyaz.dz");
    expect(user.raw_user_meta_data).toEqual({ display_name: "Test User" });
    expect(user.app_metadata).toEqual({ provider: "email", providers: ["email"] });
    expect(user.created_at).toBe("2026-01-05T10:00:00Z");
    expect(user).not.toHaveProperty("weird_future_field");
    expect(user).not.toHaveProperty("password");
  });

  it("flags password material if a hostile API surface ever returns it (and still keeps the allowlist clean)", () => {
    const verdict = sanitizeExportedUser(userRow(UUID_A, "a@b.dz", { password_hash: "bcrypt$…" }));
    expect(verdict.ok).toBe(true);
    expect(verdict.passwordMaterialSeen).toBe(true);
    expect((verdict.user as Record<string, unknown>).password_hash).toBeUndefined();
  });

  it("REFUSES a non-UUID id, a missing email, and a non-object row", () => {
    expect(sanitizeExportedUser(userRow("not-a-uuid", "a@b.dz")).ok).toBe(false);
    expect(sanitizeExportedUser(userRow(UUID_A, "  ")).ok).toBe(false);
    expect(sanitizeExportedUser(userRow(UUID_A, "")).ok).toBe(false);
    expect(sanitizeExportedUser(null).ok).toBe(false);
    expect(sanitizeExportedUser("a string").ok).toBe(false);
    expect(sanitizeExportedUser({ id: UUID_A }).ok).toBe(false); // no email
  });

  it("keeps the phone + the record-only fields only when they carry content", () => {
    const withPhone = sanitizeExportedUser(userRow(UUID_A, "a@b.dz", { phone: "+213555000111" }));
    expect((withPhone.user as Record<string, unknown>).phone).toBe("+213555000111");
    const trimmed = sanitizeExportedUser(userRow(UUID_B, "b@b.dz", { phone: "  " }));
    expect((trimmed.user as Record<string, unknown>).phone).toBeUndefined();
  });
});

// ============================================================================
// D. buildCreateUserBody (the UUID-preserving create payload).
// ============================================================================

describe("T-574 D — buildCreateUserBody (the SAME id; NEVER password material)", () => {
  it("carries the SAME id + the trimmed email + email_confirm=true + the metadata", () => {
    const verdict = buildCreateUserBody({
      id: UUID_A,
      email: "  Owner@Elimtiyaz.dz  ",
      raw_user_meta_data: { display_name: "Owner" },
      app_metadata: { provider: "email" },
      created_at: "2026-01-05T10:00:00Z",
    });
    expect(verdict.ok).toBe(true);
    const body = verdict.body as Record<string, unknown>;
    expect(body.id).toBe(UUID_A);
    expect(body.email).toBe("Owner@Elimtiyaz.dz");
    expect(body.email_confirm).toBe(true);
    expect(body.user_metadata).toEqual({ display_name: "Owner" });
    expect(body.app_metadata).toEqual({ provider: "email" });
    // the record-only created_at is NOT submitted (the server sets it)
    expect(body).not.toHaveProperty("created_at");
  });

  it("adds the phone + phone_confirm ONLY when the user carries a usable phone", () => {
    const withPhone = buildCreateUserBody({ id: UUID_B, email: "b@b.dz", phone: "+213555000111" });
    expect((withPhone.body as Record<string, unknown>).phone).toBe("+213555000111");
    expect((withPhone.body as Record<string, unknown>).phone_confirm).toBe(true);
    const withoutPhone = buildCreateUserBody({ id: UUID_B, email: "b@b.dz", phone: "  " });
    expect((withoutPhone.body as Record<string, unknown>).phone).toBeUndefined();
    expect((withoutPhone.body as Record<string, unknown>).phone_confirm).toBeUndefined();
  });

  it("REFUSES a non-UUID id and a missing email (the UUID-preserving contract starts here)", () => {
    expect(buildCreateUserBody({ id: "garbage", email: "a@b.dz" }).ok).toBe(false);
    expect(buildCreateUserBody({ id: UUID_A, email: "" }).ok).toBe(false);
    expect(buildCreateUserBody(undefined).ok).toBe(false);
  });

  it("REFUSES a manifest row carrying password material — credential smuggling never rides the create lane", () => {
    const withPassword = buildCreateUserBody({ id: UUID_A, email: "a@b.dz", password: "P4ssw0rd!" });
    expect(withPassword.ok).toBe(false);
    expect(withPassword.reason).toContain("password");
    const withHash = buildCreateUserBody({ id: UUID_A, email: "a@b.dz", password_hash: "bcrypt$…" });
    expect(withHash.ok).toBe(false);
    expect(withHash.reason).toContain("password");
  });
});

// ============================================================================
// E. evaluatePreservation ("created" is NOT "preserved").
// ============================================================================

describe("T-574 E — evaluatePreservation (the per-user verdict)", () => {
  it("GREEN: the same id + a case-insensitive email = preserved", () => {
    const verdict = evaluatePreservation(
      { id: UUID_A, email: "Owner@Elimtiyaz.dz" },
      { id: UUID_A, email: "owner@elimtiyaz.dz" },
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.idPreserved).toBe(true);
    expect(verdict.emailPreserved).toBe(true);
  });

  it("RED: the server assigned a DIFFERENT id → NOT preserved, pointing at the §A.4.3.3b remediation", () => {
    const verdict = evaluatePreservation({ id: UUID_A, email: "owner@elimtiyaz.dz" }, { id: UUID_B, email: "owner@elimtiyaz.dz" });
    expect(verdict.ok).toBe(false);
    expect(verdict.idPreserved).toBe(false);
    expect(verdict.detail).toContain("NOT preserved");
    expect(verdict.detail).toContain("remap");
  });

  it("RED: an email drift is named (the login identity follows the email)", () => {
    const verdict = evaluatePreservation({ id: UUID_A, email: "owner@elimtiyaz.dz" }, { id: UUID_A, email: "other@elimtiyaz.dz" });
    expect(verdict.ok).toBe(false);
    expect(verdict.emailPreserved).toBe(false);
    expect(verdict.detail).toContain("NOT preserved");
  });

  it("classifyCreateFailure routes the 422 duplicate-email lane apart from auth/http", () => {
    expect(classifyCreateFailure(422, { code: "email_exists" }).kind).toBe("email-exists");
    expect(classifyCreateFailure(422, { msg: "Duplicate email" }).kind).toBe("email-exists");
    expect(classifyCreateFailure(401, null).kind).toBe("auth");
    expect(classifyCreateFailure(403, null).kind).toBe("auth");
    expect(classifyCreateFailure(500, { code: "internal" }).kind).toBe("http");
  });
});

// ============================================================================
// F. exportAllAuthUsers (the §A.3.1.2 walk).
// ============================================================================

describe("T-574 F — exportAllAuthUsers (the UUID-preserving walk)", () => {
  it("walks the pages and stops on the SHORT-PAGE exhaustion rule (fewer users than per_page)", async () => {
    const page1 = { users: [userRow(UUID_A, "a@x.dz"), userRow(UUID_B, "b@x.dz")] };
    const page2 = { users: [userRow(UUID_C, "c@x.dz")] };
    const fetchImpl = sequencedFetchImpl([jsonResponse(200, page1), jsonResponse(200, page2)]);
    const verdict = await exportAllAuthUsers({ baseUrl: OLD_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, perPage: 2, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);
    expect(verdict.users.map((u) => u.id)).toEqual([UUID_A, UUID_B, UUID_C]);
    expect(verdict.pages).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // the walk's wire shape: page=1.., per_page=2.., apikey + Bearer
    const first = fetchImpl.mock.calls[0];
    expect(String(first[0])).toBe(`${OLD_PROJECT_URL}${ADMIN_USERS_PATH}?page=1&per_page=2`);
    expect((first[1] as RequestInit).method).toBe("GET");
    const headers = (first[1] as RequestInit).headers as Record<string, string>;
    expect(headers.apikey).toBe(TEST_SERVICE_KEY);
    expect(headers.Authorization).toBe(`Bearer ${TEST_SERVICE_KEY}`);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${OLD_PROJECT_URL}${ADMIN_USERS_PATH}?page=2&per_page=2`);
  });

  it("an EMPTY page also terminates the walk", async () => {
    const fetchImpl = sequencedFetchImpl([jsonResponse(200, { users: [] })]);
    const verdict = await exportAllAuthUsers({ baseUrl: OLD_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, perPage: 100, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);
    expect(verdict.users).toEqual([]);
    expect(verdict.pages).toBe(1);
  });

  it("FAILS CLOSED on a missing key with ZERO network I/O, naming the operator env vars", async () => {
    const fetchImpl = vi.fn();
    const verdict = await exportAllAuthUsers({ baseUrl: OLD_PROJECT_URL, serviceKey: "", fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdict.detail).toContain(SERVICE_KEY_ENV_SOURCE);
    expect(verdict.detail).toContain(SERVICE_KEY_ENV_TARGET);
  });

  it("FAILS CLOSED on a missing/invalid base URL with zero network I/O", async () => {
    const fetchImpl = vi.fn();
    for (const bad of [undefined, "", "ftp://x", "http://insecure.supabase.co"]) {
      const verdict = await exportAllAuthUsers({ baseUrl: bad, serviceKey: TEST_SERVICE_KEY, fetchImpl: asFetch(fetchImpl) });
      expect(verdict.ok).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("401/403 stop the walk with the auth classification; an unexpected body shape stops it loudly", async () => {
    const auth = await exportAllAuthUsers({
      baseUrl: OLD_PROJECT_URL,
      serviceKey: TEST_SERVICE_KEY,
      fetchImpl: asFetch(sequencedFetchImpl([jsonResponse(401, { message: "Invalid API key" })])),
    });
    expect(auth.ok).toBe(false);
    expect(auth.detail).toContain("page 1");
    expect(auth.detail).toContain("401");

    const weird = await exportAllAuthUsers({
      baseUrl: OLD_PROJECT_URL,
      serviceKey: TEST_SERVICE_KEY,
      fetchImpl: asFetch(sequencedFetchImpl([jsonResponse(200, { not_users: [] })])),
    });
    expect(weird.ok).toBe(false);
    expect(weird.detail).toContain("no users array");
  });

  it("the MAX_PAGES runaway guard REFUSES to certify a truncated walk", async () => {
    // a FRESH Response per call — a Response body can only be read once
    const payload = JSON.stringify({ users: [userRow(UUID_A, "a@x.dz"), userRow(UUID_B, "b@x.dz")] });
    const fetchImpl = vi.fn(async () => new Response(payload, { status: 200 }));
    const verdict = await exportAllAuthUsers({ baseUrl: OLD_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, perPage: 2, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("MAX_PAGES");
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("rows that fail the allowlist are REFUSED and named (the walk never accumulates them)", async () => {
    const page = { users: [userRow(UUID_A, "a@x.dz"), { id: "garbage", email: "x@x.dz" }, { id: UUID_B }] };
    const verdict = await exportAllAuthUsers({
      baseUrl: OLD_PROJECT_URL,
      serviceKey: TEST_SERVICE_KEY,
      perPage: 5,
      fetchImpl: asFetch(sequencedFetchImpl([jsonResponse(200, page)])),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.users.map((u) => u.id)).toEqual([UUID_A]);
    expect(verdict.failures.some((f) => f.includes("not a UUID"))).toBe(true);
    expect(verdict.failures.some((f) => f.includes(UUID_B))).toBe(true);
  });
});

// ============================================================================
// G. importAuthUser + runImport (the §A.3.2.1 create-verify ceremony).
// ============================================================================

describe("T-574 G — the import lane (create with the SAME id, then verify per user)", () => {
  const manifestUser = { id: UUID_A, email: "owner@elimtiyaz.dz", raw_user_meta_data: { display_name: "Owner" } };

  it("POSTs the create with the SAME id + email_confirm, then GETs the user back to VERIFY", async () => {
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(201, userRow(UUID_A, "owner@elimtiyaz.dz")),
      jsonResponse(200, userRow(UUID_A, "owner@elimtiyaz.dz")),
    ]);
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, user: manifestUser, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome).toBe("created-prescribed-id-verified");

    const [createUrl, createInit] = fetchImpl.mock.calls[0];
    expect(String(createUrl)).toBe(`${NEW_PROJECT_URL}${ADMIN_USERS_PATH}`);
    expect((createInit as RequestInit).method).toBe("POST");
    const body = JSON.parse((createInit as RequestInit).body as string);
    expect(body.id).toBe(UUID_A); // THE UUID-PRESERVING CONTRACT
    expect(body.email).toBe("owner@elimtiyaz.dz");
    expect(body.email_confirm).toBe(true);
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("password_hash");
    const [getUrl, getInit] = fetchImpl.mock.calls[1];
    expect(String(getUrl)).toBe(`${NEW_PROJECT_URL}${ADMIN_USERS_PATH}/${UUID_A}`);
    expect((getInit as RequestInit).method).toBe("GET");
  });

  it("RED: a created id that DRIFTED is NOT preservation (the doctrine at the user level)", async () => {
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(201, userRow(UUID_B, "owner@elimtiyaz.dz")), // the server ignored the prescribed id
      jsonResponse(200, userRow(UUID_B, "owner@elimtiyaz.dz")),
    ]);
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, user: manifestUser, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("not-preserved");
    expect(verdict.detail).toContain("remap");
  });

  it("the 422 duplicate-email lane resolves by the id-GET: the SAME id = the idempotent re-run (already-present)", async () => {
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(422, { code: "email_exists", msg: "A user with this email address has already been registered" }),
      jsonResponse(200, userRow(UUID_A, "owner@elimtiyaz.dz")),
    ]);
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, user: manifestUser, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome).toBe("already-present");
    expect(verdict.preserved).toBe(true);
  });

  it("the 422 lane with a 404 id-GET = an EMAIL CONFLICT routed to the remap remediation", async () => {
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(422, { code: "email_exists" }),
      jsonResponse(404, { message: "User not found" }),
    ]);
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, user: manifestUser, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("email-conflict");
    expect(verdict.detail).toContain("remap");
  });

  it("a create that answers 200 but fails the verify GET FAILS LOUD (existence unproven)", async () => {
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(200, userRow(UUID_A, "owner@elimtiyaz.dz")),
      jsonResponse(404, { message: "User not found" }),
    ]);
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, user: manifestUser, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("verify-failed");
    expect(verdict.detail).toContain("FAIL-LOUD");
  });

  it("--verify-only runs the GET lane ONLY (the re-check of a completed import)", async () => {
    const fetchImpl = sequencedFetchImpl([jsonResponse(200, userRow(UUID_A, "owner@elimtiyaz.dz"))]);
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, user: manifestUser, verifyOnly: true, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);
    expect(verdict.outcome).toBe("verify-present");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("FAILS CLOSED on a missing key with ZERO network I/O", async () => {
    const fetchImpl = vi.fn();
    const verdict = await importAuthUser({ baseUrl: NEW_PROJECT_URL, serviceKey: "", user: manifestUser, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("refused");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runImport: per-user isolation + the honest aggregate (one bad row never aborts the batch)", async () => {
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      users: [
        { id: UUID_A, email: "owner@elimtiyaz.dz" },
        { id: "not-a-uuid", email: "bad@x.dz" },
        { id: UUID_C, email: "c@elimtiyaz.dz" },
      ],
    };
    const responses = [
      jsonResponse(201, userRow(UUID_A, "owner@elimtiyaz.dz")),
      jsonResponse(200, userRow(UUID_A, "owner@elimtiyaz.dz")),
      // the bad row never reaches the network (refused at buildCreateUserBody)
      jsonResponse(201, userRow(UUID_C, "c@elimtiyaz.dz")),
      jsonResponse(200, userRow(UUID_C, "c@elimtiyaz.dz")),
    ];
    const verdict = await runImport({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, manifest, fetchImpl: asFetch(sequencedFetchImpl(responses)) });
    expect(verdict.ok).toBe(false);
    expect(verdict.created).toBe(2);
    expect(verdict.failed).toBe(1);
    expect(verdict.results.map((r) => r.outcome)).toEqual(["created-prescribed-id-verified", "refused", "created-prescribed-id-verified"]);
    expect(verdict.failures.some((f) => f.includes("not-a-uuid"))).toBe(true);
  });

  it("runImport REFUSES a manifest that is not a relocate-auth artifact", async () => {
    const fetchImpl = vi.fn();
    const verdict = await runImport({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, manifest: { users: [manifestUser] }, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toContain("schemaVersion");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("runImport REFUSES to certify an EMPTY manifest", async () => {
    const verdict = await runImport({
      baseUrl: NEW_PROJECT_URL,
      serviceKey: TEST_SERVICE_KEY,
      manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION, users: [] },
      fetchImpl: asFetch(vi.fn()),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("ZERO users");
  });
});

// ============================================================================
// H. The reset flow (the password-reset communication lane).
// ============================================================================

describe("T-574 H — the reset flow (Layer 3.3: every recreated user needs a reset)", () => {
  it("link mode POSTs generate_link with type=recovery + the email, and returns the action_link", async () => {
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(200, {
        action_link: "https://gvuvibcsfjhwcjikgxql.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https://elimtiyaz-website.vercel.app",
        email_otp: "654321",
        verification_type: "recovery",
        redirect_to: "https://elimtiyaz-website.vercel.app",
      }),
    ]);
    const verdict = await generateRecoveryLink({
      baseUrl: NEW_PROJECT_URL,
      serviceKey: TEST_SERVICE_KEY,
      email: "parent@elimtiyaz.dz",
      redirectTo: "https://elimtiyaz-website.vercel.app",
      fetchImpl: asFetch(fetchImpl),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.action_link).toContain("type=recovery");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${NEW_PROJECT_URL}${ADMIN_GENERATE_LINK_PATH}`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.type).toBe("recovery");
    expect(body.email).toBe("parent@elimtiyaz.dz");
    expect(body.redirect_to).toBe("https://elimtiyaz-website.vercel.app");
  });

  it("a response without an action_link is REFUSED (never certify a reset that did not happen)", async () => {
    const verdict = await generateRecoveryLink({
      baseUrl: NEW_PROJECT_URL,
      serviceKey: TEST_SERVICE_KEY,
      email: "parent@elimtiyaz.dz",
      fetchImpl: asFetch(sequencedFetchImpl([jsonResponse(200, { verification_type: "recovery" })])),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("action_link");
  });

  it("email mode POSTs /auth/v1/recover with the email (the platform reset email; SMTP required)", async () => {
    const fetchImpl = sequencedFetchImpl([jsonResponse(200, {})]);
    const verdict = await sendRecoveryEmail({ baseUrl: NEW_PROJECT_URL, serviceKey: TEST_SERVICE_KEY, email: "parent@elimtiyaz.dz", fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${NEW_PROJECT_URL}${RECOVER_PATH}`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: "parent@elimtiyaz.dz" });
  });

  it("both modes FAIL CLOSED on a missing key with ZERO network I/O", async () => {
    const fetchImpl = vi.fn();
    const link = await generateRecoveryLink({ baseUrl: NEW_PROJECT_URL, serviceKey: "", email: "a@b.dz", fetchImpl: asFetch(fetchImpl) });
    const email = await sendRecoveryEmail({ baseUrl: NEW_PROJECT_URL, serviceKey: "", email: "a@b.dz", fetchImpl: asFetch(fetchImpl) });
    expect(link.ok).toBe(false);
    expect(email.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the link report is SECRET-CLASS: the header warns, and the file lands 0600", async () => {
    const results = [
      { ok: true, email: "a@x.dz", action_link: "https://t.supabase.co/auth/v1/verify?token=1&type=recovery", email_otp: "111222" },
      { ok: false, email: "b@x.dz", detail: "HTTP 429 from the admin generate_link call" },
    ];
    const text = buildResetReport(results, { targetUrl: NEW_PROJECT_URL });
    expect(text).toContain("SECRET-CLASS");
    expect(text).toContain("never committed");
    expect(text).toContain("a@x.dz -> https://t.supabase.co/auth/v1/verify?token=1&type=recovery");
    expect(text).toContain("b@x.dz -> FAILED: HTTP 429");
    const path = join(tmpdir(), `t574-reset-report-${Date.now()}.txt`);
    try {
      writeResetReportFile(path, text);
      expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
    } finally {
      unlinkSync(path);
    }
  });
});

// ============================================================================
// I. runRemapDryRun (the T-446 convention through the §11.1 wire).
// ============================================================================

describe("T-574 I — runRemapDryRun (the read-only census through the management wire)", () => {
  it("FAILS CLOSED on a missing management token with ZERO network I/O, naming BOTH env candidates", async () => {
    const fetchImpl = vi.fn();
    const verdict = await runRemapDryRun({ targetUrl: NEW_PROJECT_URL, managementToken: "", fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(false);
    expect(verdict.kind).toBe("fail-closed");
    expect(verdict.detail).toContain("SUPABASE_ACCESS_TOKEN");
    expect(verdict.detail).toContain("SUPABASE_ACCESS_TOKEN_NEW");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on a non-supabase target URL (the ref-derivation gate, zero network)", async () => {
    const verdict = await runRemapDryRun({ targetUrl: "https://relay.example.org", managementToken: TEST_MANAGEMENT_TOKEN, fetchImpl: vi.fn() });
    expect(verdict.ok).toBe(false);
    expect(verdict.kind).toBe("fail-closed");
  });

  it("submits the REAL dry-run section through the T-446 strip (BEGIN kept, trailing ROLLBACK stripped) on the §11.1 wire", async () => {
    const censusRows = [
      { surface: "user_profiles", mode: "remap", rows_total: "12", rows_with_email: "12", rows_matched: "12", rows_would_change: "0", rows_already_correct: "12", rows_unmatched: "0", rows_dangling: "0" },
      { surface: "parents", mode: "remap", rows_total: "250", rows_with_email: "240", rows_matched: "238", rows_would_change: "6", rows_already_correct: "232", rows_unmatched: "2", rows_dangling: "10" },
      { surface: "students", mode: "report", rows_total: "390", rows_dangling: "15" },
      { surface: "activation_codes", mode: "report", rows_total: "300", rows_dangling: "9" },
      { surface: "personnel", mode: "report", rows_total: "40", rows_dangling: "3" },
      { surface: "account_approval_requests", mode: "report", rows_total: "1", rows_dangling: "1" },
      { surface: "auth_users_dupes", mode: "hazard", rows_total: "0", rows_matched: "0" },
    ];
    const fetchImpl = sequencedFetchImpl([jsonResponse(200, censusRows)]);
    const verdict = await runRemapDryRun({ targetUrl: NEW_PROJECT_URL, managementToken: TEST_MANAGEMENT_TOKEN, repoDir, fetchImpl: asFetch(fetchImpl) });
    expect(verdict.ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`https://api.supabase.com/v1/projects/gvuvibcsfjhwcjikgxql/database/query`);
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TEST_MANAGEMENT_TOKEN}`);
    expect(headers["User-Agent"]).toBe("curl/8.5.0");
    const submitted = JSON.parse((init as RequestInit).body as string).query as string;
    // the T-446 strip: BEGIN kept, the trailing ROLLBACK stripped
    expect(submitted).toMatch(/^begin\b/i);
    expect(submitted).not.toMatch(/rollback\s*;?\s*$/i);
    // the census SQL itself is the REAL artifact's dry-run section
    const realSection = readRemapSections(repoDir).dryRun as string;
    expect(submitted).toBe(realSection.trim().replace(/rollback\s*;?\s*$/i, "").trim());
    // the report: the post-verify state is REPORTED, not failed
    expect(verdict.report?.surfaces?.parents?.rowsWouldChange).toBe(6);
    expect(verdict.footer).toContain("ARCH-029");
  });
});

// ============================================================================
// J. runRemapApply (the double-fenced write lane + the post-verify convergence).
// ============================================================================

describe("T-574 J — runRemapApply (the double fence + the convergence doctrine)", () => {
  it("REFUSES without the confirm word — ZERO network I/O (the double fence)", async () => {
    const fetchImpl = vi.fn();
    for (const bad of [undefined, "", "yes", "remap", "APPLY"]) {
      const verdict = await runRemapApply({ targetUrl: NEW_PROJECT_URL, managementToken: TEST_MANAGEMENT_TOKEN, confirm: bad, fetchImpl: asFetch(fetchImpl) });
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toContain("REFUSED");
      expect(verdict.detail).toContain("--confirm");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("with the confirm word: submits the BEGIN…COMMIT apply section, then re-runs the dry-run census; CONVERGED = would_change 0", async () => {
    const postVerifyRows = [
      { surface: "user_profiles", mode: "remap", rows_total: "12", rows_would_change: "0", rows_already_correct: "12", rows_dangling: "0" },
      { surface: "parents", mode: "remap", rows_total: "250", rows_would_change: "0", rows_already_correct: "238", rows_unmatched: "2", rows_dangling: "12" },
      { surface: "students", mode: "report", rows_total: "390", rows_dangling: "15" },
      { surface: "activation_codes", mode: "report", rows_total: "300", rows_dangling: "9" },
      { surface: "personnel", mode: "report", rows_total: "40", rows_dangling: "3" },
      { surface: "account_approval_requests", mode: "report", rows_total: "1", rows_dangling: "1" },
      { surface: "auth_users_dupes", mode: "hazard", rows_total: "0", rows_matched: "0" },
    ];
    const fetchImpl = sequencedFetchImpl([
      jsonResponse(200, []), // the apply submission
      jsonResponse(200, postVerifyRows), // the post-verify census
    ]);
    const verdict = await runRemapApply({
      targetUrl: NEW_PROJECT_URL,
      managementToken: TEST_MANAGEMENT_TOKEN,
      confirm: REMAP_CONFIRM_WORD,
      repoDir,
      fetchImpl: asFetch(fetchImpl),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.applied).toBe(true);
    expect(verdict.detail).toContain("CONVERGED");

    // submission 1: the apply section — BEGIN…COMMIT, both email-match updates
    const applyBody = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string).query as string;
    expect(applyBody).toMatch(/^begin\b/i);
    expect(applyBody).toMatch(/commit\s*;?\s*$/i);
    expect(applyBody).toContain("update public.user_profiles up set auth_user_id = au.id");
    expect(applyBody).toContain("update public.parents p set auth_user_id = au.id");
    expect(applyBody).not.toMatch(/update\s+(public\.)?students\b/i);

    // submission 2: the post-verify census re-run (the dry-run section again)
    const verifyBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string).query as string;
    expect(verifyBody).toMatch(/rows_would_change/);
  });

  it("the post-verify rows with would_change > 0 FAIL the convergence verdict (\"N rows updated\" is NOT convergence)", async () => {
    const driftedRows = [
      { surface: "user_profiles", mode: "remap", rows_total: "12", rows_would_change: "0" },
      { surface: "parents", mode: "remap", rows_total: "250", rows_would_change: "4" },
      { surface: "students", mode: "report", rows_total: "390", rows_dangling: "15" },
      { surface: "activation_codes", mode: "report", rows_total: "300", rows_dangling: "9" },
      { surface: "personnel", mode: "report", rows_total: "40", rows_dangling: "3" },
      { surface: "account_approval_requests", mode: "report", rows_total: "1", rows_dangling: "1" },
      { surface: "auth_users_dupes", mode: "hazard", rows_total: "0", rows_matched: "0" },
    ];
    const fetchImpl = sequencedFetchImpl([jsonResponse(200, []), jsonResponse(200, driftedRows)]);
    const verdict = await runRemapApply({
      targetUrl: NEW_PROJECT_URL,
      managementToken: TEST_MANAGEMENT_TOKEN,
      confirm: REMAP_CONFIRM_WORD,
      repoDir,
      fetchImpl: asFetch(fetchImpl),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("did NOT converge");
    expect(verdict.convergence?.failures.some((f) => f.includes("parents"))).toBe(true);
  });

  it("REFUSES an apply section that lost its COMMIT wrapper (zero network I/O)", async () => {
    const fetchImpl = vi.fn();
    const brokenSql = realSql.replace(
      /\ncommit\s*;?\s*(?=\n-- <<< REMAP APPLY <<<)/,
      "\n",
    );
    expect(brokenSql).not.toBe(realSql); // the COMMIT really was stripped
    expect(parseRemapSqlSections(brokenSql).ok).toBe(true); // the sentinels survive — the wrapper discipline is what refuses
    const badRepo = join(tmpdir(), `t574-badrepo-${Date.now()}`);
    try {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(badRepo, "scripts"), { recursive: true });
      writeFileSync(join(badRepo, "scripts", REMAP_SQL_FILE), brokenSql);
      const verdict = await runRemapApply({ targetUrl: NEW_PROJECT_URL, managementToken: TEST_MANAGEMENT_TOKEN, confirm: REMAP_CONFIRM_WORD, repoDir: badRepo, fetchImpl: asFetch(fetchImpl) });
      expect(verdict.ok).toBe(false);
      expect(verdict.detail).toContain("COMMIT");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(badRepo, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// K. evaluateRemapReport + evaluateConvergence (the census verdicts).
// ============================================================================

function fullCensusRows(overrides: Record<string, Record<string, unknown>> = {}): Array<Record<string, unknown>> {
  const base = {
    user_profiles: { mode: "remap", rows_total: 12, rows_with_email: 12, rows_matched: 12, rows_would_change: 0, rows_already_correct: 12, rows_unmatched: 0, rows_dangling: 0 },
    parents: { mode: "remap", rows_total: 250, rows_with_email: 240, rows_matched: 238, rows_would_change: 6, rows_already_correct: 232, rows_unmatched: 2, rows_dangling: 10 },
    students: { mode: "report", rows_total: 390, rows_with_email: 0, rows_matched: 0, rows_would_change: 0, rows_already_correct: 0, rows_unmatched: 0, rows_dangling: 15 },
    activation_codes: { mode: "report", rows_total: 300, rows_dangling: 9 },
    personnel: { mode: "report", rows_total: 40, rows_dangling: 3 },
    account_approval_requests: { mode: "report", rows_total: 1, rows_dangling: 1 },
  };
  const hazard: Record<string, unknown> = { mode: "hazard", rows_total: 0, rows_matched: 0 };
  const rows: Array<Record<string, unknown>> = Object.entries(base).map(([surface, row]) => ({ surface, ...(row as Record<string, unknown>) }));
  rows.push({ surface: HAZARD_SURFACE, ...hazard });
  for (const [surface, patch] of Object.entries(overrides)) {
    const row = rows.find((r) => r.surface === surface);
    if (row) Object.assign(row, patch);
  }
  return rows;
}

describe("T-574 K — evaluateRemapReport + evaluateConvergence (the census verdicts)", () => {
  it("GREEN: a complete census reports every surface + the hard-flags footer (would-change is the PRE-APPLY state, not a failure)", () => {
    const report = evaluateRemapReport(fullCensusRows());
    expect(report.ok).toBe(true);
    expect(report.surfaces.parents.rowsWouldChange).toBe(6);
    expect(report.surfaces.students.rowsDangling).toBe(15);
    expect(report.footer).toContain("ARCH-029");
    expect(report.footer).toContain("BUG-061/BUG-072");
  });

  it("coerces string counts from the management wire", () => {
    const rows = fullCensusRows().map((row) => ({
      ...row,
      rows_total: String(row.rows_total ?? 0),
      rows_would_change: String(row.rows_would_change ?? 0),
    }));
    const report = evaluateRemapReport(rows);
    expect(report.ok).toBe(true);
    expect(report.surfaces.user_profiles.rowsTotal).toBe(12);
    expect(report.surfaces.parents.rowsWouldChange).toBe(6);
  });

  it("RED: the duplicate-email hazard fails the report and names the ARBITRARY-match risk", () => {
    const report = evaluateRemapReport(fullCensusRows({ [HAZARD_SURFACE]: { rows_total: 2, rows_matched: 1 } }));
    expect(report.ok).toBe(false);
    expect(report.hazards[0]).toContain("ARBITRARY");
    expect(report.hazards[0]).toContain("duplicated");
  });

  it("RED: a missing surface row fails the report naming the surface", () => {
    const rows = fullCensusRows().filter((row) => row.surface !== "personnel");
    const report = evaluateRemapReport(rows);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes("personnel"))).toBe(true);
  });

  it("RED: rows-that-fail-the-shape read as zero/absent — a non-array input is an invalid census", () => {
    expect(evaluateRemapReport(null as unknown as Array<Record<string, unknown>>).ok).toBe(false);
    expect(evaluateRemapReport([]).ok).toBe(false); // every surface missing
  });

  it("evaluateConvergence: would_change 0 on BOTH remap surfaces + a clear hazard = converged", () => {
    const report = evaluateRemapReport(fullCensusRows({ parents: { rows_would_change: 0, rows_already_correct: 238 } }));
    expect(evaluateConvergence(report).ok).toBe(true);
  });

  it("evaluateConvergence: would_change > 0 on any remap surface = NOT converged, naming the surface", () => {
    const report = evaluateRemapReport(fullCensusRows());
    const verdict = evaluateConvergence(report);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((f) => f.includes("parents"))).toBe(true);
    expect(verdict.detail).toContain("did not converge");
  });
});

// ============================================================================
// L. The no-secrets-committed scan (the t-575 L convention).
// ============================================================================

describe("T-574 L — the no-secrets-committed scan (the t-573/t-552/t-575 convention)", () => {
  it("no secret-class key material (sb_secret_ / sbp_ real shapes) is committed in the touched scripts", () => {
    const scanned = [
      "scripts/relocate-auth.mjs",
      "scripts/relocate-auth.d.mts",
      `scripts/${REMAP_SQL_FILE}`,
    ];
    for (const relative of scanned) {
      const text = readFileSync(join(repoDir, relative), "utf8");
      expect(text).not.toMatch(/sb_secret_[A-Za-z0-9]{16,}/);
      expect(text).not.toMatch(/sbp_[a-f0-9]{32,}/);
    }
  });

  it("the manifest allowlist never grows password-shaped fields (the standing guard)", () => {
    expect([...MANIFEST_USER_FIELDS].filter((f) => /password/i.test(f))).toEqual([]);
    expect([...CREATE_BODY_KEYS].filter((f) => /password/i.test(f))).toEqual([]);
  });
});
