// ============================================================================
// FILE: src/features/settings/supabase-diagnostics/diagnostics-runner.ts
// ============================================================================
/**
 * T-393 — the deterministic Supabase diagnostics runner (handed-over Task 21).
 *
 * Executes the ORDERED probe sequence (each check independent, every result
 * honest — a failing leg never aborts the run; only mock-mode short-circuits):
 *
 *   1. Configuration   — describeSupabaseConnection() (the canonical singleton
 *                        describe — host + key FORMAT only, never the key)
 *   2. Réseau          — REST reachability through the SDK itself
 *   3. Authentification— getSession / getUser + the AUTH-302 cross-check
 *                        (domain session present while the SDK session is gone)
 *   4. Tenant          — user_profiles REST read + current_tenant_id RPC
 *   5. RPC             — current_user_profile_id + current_user_roles
 *   6. RLS lectures    — parents / students / classes / payments /
 *                        payment_allocations / attendance_records / personnel
 *                        (head+count reads — the row COUNT is the honest signal)
 *   7. Stockage        — listBuckets (permission-denied → NON TESTÉ by design)
 *   8. Temps réel      — one websocket channel round-trip with a timeout
 *
 * Safety rules (the describeSupabaseConnection() convention):
 *   - details contain HTTP status, error codes, table names, and row counts.
 *   - NEVER the key, NEVER tokens, NEVER the JWT, NEVER the session JSON.
 *   - the user's OWN email may appear (it is on the screen next to the button).
 *
 * The runner reuses the canonical singleton via dependency injection: the view
 * passes getSupabaseClient(); the tests pass a mock. No second client is ever
 * created here (the TASK 2 invariant).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeSupabaseConnection } from "../../../infrastructure/supabase/supabase-client";
import type {
  DiagnosticCheck,
  DiagnosticsReport,
  DiagnosticsRunOptions,
  CheckStatus,
} from "./diagnostics-types";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Supabase-js error shape (code is a string; HTTP status may come in message). */
interface SupabaseErrorLike {
  code?: string | number;
  message?: string;
}

/** Trim an error message to a SAFE one-liner (no multi-line, capped length). */
function safeMessage(err: SupabaseErrorLike | null | undefined, fallback: string): string {
  const raw = typeof err?.message === "string" ? err.message : "";
  if (!raw) return fallback;
  return raw.replace(/\s+/g, " ").slice(0, 240);
}

/** Format an error with its code, e.g. « 42501 : permission denied … ». */
function safeErrorDetail(
  err: SupabaseErrorLike | null | undefined,
  operation: string,
): string {
  const code = err?.code !== undefined && err?.code !== null ? String(err.code) : "";
  const msg = safeMessage(err, "erreur inconnue");
  const codePart = code ? `code ${code}, ` : "";
  return `${operation} — ${codePart}${msg}`;
}

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

function check(
  id: string,
  category: string,
  label: string,
  status: CheckStatus,
  detail: string,
  durationMs: number | null,
): DiagnosticCheck {
  return { id, category, label, status, detail, durationMs };
}

/* ------------------------------------------------------------------ */
/* Category constants (French — this module is i18n-scoped to itself;  */
/* the concurrent T-388 dictionary burn-down owns dictionary files)    */
/* ------------------------------------------------------------------ */

const CAT_CONFIG = "Configuration";
const CAT_NETWORK = "Réseau";
const CAT_AUTH = "Authentification";
const CAT_TENANT = "Résolution du tenant";
const CAT_RPC = "RPC serveur";
const CAT_RLS = "RLS — lectures";
const CAT_STORAGE = "Stockage";
const CAT_REALTIME = "Temps réel";

/** The deterministic RLS read matrix (handed-over Task 22 list). */
const RLS_TABLES: ReadonlyArray<{ table: string; label: string }> = [
  { table: "parents", label: "Parents (table parents)" },
  { table: "students", label: "Élèves (table students)" },
  { table: "classes", label: "Classes (table classes)" },
  { table: "payments", label: "Paiements (table payments)" },
  { table: "payment_allocations", label: "Allocations de paiement (table payment_allocations)" },
  { table: "attendance_records", label: "Pointages (table attendance_records)" },
  { table: "personnel", label: "Personnel (table personnel)" },
];

