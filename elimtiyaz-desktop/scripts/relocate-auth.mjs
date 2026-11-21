#!/usr/bin/env node
/**
 * relocate-auth.mjs — T-574 (the relocation auth tooling): the ONE-MODULE
 * operator tool for the SUPABASE-RELOCATION-AND-RELOAD-GUIDE's auth lane —
 * the blocker row 3 ceremony (`auth.users` UUID coupling, the 7-surface
 * linkage map Layer 3.1):
 *
 *   export  §A.3.1.2 — the UUID-preserving auth-user walk off the GoTrue
 *                      admin API (id/email/metadata ONLY — passwords are
 *                      never exportable and never carried).
 *   import  §A.3.2.1 — POST each user back with the SAME id (the platform
 *                      source contract: AdminUserParams.Id != "" →
 *                      user.ID = customId, UUIDv4 + non-nil enforced —
 *                      supabase/auth internal/api/admin.go, re-verified
 *                      2026-11-21), then a per-user GET verify — "created N
 *                      users" is NOT preservation (the t-575 "N/N applied is
 *                      NOT parity" doctrine, at the user level).
 *   reset   Layer 3.3 — the password-reset communication flow per imported
 *                      user: link mode (POST /auth/v1/admin/generate_link
 *                      type=recovery → the action_link report, 0600, never
 *                      committed) or email mode (POST /auth/v1/recover —
 *                      the platform reset email; requires SMTP on target).
 *   remap   §A.4.3.3b — the email-match remap (scripts/relocate_auth_remap.sql,
 *                      schema-true per C-28: user_profiles + parents email-match
 *                      ONLY; students re-bind via the activation flow) with
 *                      the read-only DRY-RUN report (the T-446 BEGIN/ROLLBACK
 *                      convention through the §11.1 Management-API wire) and
 *                      the double-fenced APPLY (+ the post-verify convergence
 *                      re-run).
 *
 * THE PATH-2 HARD FLAGS (the runbook §A.0 / blocker 7) are carried in every
 * remap report footer: ARCH-029 (E7B-4) + BUG-061/BUG-072 (E7A-2/T-591) must
 * be fixed before the Path-2 verification gates — they are prerequisites of
 * the guide's Path-2 EXECUTION, not of this tooling (the EXECUTION-PLAN §6
 * sequencing note; they stay in their registered lanes).
 *
 * CREDENTIAL DISCIPLINE (the t-575 precedent): every key is read from the
 * OPERATOR environment or the CLI flags — NEVER packaged, never committed.
 * Service-role keys come from SUPABASE_SERVICE_ROLE_KEY_OLD / _NEW (or
 * --source-key / --target-key); the management token for the remap lane from
 * SUPABASE_ACCESS_TOKEN / SUPABASE_ACCESS_TOKEN_NEW. Every lane FAILS CLOSED
 * on an absent credential BEFORE any network I/O.
 *
 * OPS-015 live-lock fence: this module is a PURE module (zero side effects at
 * import time) so the t-574 suite exercises the full logic with the network
 * boundary stubbed. The remote lanes execute at the owner's cutover window
 * ONLY — zero live traffic this session.
 */

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  deriveTargetRef,
  prepareManagementSql,
  runManagementQuery,
} from "./preflight-target.mjs";

// ────────────────────────────────────────────────────────────────────────────
// The constants (unit-pinned by the t-574 suite's A gate).
// ────────────────────────────────────────────────────────────────────────────

/** The GoTrue admin API paths (per-project, service-role-key authenticated). */
export const ADMIN_USERS_PATH = "/auth/v1/admin/users";
export const ADMIN_GENERATE_LINK_PATH = "/auth/v1/admin/generate_link";
export const RECOVER_PATH = "/auth/v1/recover";

/** The offset-pagination walk parameters (page=1.., per_page=N). */
export const DEFAULT_PER_PAGE = 100;
export const MAX_PAGES = 1000;

/** The manifest schema (the export→import handoff artifact). */
export const MANIFEST_SCHEMA_VERSION = "1";

/** The operator-environment credential names (the .secrets/credentials.env names). */
export const SERVICE_KEY_ENV_SOURCE = "SUPABASE_SERVICE_ROLE_KEY_OLD";
export const SERVICE_KEY_ENV_TARGET = "SUPABASE_SERVICE_ROLE_KEY_NEW";
export const URL_ENV_SOURCE = "SUPABASE_URL_OLD";
export const URL_ENV_TARGET = "SUPABASE_URL_NEW";
export const MANAGEMENT_TOKEN_ENV_CANDIDATES = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ACCESS_TOKEN_NEW",
]);

/** The remap SQL artifact (the verify_t-376.sql scripts/ precedent). */
export const REMAP_SQL_FILE = "relocate_auth_remap.sql";
export const REMAP_CONFIRM_WORD = "REMAP";
export const REMAP_DRY_RUN_SENTINELS = Object.freeze({
  open: "-- >>> REMAP DRY-RUN (read-only) >>>",
  close: "-- <<< REMAP DRY-RUN <<<",
});
export const REMAP_APPLY_SENTINELS = Object.freeze({
  open: "-- >>> REMAP APPLY (idempotent email-match updates — submit ONLY with --apply --confirm REMAP) >>>",
  close: "-- <<< REMAP APPLY <<<",
});

/** The linkage surfaces of the 7-surface map (RELOAD-GUIDE Layer 3.1). */
export const REMAP_SURFACES = Object.freeze(["user_profiles", "parents"]);
export const REPORT_SURFACES = Object.freeze([
  "students",
  "activation_codes",
  "personnel",
  "account_approval_requests",
]);
export const HAZARD_SURFACE = "auth_users_dupes";

