// ============================================================================
// lib/rest.mjs — Minimal PostgREST client (zero dependencies, Node >= 18).
// ----------------------------------------------------------------------------
// Only what the suite needs: rpc(), select(), insert(), update(), delete(),
// count(). Errors are returned as typed objects (never thrown) so layers can
// treat failures as first-class comparison data (validation layer especially).
// ============================================================================

import { env } from "./env.mjs";

const H = () => ({
  apikey: env.serviceKey,
  Authorization: `Bearer ${env.serviceKey}`,
  "Content-Type": "application/json",
});

function url(path, params) {
  const qs = params ? `?${params}` : "";
  return `${env.supabaseUrl}/rest/v1/${path}${qs}`;
}

export class RestError extends Error {
  constructor(status, body, context) {
    const detail = typeof body === "object" && body !== null
      ? JSON.stringify(body)
      : String(body ?? "");
    super(`HTTP ${status} ${context || ""}: ${detail.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.context = context;
  }
}

/** Call a PostgREST RPC. Returns { ok, data, error }. */
export async function rpc(fn, payload = {}, { timeoutMs = 30000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url(`rpc/${fn}`), {
      method: "POST",
      headers: H(),
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      return { ok: false, data: null, error: new RestError(res.status, data ?? text, `rpc ${fn}`) };
    }
    return { ok: true, data, error: null };
  } catch (e) {
    return { ok: false, data: null, error: e };
  } finally {
    clearTimeout(t);
  }
}

function restDetail(e) {
  if (e instanceof RestError) {
    const b = e.body;
    const msg = typeof b === "object" && b !== null ? JSON.stringify(b) : String(b);
    return `HTTP ${e.status}: ${msg}`;
  }
  return String(e?.message || e);
}

/** SELECT rows. `params` is the raw PostgREST query string. */
export async function select(table, params = "", { timeoutMs = 30000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url(table, params), { headers: H(), signal: ac.signal });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      return { ok: false, data: null, error: new RestError(res.status, data ?? text, `select ${table}`) };
    }
    return { ok: true, data, error: null };
  } catch (e) {
    return { ok: false, data: null, error: e };
  } finally {
    clearTimeout(t);
  }
}

/** COUNT rows matching params. */
export async function count(table, params = "") {
  const r = await select(table, `${params}${params ? "&" : ""}select=id&limit=1`, );
  // Use Prefer count via headers instead:
  const res = await fetch(url(table, `${params}${params ? "&" : ""}select=id`), {
    headers: { ...H(), Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range"); // "0-0/123"
  if (range) {
    const total = range.split("/")[1];
    return total === "*" ? null : parseInt(total, 10);
  }
  return null;
}

export async function insert(table, rows) {
  const res = await fetch(url(table), {
    method: "POST",
    headers: { ...H(), Prefer: "return=representation" },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) return { ok: false, data: null, error: new RestError(res.status, data ?? text, `insert ${table}`) };
  return { ok: true, data, error: null };
}

export async function update(table, params, patch) {
  const res = await fetch(url(table, params), {
    method: "PATCH",
    headers: { ...H(), Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) return { ok: false, data: null, error: new RestError(res.status, data ?? text, `update ${table}`) };
  return { ok: true, data, error: null };
}

export async function del(table, params) {
  const res = await fetch(url(table, params), { method: "DELETE", headers: H() });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, data: null, error: new RestError(res.status, text, `delete ${table}`) };
  }
  return { ok: true, data: null, error: null };
}

/** Probe which RPC functions exist (via OpenAPI path enumeration). */
let _pathsCache = null;
export async function probeRpcPaths() {
  if (_pathsCache) return _pathsCache;
  const res = await fetch(url(""), { headers: H() });
  const spec = await res.json();
  _pathsCache = new Set(Object.keys(spec.paths || {}));
  return _pathsCache;
}

export async function rpcExists(fn) {
  const paths = await probeRpcPaths();
  return paths.has(`/rpc/${fn}`);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