/* ------------------------------------------------------------------ */
/* Individual probes                                                   */
/* ------------------------------------------------------------------ */

function probeConfiguration(): DiagnosticCheck {
  const describe = describeSupabaseConnection();
  if (!describe.configured) {
    return check(
      "config.connection",
      CAT_CONFIG,
      "Configuration du client Supabase",
      "fail",
      "URL ou clé publique manquante — ouvrez l'onglet Configuration.",
      0,
    );
  }
  const mode = describe.isProductionBuild ? "build production" : "build développement";
  const mockNote = describe.useSupabase ? "" : " — MODE SIMULÉ (mock)";
  return check(
    "config.connection",
    CAT_CONFIG,
    "Configuration du client Supabase",
    "pass",
    `Hôte ${describe.host ?? "?"}, format de clé ${describe.keyFormat}, ${mode}${mockNote}`,
    0,
  );
}

async function probeNetworkRest(
  client: SupabaseClient,
): Promise<{ result: DiagnosticCheck; reachable: boolean }> {
  const { value, ms } = await timed(() =>
    client.from("tenants").select("id").limit(1),
  );
  const err = value.error as SupabaseErrorLike | null;
  if (err) {
    return {
      result: check(
        "network.rest",
        CAT_NETWORK,
        "Joignabilité REST (table tenants)",
        "fail",
        safeErrorDetail(err, "GET /rest/v1/tenants"),
        ms,
      ),
      reachable: false,
    };
  }
  return {
    result: check(
      "network.rest",
      CAT_NETWORK,
      "Joignabilité REST (table tenants)",
      "pass",
      `HTTP 200 — REST joignable en ${ms} ms`,
      ms,
    ),
    reachable: true,
  };
}

interface SdkSessionProbe {
  hasSdkSession: boolean;
  expiresInSeconds: number | null;
}