/** The Path-2 hard flags every remap report carries (the runbook blocker 7). */
export const PATH2_HARD_FLAGS =
  "PATH-2 HARD FLAGS (RELOAD-GUIDE §A.0 / blocker 7): ARCH-029 (restore never replays an archive to the live store — E7B-4) and " +
  "BUG-061/BUG-072 (the TIER-2 integrity reads run unscoped+uncapped — E7A-2/T-591) must be FIXED before the Path-2 verification " +
  "gates run on these surfaces; they are prerequisites of the guide's Path-2 EXECUTION, not of this tooling.";

/** The manifest allowlist — passwords/password hashes are NEVER carried (Layer 3.3). */
export const MANIFEST_USER_FIELDS = Object.freeze([
  "id",
  "email",
  "phone",
  "raw_user_meta_data",
  "app_metadata",
  "created_at",
  "last_sign_in_at",
  "email_confirmed_at",
  "phone_confirmed_at",
  "banned_until",
  "role",
  "aud",
]);

/** The fields the create body may carry (the AdminUserParams surface). */
export const CREATE_BODY_KEYS = Object.freeze([
  "id",
  "email",
  "phone",
  "email_confirm",
  "phone_confirm",
  "user_metadata",
  "app_metadata",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function normalizeUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(trimmed)) return null;
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested by the t-574 suite's C/D/E gates).
// ────────────────────────────────────────────────────────────────────────────

/**
 * sanitizeExportedUser — project a raw GoTrue UserSchema row onto the manifest
 * allowlist. REFUSES a non-UUID id (the UUID-preserving contract starts here:
 * a manifest row without a usable UUID is dead weight for the import lane).
 * Password-material fields are dropped BY CONSTRUCTION (the allowlist) — and
 * their presence in the raw row is flagged so a hostile/changed API surface
 * can never smuggle hashes into the manifest.
 *
 * @returns {{ ok: boolean, user?: object, reason?: string, passwordMaterialSeen?: boolean }}
 */
export function sanitizeExportedUser(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "the exported row is not an object" };
  }
  const passwordMaterialSeen = ["password", "password_hash", "encrypted_password"].some(
    (key) => raw[key] != null,
  );
  if (!isUuid(raw.id)) {
    return { ok: false, reason: `the exported row's id is not a UUID ("${String(raw.id)}")`, passwordMaterialSeen };
  }
  if (typeof raw.email !== "string" || !raw.email.trim()) {
    return { ok: false, reason: `user ${raw.id} carries no usable email (the remap fallback keys on email)`, passwordMaterialSeen };
  }
  const user = { id: raw.id, email: raw.email.trim() };
  if (typeof raw.phone === "string" && raw.phone.trim()) user.phone = raw.phone.trim();
  for (const key of ["raw_user_meta_data", "app_metadata"]) {
    if (raw[key] != null) {
      user[key] = typeof raw[key] === "object" && !Array.isArray(raw[key]) ? raw[key] : {};
    }
  }
  for (const key of ["created_at", "last_sign_in_at", "email_confirmed_at", "phone_confirmed_at", "banned_until"]) {
    if (raw[key] != null) user[key] = raw[key];
  }
  for (const key of ["role", "aud"]) {
    if (typeof raw[key] === "string" && raw[key]) user[key] = raw[key];
  }
  return { ok: true, user, passwordMaterialSeen };
}

/**
 * buildCreateUserBody — the §A.3.2.1 create payload: the SAME id (the
 * AdminUserParams.Id contract), the email, email_confirm/phone_confirm=true,
 * and the metadata. NEVER password / password_hash (Layer 3.3: the reset flow
 * owns credentials; a create-body carrying hashes would be credential
 * smuggling). Record-only fields (created_at & friends) are dropped — the
 * server sets them.
 *
 * @returns {{ ok: boolean, body?: object, reason?: string }}
 */
export function buildCreateUserBody(user) {
  if (!user || typeof user !== "object") {
    return { ok: false, reason: "the manifest row is not an object" };
  }
  if (!isUuid(user.id)) {
    return { ok: false, reason: `user id "${String(user.id)}" is not a UUID — the UUID-preserving contract refuses the create` };
  }
  if (typeof user.email !== "string" || !user.email.trim()) {
    return { ok: false, reason: `user ${user.id} carries no email — the email is mandatory on the create call` };
  }
  if (user.password != null || user.password_hash != null) {
    return { ok: false, reason: "REFUSED: the create body must never carry password material (Layer 3.3 — the reset flow owns credentials)" };
  }
  const body = {
    id: user.id,
    email: user.email.trim(),
    email_confirm: true,
    user_metadata: user.raw_user_meta_data ?? {},
    app_metadata: user.app_metadata ?? {},
  };
  if (typeof user.phone === "string" && user.phone.trim()) {
    body.phone = user.phone.trim();
    body.phone_confirm = true;
  }
  return { ok: true, body };
}

/**
 * evaluatePreservation — the per-user verdict: "created" is NOT "preserved".
 * The intended user (the manifest row) vs the created/fetched user (the
 * target's answer). id must match EXACTLY; email case-insensitively.
 */