async function probeAuth(
  client: SupabaseClient,
  domainSession: DiagnosticsRunOptions["domainSession"],
): Promise<{ checks: DiagnosticCheck[]; sdkSession: SdkSessionProbe }> {
  const checks: DiagnosticCheck[] = [];
  let hasSdkSession = false;
  let expiresInSeconds: number | null = null;

  // --- getSession (LOCAL: reads the SDK store, no network) ---
  const sessionRes = (await client.auth.getSession()) as {
    data: { session: { expires_at?: number } | null } | null;
    error: SupabaseErrorLike | null;
  };
  const sessionError = sessionRes?.error ?? null;
  const sdkSession = sessionRes?.data?.session ?? null;
  if (sdkSession) {
    hasSdkSession = true;
    const expiresAt = typeof sdkSession.expires_at === "number" ? sdkSession.expires_at : null;
    expiresInSeconds =
      expiresAt !== null ? Math.max(0, Math.round(expiresAt - Date.now() / 1000)) : null;
    checks.push(
      check(
        "auth.sdk-session",
        CAT_AUTH,
        "Session Supabase (auth.getSession)",
        "pass",
        `Session SDK présente${expiresInSeconds !== null ? `, expire dans ${expiresInSeconds} s` : ""}.`,
        0,
      ),
    );
  } else if (sessionError) {
    checks.push(
      check(
        "auth.sdk-session",
        CAT_AUTH,
        "Session Supabase (auth.getSession)",
        "fail",
        safeErrorDetail(sessionError, "auth.getSession"),
        0,
      ),
    );
  } else {
    checks.push(
      check(
        "auth.sdk-session",
        CAT_AUTH,
        "Session Supabase (auth.getSession)",
        "fail",
        "AUCUNE session Supabase (JWT absent) — chaque appel REST part en rôle anonyme : c'est la signature AUTH-302 (200 + listes vides, sans erreur).",
        0,
      ),
    );
  }

  // --- getUser (NETWORK: validates the JWT against the auth server) ---
  const userRes = (await client.auth.getUser()) as {
    data: { user: { id: string; email?: string } | null } | null;
    error: SupabaseErrorLike | null;
  };
  const user = userRes?.data?.user ?? null;
  if (user) {
    checks.push(
      check(
        "auth.user",
        CAT_AUTH,
        "Utilisateur Supabase (auth.getUser)",
        "pass",
        `HTTP 200 — utilisateur vérifié${user.email ? ` (${user.email})` : ""}.`,
        null,
      ),
    );
  } else {
    const err = userRes?.error ?? null;
    checks.push(
      check(
        "auth.user",
        CAT_AUTH,
        "Utilisateur Supabase (auth.getUser)",
        "fail",
        err
          ? safeErrorDetail(err, "auth.getUser")
          : "Aucun utilisateur — la session est absente ou le jeton a été rejeté.",
        null,
      ),
    );
  }

  // --- the AUTH-302 cross-check (the reason this screen exists) ---
  if (domainSession && hasSdkSession) {
    checks.push(
      check(
        "auth.domain-vs-sdk",
        CAT_AUTH,
        "Cohérence session applicative ↔ session Supabase",
        "pass",
        "Les deux sessions sont alignées (session applicative + JWT Supabase présents).",
        0,
      ),
    );
  } else if (domainSession && !hasSdkSession) {
    checks.push(
      check(
        "auth.domain-vs-sdk",
        CAT_AUTH,
        "Cohérence session applicative ↔ session Supabase",
        "fail",
        "AUTH-302 : la session applicative est présente mais le JWT Supabase est ABSENT — toutes les lectures passent en anonyme et RLS renvoie des listes vides (200 OK). Reconnectez-vous.",
        0,
      ),
    );
  } else {
    checks.push(
      check(
        "auth.domain-vs-sdk",
        CAT_AUTH,
        "Cohérence session applicative ↔ session Supabase",
        "not_tested",
        "Non connecté à l'application — comparaison sans objet.",
        0,
      ),
    );
  }

  return { checks, sdkSession: { hasSdkSession, expiresInSeconds } };
}

async function probeTenant(
  client: SupabaseClient,
  hasSdkSession: boolean,
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  // --- user_profiles REST read (the buildSession shape) ---
  const profileRes = (await timed(() =>
    client.from("user_profiles").select("id,tenant_id,display_name").limit(2),
  )) as unknown as {
    value: {
      data: Array<{ id: string; tenant_id: string | null; display_name?: string | null }> | null;
      error: SupabaseErrorLike | null;
    };
    ms: number;
  };
  const profileErr = profileRes.value.error ?? null;
  const profiles = profileRes.value.data ?? [];
  if (profileErr) {
    checks.push(
      check(
        "tenant.profile-rest",
        CAT_TENANT,
        "Profil utilisateur (table user_profiles)",
        "fail",
        safeErrorDetail(profileErr, "GET /rest/v1/user_profiles"),
        profileRes.ms,
      ),
    );
  } else if (profiles.length > 0) {
    checks.push(
      check(
        "tenant.profile-rest",
        CAT_TENANT,
        "Profil utilisateur (table user_profiles)",
        "pass",
        `HTTP 200 — profil visible (tenant ${String(profiles[0]?.tenant_id ?? "?")}).`,
        profileRes.ms,
      ),
    );
  } else {
    checks.push(
      check(
        "tenant.profile-rest",
        CAT_TENANT,
        "Profil utilisateur (table user_profiles)",
        "fail",
        `HTTP 200, 0 ligne — profil INVISIBLE${hasSdkSession ? "" : " (session anonyme)"} : RLS filtre la lecture.`,
        profileRes.ms,
      ),
    );
  }

  // --- current_tenant_id RPC ---
  const tenantRes = (await timed(() => client.rpc("current_tenant_id"))) as unknown as {
    value: { data: string | null; error: SupabaseErrorLike | null };
    ms: number;
  };
  const tenantErr = tenantRes.value.error ?? null;
  if (tenantErr) {
    checks.push(
      check(
        "tenant.id-rpc",
        CAT_TENANT,
        "Résolution du tenant (RPC current_tenant_id)",
        "fail",
        safeErrorDetail(tenantErr, "RPC current_tenant_id"),
        tenantRes.ms,
      ),
    );
  } else if (tenantRes.value.data) {
    checks.push(
      check(
        "tenant.id-rpc",
        CAT_TENANT,
        "Résolution du tenant (RPC current_tenant_id)",
        "pass",
        `Tenant résolu : ${tenantRes.value.data}`,
        tenantRes.ms,
      ),
    );
  } else {
    checks.push(
      check(
        "tenant.id-rpc",
        CAT_TENANT,
        "Résolution du tenant (RPC current_tenant_id)",
        "fail",
        `RPC exécuté sans erreur mais AUCUN tenant résolu${hasSdkSession ? "" : " (session anonyme)"}.`,
        tenantRes.ms,
      ),
    );
  }

  return checks;
}