export function evaluatePreservation(intended, created) {
  const idPreserved = isUuid(intended?.id) && created?.id === intended.id;
  const emailPreserved =
    typeof intended?.email === "string" &&
    typeof created?.email === "string" &&
    intended.email.toLowerCase() === created.email.toLowerCase();
  const ok = idPreserved && emailPreserved;
  return {
    ok,
    idPreserved,
    emailPreserved,
    detail: ok
      ? `user ${intended.id} preserved (id + email)`
      : `user ${String(intended?.id)} NOT preserved — created id "${String(created?.id)}", created email "${String(created?.email)}" — the §A.4.3.3b email-match remap is the remediation`,
  };
}

/** Classify a create-call non-200 (the 422 duplicate-email lane = already-present re-run path). */
export function classifyCreateFailure(status, body) {
  const code = typeof body?.code === "string" ? body.code : typeof body?.msg === "string" ? body.msg : "";
  if (status === 422 && /email|duplicate|exists/i.test(String(code))) {
    return { kind: "email-exists", detail: `422 duplicate email (${code})` };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", detail: `HTTP ${status} — the service-role key was rejected` };
  }
  return { kind: "http", detail: `HTTP ${status} from the admin create call${code ? ` (${code})` : ""}` };
}

// ────────────────────────────────────────────────────────────────────────────
// The remap SQL artifact handling (the F/I/J gates).
// ────────────────────────────────────────────────────────────────────────────

/**
 * parseRemapSqlSections — extract the DRY-RUN and APPLY sections out of the
 * shipped relocate_auth_remap.sql by their sentinel comments. REFUSES an
 * incomplete artifact (a missing section = the tool fails closed rather than
 * improvising SQL).
 */
export function parseRemapSqlSections(fileText) {
  if (typeof fileText !== "string" || !fileText.trim()) {
    return { ok: false, reason: "the remap SQL artifact is empty" };
  }
  const extract = (sentinels) => {
    const open = fileText.indexOf(sentinels.open);
    const close = fileText.indexOf(sentinels.close);
    if (open < 0 || close < 0 || close <= open) return null;
    return fileText.slice(open + sentinels.open.length, close).trim();
  };
  const dryRun = extract(REMAP_DRY_RUN_SENTINELS);
  const apply = extract(REMAP_APPLY_SENTINELS);
  if (!dryRun || !apply) {
    return { ok: false, reason: "the remap SQL artifact is missing a sentinel-delimited section" };
  }
  return { ok: true, dryRun, apply };
}