async function probeRpcs(
  client: SupabaseClient,
  hasSdkSession: boolean,
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  const profileIdRes = (await timed(() => client.rpc("current_user_profile_id"))) as unknown as {
    value: { data: string | null; error: SupabaseErrorLike | null };
    ms: number;
  };
  const profileIdErr = profileIdRes.value.error ?? null;
  if (profileIdErr) {
    checks.push(
      check(
        "rpc.profile-id",
        CAT_RPC,
        "RPC current_user_profile_id",
        "fail",
        safeErrorDetail(profileIdErr, "RPC current_user_profile_id"),
        profileIdRes.ms,
      ),
    );
  } else if (profileIdRes.value.data) {
    checks.push(
      check(
        "rpc.profile-id",
        CAT_RPC,
        "RPC current_user_profile_id",
        "pass",
        "RPC disponible, profil résolu.",
        profileIdRes.ms,
      ),
    );
  } else {
    checks.push(
      check(
        "rpc.profile-id",
        CAT_RPC,
        "RPC current_user_profile_id",
        "fail",
        `RPC exécuté mais résultat nul${hasSdkSession ? "" : " (session anonyme)"} — profil non résolu.`,
        profileIdRes.ms,
      ),
    );
  }

  const rolesRes = (await timed(() => client.rpc("current_user_roles"))) as unknown as {
    value: { data: string[] | null; error: SupabaseErrorLike | null };
    ms: number;
  };
  const rolesErr = rolesRes.value.error ?? null;
  const roles = Array.isArray(rolesRes.value.data) ? rolesRes.value.data : [];
  if (rolesErr) {
    checks.push(
      check(
        "rpc.roles",
        CAT_RPC,
        "RPC current_user_roles",
        "fail",
        safeErrorDetail(rolesErr, "RPC current_user_roles"),
        rolesRes.ms,
      ),
    );
  } else if (roles.length > 0) {
    checks.push(
      check(
        "rpc.roles",
        CAT_RPC,
        "RPC current_user_roles",
        "pass",
        `Rôles : ${roles.join(", ")}`,
        rolesRes.ms,
      ),
    );
  } else {
    checks.push(
      check(
        "rpc.roles",
        CAT_RPC,
        "RPC current_user_roles",
        "fail",
        `RPC exécuté mais AUCUN rôle${hasSdkSession ? "" : " (session anonyme)"} — l'utilisateur n'a aucune assignation visible.`,
        rolesRes.ms,
      ),
    );
  }

  return checks;
}