/** Read the REAL remap SQL artifact shipped next to this module. */
export function readRemapSections(repoDir) {
  const base = repoDir ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  let fileText;
  try {
    fileText = readFileSync(join(base, "scripts", REMAP_SQL_FILE), "utf8");
  } catch (error) {
    return { ok: false, reason: `cannot read scripts/${REMAP_SQL_FILE}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return parseRemapSqlSections(fileText);
}

/**
 * assertApplySql — the write-lane wrapper discipline: the APPLY payload must
 * open with BEGIN and close with COMMIT (a transactional, all-or-nothing
 * submission). REFUSES anything else — unwrapped SQL is never submitted
 * through this tool.
 */
export function assertApplySql(sql) {
  if (typeof sql !== "string" || !sql.trim()) {
    return { ok: false, reason: "REFUSED: the apply payload is empty" };
  }
  const strippedComments = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
  if (!/^begin\b/i.test(strippedComments.trim())) {
    return { ok: false, reason: "REFUSED: the apply payload must open with BEGIN (unwrapped write SQL is never submitted)" };
  }
  if (!/commit\s*;?\s*$/i.test(sql.trim())) {
    return { ok: false, reason: "REFUSED: the apply payload must close with COMMIT (all-or-nothing submission)" };
  }
  return { ok: true, sql: sql.trim() };
}

/**
 * evaluateRemapReport — the dry-run/post-verify verdict over the union-all
 * census rows (one row per surface + the hazard row). Counts arrive as
 * strings or numbers from the management wire — coerced.
 *
 * ok semantics: the REPORT is valid (every expected surface answered with
 * coherent counts) and no duplicate-email hazard stands. rows_would_change >
 * 0 on a remap surface is the PRE-APPLY state the dry-run exists to REPORT
 * (not itself a failure); the post-verify convergence check
 * (evaluateConvergence) is what demands 0.
 */
export function evaluateRemapReport(rows) {
  const expectedSurfaces = [...REMAP_SURFACES, ...REPORT_SURFACES];
  const list = Array.isArray(rows) ? rows : [];
  const bySurface = new Map();
  for (const row of list) {
    const surface = typeof row?.surface === "string" ? row.surface : "";
    if (surface) bySurface.set(surface, row);
  }
  const missing = expectedSurfaces.filter((surface) => !bySurface.has(surface));
  const num = (row, key) => {
    const value = Number(row?.[key]);
    return Number.isFinite(value) ? value : 0;
  };
  const surfaces = {};
  for (const surface of expectedSurfaces) {
    const row = bySurface.get(surface) ?? {};
    surfaces[surface] = {
      mode: row.mode === "remap" || row.mode === "report" ? row.mode : surface === "parents" || surface === "user_profiles" ? "remap" : "report",
      rowsTotal: num(row, "rows_total"),
      rowsWithEmail: num(row, "rows_with_email"),
      rowsMatched: num(row, "rows_matched"),
      rowsWouldChange: num(row, "rows_would_change"),
      rowsAlreadyCorrect: num(row, "rows_already_correct"),
      rowsUnmatched: num(row, "rows_unmatched"),
      rowsDangling: num(row, "rows_dangling"),
    };
  }
  const hazardRow = bySurface.get(HAZARD_SURFACE) ?? {};
  const duplicateEmailUsers = num(hazardRow, "rows_total");
  const duplicateEmailGroups = num(hazardRow, "rows_matched");
  const hazards = [];
  if (duplicateEmailUsers > 0) {
    hazards.push(
      `auth.users carries ${duplicateEmailUsers} users in ${duplicateEmailGroups} duplicated lower(email) group(s) — the email-match UPDATE … FROM picks an ARBITRARY match; resolve the duplicates before the remap`,
    );
  }
  const failures = [...missing.map((surface) => `the census is missing the ${surface} surface row`), ...hazards];
  return {
    ok: failures.length === 0,
    surfaces,
    hazards,
    failures,
    footer: PATH2_HARD_FLAGS,
    detail:
      failures.length === 0
        ? `the 7-surface census answered (remap: ${REMAP_SURFACES.join(", ")}; report: ${REPORT_SURFACES.join(", ")}; hazard clear)`
        : failures.join("; "),
  };
}

/**
 * evaluateConvergence — the POST-VERIFY verdict: after the APPLY, both remap
 * surfaces must read rows_would_change = 0 AND the duplicate hazard must stay
 * clear. "N rows updated" is NOT convergence — the post-state is.
 */
export function evaluateConvergence(report) {
  const failures = [];
  for (const surface of REMAP_SURFACES) {
    const row = report?.surfaces?.[surface];
    if (!row) {
      failures.push(`the post-verify census is missing the ${surface} surface`);
      continue;
    }
    if (row.rowsWouldChange !== 0) {
      failures.push(`${surface} still carries ${row.rowsWouldChange} row(s) that WOULD change — the remap did not converge`);
    }
  }
  if ((report?.hazards?.length ?? 0) > 0) {
    failures.push(...report.hazards);
  }
  return {
    ok: failures.length === 0,
    failures,
    detail: failures.length === 0 ? "the email-match remap converged (rows_would_change = 0 on both remap surfaces)" : failures.join("; "),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The network boundary (fetchImpl-injected, fail-closed before any I/O).
// ────────────────────────────────────────────────────────────────────────────

function requireServiceKey(serviceKey) {
  if (!serviceKey || typeof serviceKey !== "string" || !serviceKey.trim()) {
    return {
      ok: false,
      detail: `missing service-role key — pass --source-key/--target-key or export ${SERVICE_KEY_ENV_SOURCE} / ${SERVICE_KEY_ENV_TARGET} (read from the OPERATOR environment, never packaged)`,
    };
  }
  return { ok: true, key: serviceKey.trim() };
}

/**
 * authAdminRequest — one GoTrue admin-API round trip: apikey + Bearer (both
 * the service-role key), JSON bodies. FAIL-CLOSED on a missing base URL or
 * key BEFORE any network I/O.
 */
export async function authAdminRequest({ baseUrl, serviceKey, method = "GET", path, query, body, fetchImpl = fetch }) {
  const base = normalizeUrl(baseUrl);
  if (!base) {
    return { ok: false, kind: "fail-closed", status: 0, data: null, detail: `missing or invalid project URL ("${String(baseUrl)}" — an https://*.supabase.co base is expected)` };
  }
  const keyCheck = requireServiceKey(serviceKey);
  if (!keyCheck.ok) {
    return { ok: false, kind: "fail-closed", status: 0, data: null, detail: keyCheck.detail };
  }
  let url = `${base}${path}`;
  if (query && typeof query === "object" && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null) params.set(key, String(value));
    }
    url += `?${params.toString()}`;
  }
  const headers = { apikey: keyCheck.key, Authorization: `Bearer ${keyCheck.key}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    return { ok: false, kind: "network", status: 0, data: null, detail: `GoTrue admin call transport failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? "auth" : "http";
    return { ok: false, kind, status: response.status, data, detail: `HTTP ${response.status} from ${path}${kind === "auth" ? " — the service-role key was rejected" : ""}` };
  }
  return { ok: true, kind: "ok", status: response.status, data };
}

/**
 * exportAllAuthUsers — §A.3.1.2: the UUID-preserving walk.
 * GET {base}/auth/v1/admin/users?page=N&per_page=P until a page returns
 * fewer users than per_page (the short-page exhaustion rule) or an empty
 * page; the MAX_PAGES guard stops a runaway walk loudly. Rows are sanitized
 * onto the allowlist as they arrive (password material never accumulates).
 *
 * @returns {{ ok, users?, pages?, failures?, detail }}
 */
export async function exportAllAuthUsers({ baseUrl, serviceKey, perPage = DEFAULT_PER_PAGE, fetchImpl = fetch }) {
  const size = Number.isFinite(perPage) && perPage >= 1 && perPage <= 1000 ? Math.floor(perPage) : DEFAULT_PER_PAGE;
  const users = [];
  const failures = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const verdict = await authAdminRequest({
      baseUrl,
      serviceKey,
      path: ADMIN_USERS_PATH,
      query: { page, per_page: size },
      fetchImpl,
    });
    if (!verdict.ok) {
      if (verdict.kind === "fail-closed") {
        return { ok: false, users: [], pages: page - 1, failures: [verdict.detail], detail: verdict.detail };
      }
      failures.push(`page ${page}: ${verdict.detail}`);
      return { ok: false, users, pages: page - 1, failures, detail: `the export walk stopped at page ${page}: ${verdict.detail}` };
    }
    const pageUsers = Array.isArray(verdict.data?.users) ? verdict.data.users : null;
    if (!pageUsers) {
      failures.push(`page ${page}: the response carries no users array (unexpected GoTrue shape)`);
      return { ok: false, users, pages: page - 1, failures, detail: failures[failures.length - 1] };
    }
    for (const raw of pageUsers) {
      const sanitized = sanitizeExportedUser(raw);
      if (sanitized.ok) {
        users.push(sanitized.user);
      } else {
        failures.push(sanitized.reason);
      }
    }
    if (pageUsers.length < size) {
      return { ok: failures.length === 0, users, pages: page, failures, detail: `the walk exhausted at page ${page} (${users.length} users exported; ${failures.length} row(s) refused the allowlist)` };
    }
  }
  failures.push(`the walk hit the MAX_PAGES guard (${MAX_PAGES} pages × ${size}) — refusing to trust a truncated export`);
  return { ok: false, users, pages: MAX_PAGES, failures, detail: failures[failures.length - 1] };
}

/**
 * importAuthUser — §A.3.2.1 for ONE manifest user: create with the SAME id,
 * then GET the user back and verify preservation. The 422 duplicate-email
 * lane resolves via the id-GET: same id = the idempotent re-run; a 404 (or a
 * different owner) = an email conflict routed to the remap remediation.
 */
export async function importAuthUser({ baseUrl, serviceKey, user, verifyOnly = false, fetchImpl = fetch }) {
  const built = buildCreateUserBody(user);
  if (!built.ok) {
    return { ok: false, outcome: "refused", preserved: false, detail: built.reason };
  }
  if (!verifyOnly) {
    const created = await authAdminRequest({
      baseUrl,
      serviceKey,
      method: "POST",
      path: ADMIN_USERS_PATH,
      body: built.body,
      fetchImpl,
    });
    if (!created.ok) {
      if (created.kind === "fail-closed") {
        return { ok: false, outcome: "refused", preserved: false, detail: created.detail };
      }
      const classified = classifyCreateFailure(created.status, created.data);
      if (classified.kind === "email-exists") {
        const existing = await authAdminRequest({
          baseUrl,
          serviceKey,
          path: `${ADMIN_USERS_PATH}/${built.body.id}`,
          fetchImpl,
        });
        if (existing.ok) {
          const verdict = evaluatePreservation(user, existing.data);
          return { ok: verdict.ok, outcome: "already-present", preserved: verdict.ok, detail: `${classified.detail}; the id-GET confirms the user already exists — ${verdict.detail}` };
        }
        return {
          ok: false,
          outcome: "email-conflict",
          preserved: false,
          detail: `${classified.detail}; the id-GET ${existing.ok ? "" : `answered ${existing.status} — `}the email is owned by a DIFFERENT user on the target — run the §A.4.3.3b email-match remap`,
        };
      }
      return { ok: false, outcome: "create-failed", preserved: false, detail: created.detail };
    }
  }
  // The per-user verification: "created" is NOT "preserved" — read it back.
  const verified = await authAdminRequest({
    baseUrl,
    serviceKey,
    path: `${ADMIN_USERS_PATH}/${built.body.id}`,
    fetchImpl,
  });
  if (!verified.ok) {
    return {
      ok: false,
      outcome: verifyOnly ? "verify-missing" : "verify-failed",
      preserved: false,
      detail: `the post-create verification GET answered ${verified.status} (${verified.detail}) — the user's existence is unproven, FAIL-LOUD`,
    };
  }
  const verdict = evaluatePreservation(user, verified.data);
  if (!verdict.ok) {
    return {
      ok: false,
      outcome: verifyOnly ? "verify-drifted" : "not-preserved",
      preserved: false,
      detail: verdict.detail,
    };
  }
  return {
    ok: true,
    outcome: verifyOnly ? "verify-present" : "created-prescribed-id-verified",
    preserved: true,
    detail: verdict.detail,
  };
}

/**
 * runImport — the per-user-isolated import loop (one bad row never aborts
 * the batch — the report names every outcome).
 */
export async function runImport({ baseUrl, serviceKey, manifest, verifyOnly = false, fetchImpl = fetch }) {
  const rows = Array.isArray(manifest?.users) ? manifest.users : [];
  if (!Array.isArray(manifest?.users) || typeof manifest?.schemaVersion !== "string") {
    return {
      ok: false,
      results: [],
      created: 0,
      alreadyPresent: 0,
      failed: 0,
      conflicts: 0,
      failures: ["the manifest is not a relocate-auth artifact (schemaVersion/users missing) — refusing it"],
      detail: "the manifest failed the shape gate",
    };
  }
  const results = [];
  let created = 0;
  let alreadyPresent = 0;
  let conflicts = 0;
  let failed = 0;
  for (const user of rows) {
    const verdict = await importAuthUser({ baseUrl, serviceKey, user, verifyOnly, fetchImpl });
    results.push({ id: user?.id, email: user?.email, outcome: verdict.outcome, preserved: verdict.preserved, detail: verdict.detail });
    if (verdict.outcome === "created-prescribed-id-verified") created += 1;
    else if (verdict.outcome === "already-present" && verdict.preserved) alreadyPresent += 1;
    else if (verdict.outcome === "email-conflict") conflicts += 1;
    else failed += 1;
  }
  const failures = results.filter((row) => !row.preserved && row.outcome !== "already-present").map((row) => `${row.id} (${row.outcome}): ${row.detail}`);
  const ok = rows.length > 0 ? created + alreadyPresent === rows.length : false;
  return {
    ok,
    results,
    created,
    alreadyPresent,
    conflicts,
    failed,
    failures,
    detail: rows.length === 0
      ? "the manifest carries ZERO users — refusing to certify an empty import"
      : `import: ${created} created + ${alreadyPresent} already-present of ${rows.length} (${conflicts} email-conflict, ${failed} failed)`,
  };
}