async function probeRlsMatrix(
  client: SupabaseClient,
  hasSdkSession: boolean,
): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  for (const { table, label } of RLS_TABLES) {
    const res = (await timed(() =>
      client.from(table).select("id", { count: "exact", head: true }),
    )) as unknown as {
      value: { count: number | null; error: SupabaseErrorLike | null };
      ms: number;
    };
    const err = res.value.error ?? null;
    if (err) {
      checks.push(
        check(table, CAT_RLS, label, "fail", safeErrorDetail(err, `SELECT ${table}`), res.ms),
      );
    } else {
      const count = res.value.count;
      const countPart = count !== null && count !== undefined ? `${count}` : "?";
      const anonNote = !hasSdkSession ? " (0 ligne attendue en session anonyme)" : "";
      checks.push(
        check(
          table,
          CAT_RLS,
          label,
          "pass",
          `HTTP 200 — ${countPart} ligne(s) visible(s)${count === 0 ? anonNote : ""}`,
          res.ms,
        ),
      );
    }
  }
  return checks;
}

async function probeStorage(client: SupabaseClient): Promise<DiagnosticCheck> {
  const res = (await timed(() => client.storage.listBuckets())) as unknown as {
    value: { data: Array<{ name: string }> | null; error: SupabaseErrorLike | null };
    ms: number;
  };
  const err = res.value.error ?? null;
  if (err) {
    const code = err.code !== undefined ? String(err.code) : "";
    const message = safeMessage(err, "erreur inconnue");
    // 42501 / 403 on bucket listing is EXPECTED for the authenticated role
    // (storage admin is service-role by design) — an honest NON TESTÉ, not a FAIL.
    const permissionDenied = code === "42501" || code === "403" || /permission|denied|forbidden/i.test(message);
    return check(
      "storage.buckets",
      CAT_STORAGE,
      "Buckets de stockage (storage.listBuckets)",
      permissionDenied ? "not_tested" : "fail",
      permissionDenied
        ? "Listage des buckets interdit au rôle authentifié (conception normale : vérifiez depuis le dashboard Supabase)."
        : safeErrorDetail(err, "storage.listBuckets"),
      res.ms,
    );
  }
  const buckets = res.value.data ?? [];
  return check(
    "storage.buckets",
    CAT_STORAGE,
    "Buckets de stockage (storage.listBuckets)",
    "pass",
    `HTTP 200 — ${buckets.length} bucket(s) visible(s).`,
    res.ms,
  );
}

async function probeRealtime(
  client: SupabaseClient,
  timeoutMs: number,
): Promise<DiagnosticCheck> {
  const channelName = `diagnostics-probe-${Date.now()}`;
  // The supabase-js channel interface (subset we drive).
  interface ChannelLike {
    on: (event: "broadcast", opts: { event: string }, cb: () => void) => ChannelLike;
    subscribe: (cb: (status: string, err?: Error) => void) => ChannelLike;
    unsubscribe: () => Promise<void> | void;
  }
  const channel = (client as unknown as {
    channel: (name: string, opts?: Record<string, unknown>) => ChannelLike;
  }).channel(channelName, { config: { broadcast: { self: false } } });

  let status = "PENDING";
  const start = Date.now();
  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const timer = setTimeout(() => {
        if (status === "PENDING") status = "TIMED_OUT";
        finish();
      }, timeoutMs);
      channel.on("broadcast", { event: "probe" }, () => {
        /* we only measure the connection status, no echo needed */
      });
      channel.subscribe((s: string) => {
        status = s;
        clearTimeout(timer);
        finish();
      });
    });
  } catch (err) {
    status = "CHANNEL_ERROR";
    return check(
      "realtime.channel",
      CAT_REALTIME,
      "Canal Realtime (websocket)",
      "fail",
      `WebSocket — ${safeMessage(err as SupabaseErrorLike, "erreur du canal")}`,
      Date.now() - start,
    );
  } finally {
    try {
      await channel.unsubscribe();
    } catch {
      /* best-effort cleanup — never masks the probe result */
    }
  }

  const ms = Date.now() - start;
  if (status === "SUBSCRIBED") {
    return check(
      "realtime.channel",
      CAT_REALTIME,
      "Canal Realtime (websocket)",
      "pass",
      `WebSocket connecté et abonné en ${ms} ms.`,
      ms,
    );
  }
  return check(
    "realtime.channel",
    CAT_REALTIME,
    "Canal Realtime (websocket)",
    "fail",
    `WebSocket — statut « ${status} » après ${ms} ms (abonnement non confirmé).`,
    ms,
  );
}