/**
 * generateRecoveryLink — the link-mode reset (POST /auth/v1/admin/generate_link
 * type=recovery). Returns the action_link/email_otp pair for the operator to
 * distribute over a secure channel — the report file is written 0600 and is
 * NEVER committed.
 */
export async function generateRecoveryLink({ baseUrl, serviceKey, email, redirectTo, fetchImpl = fetch }) {
  const base = normalizeUrl(baseUrl);
  const keyCheck = requireServiceKey(serviceKey);
  if (!base) {
    return { ok: false, detail: `missing or invalid project URL ("${String(baseUrl)}")` };
  }
  if (!keyCheck.ok) {
    return { ok: false, detail: keyCheck.detail };
  }
  if (typeof email !== "string" || !email.trim()) {
    return { ok: false, detail: "the recovery link lane needs an email per user" };
  }
  const body = { type: "recovery", email: email.trim() };
  if (typeof redirectTo === "string" && redirectTo.trim()) body.redirect_to = redirectTo.trim();
  const verdict = await authAdminRequest({ baseUrl, serviceKey, method: "POST", path: ADMIN_GENERATE_LINK_PATH, body, fetchImpl });
  if (!verdict.ok) {
    return { ok: false, status: verdict.status, detail: verdict.detail };
  }
  if (typeof verdict.data?.action_link !== "string" || !verdict.data.action_link) {
    return { ok: false, status: verdict.status, detail: "the generate_link response carries no action_link — refusing to certify the reset" };
  }
  return {
    ok: true,
    email: email.trim(),
    action_link: verdict.data.action_link,
    email_otp: typeof verdict.data.email_otp === "string" ? verdict.data.email_otp : null,
    verification_type: typeof verdict.data.verification_type === "string" ? verdict.data.verification_type : null,
  };
}

/**
 * sendRecoveryEmail — the email-mode reset (POST /auth/v1/recover — the
 * platform's own reset email; requires SMTP configured on the target).
 */
export async function sendRecoveryEmail({ baseUrl, serviceKey, email, fetchImpl = fetch }) {
  const base = normalizeUrl(baseUrl);
  const keyCheck = requireServiceKey(serviceKey);
  if (!base) {
    return { ok: false, detail: `missing or invalid project URL ("${String(baseUrl)}")` };
  }
  if (!keyCheck.ok) {
    return { ok: false, detail: keyCheck.detail };
  }
  if (typeof email !== "string" || !email.trim()) {
    return { ok: false, detail: "the reset-email lane needs an email per user" };
  }
  const verdict = await authAdminRequest({ baseUrl, serviceKey, method: "POST", path: RECOVER_PATH, body: { email: email.trim() }, fetchImpl });
  if (!verdict.ok) {
    return { ok: false, status: verdict.status, detail: verdict.detail };
  }
  return { ok: true, email: email.trim(), detail: "the platform reset email was dispatched" };
}

/** buildResetReport — the link-mode report text (the one-time links are SECRET-class). */
export function buildResetReport(results, meta = {}) {
  const header = [
    "# relocate-auth reset links (SECRET-CLASS — one-time recovery material)",
    `# generated: ${meta.generatedAt ?? new Date().toISOString()}`,
    `# target: ${meta.targetUrl ?? "(unknown)"}`,
    "# distribute over a secure channel; this file is never committed.",
    "",
  ];
  const lines = [];
  for (const result of results) {
    if (result.ok) {
      lines.push(`${result.email} -> ${result.action_link}${result.email_otp ? ` (otp ${result.email_otp})` : ""}`);
    } else {
      lines.push(`${result.email ?? "(unknown)"} -> FAILED: ${result.detail}`);
    }
  }
  return header.concat(lines, "").join("\n");
}