/* ------------------------------------------------------------------ */
/* The runner                                                          */
/* ------------------------------------------------------------------ */

/** Deterministic total-check count (mock-mode short-circuit aware). */
export function expectedCheckCount(): number {
  // 1 config + 1 network + 3 auth + 2 tenant + 2 rpc + 7 rls + 1 storage + 1 realtime
  return 18;
}

export async function runSupabaseDiagnostics(
  opts: DiagnosticsRunOptions,
): Promise<DiagnosticsReport> {
  const checks: DiagnosticCheck[] = [];
  const { client, domainSession, realtimeTimeoutMs = 5000 } = opts;

  // 1. Configuration — always evaluated (module state, no network).
  checks.push(probeConfiguration());
  const describe = describeSupabaseConnection();

  if (!client || !describe.useSupabase) {
    // Mock mode / unconfigured client: every networked probe is honestly
    // NOT TESTED — the handed-over contract's third state. One row per
    // category so the matrix stays readable.
    const reason = !client
      ? "client Supabase non configuré"
      : "mode simulé (mock) — aucune sonde réseau n'est exécutée";
    const skippedCategories: Array<{ category: string; label: string }> = [
      { category: CAT_NETWORK, label: "Joignabilité REST" },
      { category: CAT_AUTH, label: "Authentification (session / utilisateur)" },
      { category: CAT_TENANT, label: "Résolution du tenant" },
      { category: CAT_RPC, label: "RPC serveur" },
      { category: CAT_RLS, label: "RLS — lectures (7 tables)" },
      { category: CAT_STORAGE, label: "Stockage" },
      { category: CAT_REALTIME, label: "Temps réel" },
    ];
    for (const c of skippedCategories) {
      checks.push(
        check(`skipped.${c.category}`, c.category, c.label, "not_tested", reason, null),
      );
    }
    return summarize(checks);
  }

  // 2. Network.
  const network = await probeNetworkRest(client);
  checks.push(network.result);

  // 3. Authentication (getSession is local, getUser is networked).
  const auth = await probeAuth(client, domainSession);
  checks.push(...auth.checks);
  const hasSdkSession = auth.sdkSession.hasSdkSession;

  // 4. Tenant resolution.
  checks.push(...(await probeTenant(client, hasSdkSession)));

  // 5. RPC probes.
  checks.push(...(await probeRpcs(client, hasSdkSession)));

  // 6. RLS read matrix.
  checks.push(...(await probeRlsMatrix(client, hasSdkSession)));

  // 7. Storage.
  checks.push(await probeStorage(client));

  // 8. Realtime.
  checks.push(await probeRealtime(client, realtimeTimeoutMs));

  return summarize(checks);
}

function summarize(checks: DiagnosticCheck[]): DiagnosticsReport {
  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const notTested = checks.filter((c) => c.status === "not_tested").length;
  return { ranAt: Date.now(), checks, summary: { pass, fail, notTested } };
}

/** Plain-text rendering for clipboard export (safe — same rules as detail). */
export function formatDiagnosticsReportText(report: DiagnosticsReport): string {
  const header = `Diagnostic Supabase — ${new Date(report.ranAt).toLocaleString("fr-FR")}`;
  const summary = `Résumé : ${report.summary.pass} PASS / ${report.summary.fail} FAIL / ${report.summary.notTested} NON TESTÉ`;
  const body = report.checks
    .map((c) => `[${c.status.toUpperCase()}] ${c.category} — ${c.label} : ${c.detail}`)
    .join("\n");
  return `${header}\n${summary}\n${body}`;
}