/** writeResetReport — persist the reset report with 0600 perms (never world-readable). */
export function writeResetReportFile(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

// ────────────────────────────────────────────────────────────────────────────
// The remap lanes (the §11.1 Management-API wire — reused from T-575).
// ────────────────────────────────────────────────────────────────────────────

function resolveManagementToken(processEnv = {}) {
  for (const name of MANAGEMENT_TOKEN_ENV_CANDIDATES) {
    const value = (processEnv?.[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/**
 * runRemapDryRun — the read-only census through the §11.1 wire: the DRY-RUN
 * section prepared by the T-446 convention (BEGIN + trailing-ROLLBACK strip),
 * submitted to the Management-API SQL endpoint, reduced by
 * evaluateRemapReport. FAILS CLOSED on a missing ref/token BEFORE any
 * network I/O.
 */
export async function runRemapDryRun({ targetUrl, managementToken, repoDir, fetchImpl = fetch }) {
  const projectRef = deriveTargetRef(targetUrl);
  if (!projectRef) {
    return { ok: false, kind: "fail-closed", detail: `"${String(targetUrl)}" is not an https://<20-char-ref>.supabase.co target URL` };
  }
  const token = typeof managementToken === "string" ? managementToken.trim() : "";
  if (!token) {
    return {
      ok: false,
      kind: "fail-closed",
      detail: `missing management token — export ${MANAGEMENT_TOKEN_ENV_CANDIDATES.join(" or ")} (read from the OPERATOR environment, never packaged); the remap lane FAILS CLOSED`,
    };
  }
  const sections = readRemapSections(repoDir);
  if (!sections.ok) {
    return { ok: false, kind: "fail-closed", detail: sections.reason };
  }
  let prepared;
  try {
    prepared = prepareManagementSql(sections.dryRun);
  } catch (error) {
    return { ok: false, kind: "fail-closed", detail: `the DRY-RUN section failed the T-446 convention: ${error instanceof Error ? error.message : String(error)}` };
  }
  const verdict = await runManagementQuery({ projectRef, accessToken: token, query: prepared, fetchImpl });
  if (!verdict.ok) {
    return { ok: false, kind: verdict.kind ?? "http", detail: `the remap dry-run census failed: ${verdict.detail}` };
  }
  const report = evaluateRemapReport(verdict.rows);
  return { ok: report.ok, kind: "ok", report, rows: verdict.rows, detail: report.detail, footer: report.footer };
}

/**
 * runRemapApply — the double-fenced write lane: `--apply --confirm REMAP`.
 * The confirm word gates the submission; without it the lane REFUSES with
 * ZERO network I/O. After the apply, the dry-run census is re-run —
 * "N rows updated" is NOT convergence; rows_would_change must read 0.
 */
export async function runRemapApply({ targetUrl, managementToken, confirm, repoDir, fetchImpl = fetch }) {
  if (confirm !== REMAP_CONFIRM_WORD) {
    return {
      ok: false,
      kind: "fail-closed",
      detail: `REFUSED: the remap apply is double-fenced — pass --apply AND --confirm ${REMAP_CONFIRM_WORD} (zero network I/O otherwise)`,
    };
  }
  const projectRef = deriveTargetRef(targetUrl);
  if (!projectRef) {
    return { ok: false, kind: "fail-closed", detail: `"${String(targetUrl)}" is not an https://<20-char-ref>.supabase.co target URL` };
  }
  const token = typeof managementToken === "string" ? managementToken.trim() : "";
  if (!token) {
    return {
      ok: false,
      kind: "fail-closed",
      detail: `missing management token — export ${MANAGEMENT_TOKEN_ENV_CANDIDATES.join(" or ")} (OPERATOR environment only); the remap apply FAILS CLOSED`,
    };
  }
  const sections = readRemapSections(repoDir);
  if (!sections.ok) {
    return { ok: false, kind: "fail-closed", detail: sections.reason };
  }
  const guarded = assertApplySql(sections.apply);
  if (!guarded.ok) {
    return { ok: false, kind: "fail-closed", detail: guarded.reason };
  }
  const applied = await runManagementQuery({ projectRef, accessToken: token, query: guarded.sql, fetchImpl });
  if (!applied.ok) {
    return { ok: false, kind: applied.kind ?? "http", detail: `the remap apply failed: ${applied.detail}` };
  }
  const postVerify = await runRemapDryRun({ targetUrl, managementToken: token, repoDir, fetchImpl });
  if (!postVerify.ok && postVerify.kind === "fail-closed") {
    return { ok: false, kind: "fail-closed", detail: `the post-verify census could not run: ${postVerify.detail}` };
  }
  const report = postVerify.ok ? postVerify.report : evaluateRemapReport(postVerify.rows ?? []);
  const convergence = evaluateConvergence(report);
  return {
    ok: convergence.ok,
    applied: true,
    postVerify: report,
    convergence,
    footer: report.footer,
    detail: convergence.ok
      ? `the remap applied and CONVERGED — ${convergence.detail}`
      : `the remap applied but did NOT converge: ${convergence.failures.join("; ")}`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The CLI (the four lanes; the pure-module guard — importing this module
// never triggers anything).
// ────────────────────────────────────────────────────────────────────────────

function usage(exitCode) {
  console.error(`usage: relocate-auth.mjs <export|import|reset|remap> [options]
  export — the UUID-preserving auth-user walk off the SOURCE project
          --source-url <https://old.supabase.co>   (env: ${URL_ENV_SOURCE})
          --source-key <service-role key>           (env: ${SERVICE_KEY_ENV_SOURCE})
          [--per-page N] (default ${DEFAULT_PER_PAGE})  [--out <manifest.json>]
  import — POST each manifest user with the SAME id, then verify per user
          --target-url <https://new.supabase.co>   (env: ${URL_ENV_TARGET})
          --target-key <service-role key>          (env: ${SERVICE_KEY_ENV_TARGET})
          --manifest <file>                        [--verify-only]
  reset  — the password-reset communication flow per manifest user
          --target-url … --target-key … --manifest <file>
          [--mode link|email] (default link)  [--redirect-to <url>]  [--report <file>]
  remap  — the §A.4.3.3b email-match remap census/apply
          --target-url …                          (management token from env)
          [--dry-run] (default)  |  --apply --confirm ${REMAP_CONFIRM_WORD}

Every lane FAILS CLOSED on absent credentials (zero network I/O).
The remote lanes execute at the owner's cutover window ONLY (OPS-015/G2).`);
  process.exit(exitCode);
}

function readFlag(args, ...names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1];
  }
  return undefined;
}

async function cliMain(argv) {
  const [subcommand, ...rest] = argv.slice(2);
  const env = process.env;
  if (!subcommand || ["--help", "-h", "help"].includes(subcommand)) usage(2);

  if (subcommand === "export") {
    const baseUrl = readFlag(rest, "--source-url") ?? env[URL_ENV_SOURCE];
    const serviceKey = readFlag(rest, "--source-key") ?? env[SERVICE_KEY_ENV_SOURCE];
    const perPage = Number(readFlag(rest, "--per-page") ?? DEFAULT_PER_PAGE);
    const out = readFlag(rest, "--out") ?? "relocation-auth-manifest.json";
    const verdict = await exportAllAuthUsers({ baseUrl, serviceKey, perPage });
    if (verdict.users.length > 0 || verdict.ok) {
      const manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        sourceUrl: normalizeUrl(baseUrl),
        exportedAt: new Date().toISOString(),
        userCount: verdict.users.length,
        pages: verdict.pages,
        users: verdict.users,
      };
      writeResetReportFile(out, JSON.stringify(manifest, null, 2));
      console.log(`relocate-auth export: ${verdict.users.length} user(s) over ${verdict.pages} page(s) -> ${out} (0600)`);
    }
    for (const failure of verdict.failures ?? []) console.error(`  - ${failure}`);
    if (!verdict.ok) {
      console.error(`relocate-auth export: FAILED — ${verdict.detail}`);
      process.exit(1);
    }
    return;
  }

  if (subcommand === "import") {
    const baseUrl = readFlag(rest, "--target-url") ?? env[URL_ENV_TARGET];
    const serviceKey = readFlag(rest, "--target-key") ?? env[SERVICE_KEY_ENV_TARGET];
    const manifestPath = readFlag(rest, "--manifest");
    const verifyOnly = rest.includes("--verify-only");
    if (!manifestPath) usage(2);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      console.error(`relocate-auth import: cannot read the manifest: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
    const verdict = await runImport({ baseUrl, serviceKey, manifest, verifyOnly });
    console.log(`relocate-auth import${verifyOnly ? " (verify-only)" : ""}: ${verdict.detail}`);
    for (const row of verdict.results) console.log(`  [${row.preserved ? "OK" : "FAIL"}] ${row.id} (${row.outcome}) — ${row.detail}`);
    for (const failure of verdict.failures) console.error(`  - ${failure}`);
    if (!verdict.ok) process.exit(1);
    return;
  }

  if (subcommand === "reset") {
    const baseUrl = readFlag(rest, "--target-url") ?? env[URL_ENV_TARGET];
    const serviceKey = readFlag(rest, "--target-key") ?? env[SERVICE_KEY_ENV_TARGET];
    const manifestPath = readFlag(rest, "--manifest");
    const mode = readFlag(rest, "--mode") === "email" ? "email" : "link";
    const redirectTo = readFlag(rest, "--redirect-to");
    const reportPath = readFlag(rest, "--report") ?? `relocate-auth-reset-${mode === "email" ? "emails" : "links"}.txt`;
    if (!manifestPath) usage(2);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      console.error(`relocate-auth reset: cannot read the manifest: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
    const results = [];
    for (const user of manifest.users ?? []) {
      const email = typeof user?.email === "string" ? user.email : null;
      if (!email) {
        results.push({ ok: false, email: null, detail: `user ${user?.id} carries no email — skipped` });
        continue;
      }
      const verdict = mode === "email"
        ? await sendRecoveryEmail({ baseUrl, serviceKey, email, fetchImpl: fetch })
        : await generateRecoveryLink({ baseUrl, serviceKey, email, redirectTo });
      results.push(verdict.ok ? verdict : { ok: false, email, detail: verdict.detail });
    }
    if (mode === "link") {
      writeResetReportFile(reportPath, buildResetReport(results, { targetUrl: normalizeUrl(baseUrl) }));
      console.log(`relocate-auth reset (link mode): the report -> ${reportPath} (0600 — SECRET-CLASS material, never committed)`);
    }
    const failed = results.filter((result) => !result.ok);
    console.log(`relocate-auth reset: ${results.length - failed.length}/${results.length} user(s) dispatched (${mode} mode)`);
    for (const failure of failed) console.error(`  - ${failure.email ?? "(unknown)"}: ${failure.detail}`);
    if (results.length === 0 || failed.length === results.length) process.exit(1);
    return;
  }

  if (subcommand === "remap") {
    const baseUrl = readFlag(rest, "--target-url") ?? env[URL_ENV_TARGET];
    const apply = rest.includes("--apply");
    const confirm = readFlag(rest, "--confirm");
    if (apply) {
      const verdict = await runRemapApply({ targetUrl: baseUrl, managementToken: resolveManagementToken(env), confirm, repoDir: undefined });
      console.log(`relocate-auth remap (apply): ${verdict.detail}`);
      console.error(`  ${verdict.footer}`);
      if (!verdict.ok) process.exit(1);
      return;
    }
    const verdict = await runRemapDryRun({ targetUrl: baseUrl, managementToken: resolveManagementToken(env), repoDir: undefined });
    for (const [surface, row] of Object.entries(verdict.report?.surfaces ?? {})) {
      console.log(
        `  ${surface} (${row.mode}): total ${row.rowsTotal} · would-change ${row.rowsWouldChange} · already-correct ${row.rowsAlreadyCorrect} · unmatched ${row.rowsUnmatched} · dangling ${row.rowsDangling}`,
      );
    }
    for (const hazard of verdict.report?.hazards ?? []) console.error(`  - HAZARD: ${hazard}`);
    console.error(`  ${verdict.footer}`);
    if (!verdict.ok) {
      console.error(`relocate-auth remap (dry-run): ${verdict.detail}`);
      process.exit(1);
    }
    console.log(`relocate-auth remap (dry-run): ${verdict.detail}`);
    return;
  }

  usage(2);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await cliMain(process.argv);
}
