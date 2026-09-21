/**
 * t-400-realtime-probe.mjs — LIVE two-session realtime verification for the
 * Personnel surfaces (T-400 / migration 0106, REALTIME-105 class).
 *
 * Proves with real websocket events, through the SAME subscription shape
 * the desktop repositories use (postgres_changes, supabase-js):
 *
 *   1. chat_messages    — worker sends a DM; the MANAGER session (subscribed,
 *      separate authenticated client) receives the event without any reload.
 *   2. leave_requests   — worker submits a request; the manager session
 *      receives the event (the new SupabaseLeaveRequestRepository
 *      "desktop-leave-requests-realtime" wiring).
 *   3. CONTROL (expected DEAD): tasks is deliberately NOT a publication
 *      member — the manager session must receive ZERO task events while the
 *      REST read still shows the updated row. This proves the probe can
 *      distinguish live from dead subscriptions (it is not vacuously green).
 *
 * Setup reuses the app's own paths: probe personnel via REST (admin),
 * accounts via the create-user-account EF, direct channel via the 0105-widened
 * create_direct_channel RPC. Cleanup is zero-residue (archive-only for the
 * salary-less probe personnel here, hard delete; audit rows stay).
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY (owner-supplied, never committed).
 * Run: cd elimtiyaz-desktop && node scripts/t-400-realtime-probe.mjs
 */
import { createClient } from "@supabase/supabase-js";

const BASE = "https://vebfehrpzajhstyhinnw.supabase.co";
const ANON = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT = "00000000-0000-0000-0000-000000000001";
const STAMP = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

if (!SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY env is required");
  process.exit(2);
}

const results = [];
const check = (label, ok, detail = "") => {
  results.push([label, ok]);
  console.log(`  ${ok ? "GREEN" : "RED"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

async function api(path, { method = "GET", token, body, key } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      // key = the apikey header (ANON by default, SERVICE for the
      // zero-residue cleanup); token = the Authorization bearer (a user
      // JWT or the service key — BOTH headers must be the service key
      // for RLS-bypassing calls, apikey=ANON + Bearer=SERVICE is a 401).
      apikey: key ?? ANON,
      Authorization: `Bearer ${token ?? key ?? ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}

const signIn = async (email, password) => {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((x) => x.json());
  return r;
};

const probe = {};
try {
  console.log(`== T-400 realtime probe (${STAMP}) ==`);

  // ---- setup: admin + probe personnel + accounts (W, M) ------------------
  const admin = await signIn("admin@elimtiyaz.dz", "elimtiyaz@admin2026"); // OPS-310 owner-pinned
  check("S1 admin sign-in", !!admin.access_token);
  const A = admin.access_token;

  const roles = await api("/rest/v1/roles?select=id,code", { token: A });
  const roleId = Object.fromEntries(roles.data.map((r) => [r.code, r.id]));

  for (const [key, roleCode, category] of [["W", "worker", "support"], ["M", "manager", "administration"]]) {
    const p = await api("/rest/v1/personnel", {
      method: "POST", token: A,
      body: {
        tenant_id: TENANT, personnel_code: `PER-RT400-${key}-${STAMP}`,
        first_name: `RT400${key}`, last_name: key === "W" ? "Worker" : "Manager",
        staff_category: category, role_id: roleId[roleCode], position: `T-400 rt ${roleCode}`,
        is_active: true,
      },
    });
    probe[key] = { personnel: p.data[0] };
    const acct = await api("/functions/v1/create-user-account", {
      method: "POST", token: A,
      body: {
        email: `t400.rt.${key.toLowerCase()}.${STAMP}@elimtiyaz-test.dz`,
        full_name: `T-400 RT ${key}`, role: roleCode,
        password: `Rt400-${STAMP}-${key}!x`, personnel_id: p.data[0].id,
      },
    });
    probe[key].authId = acct.data?.data?.auth_user_id;
    probe[key].email = acct.data?.data?.email;
    const s = await signIn(probe[key].email, `Rt400-${STAMP}-${key}!x`);
    probe[key].session = s;
    const binding = await api(
      `/rest/v1/personnel?select=id,user_id&personnel_code=eq.PER-RT400-${key}-${STAMP}`, { token: A });
    probe[key].profileId = binding.data[0].user_id;
  }
  check("S2 probe accounts + bindings", probe.W.profileId && probe.M.profileId);

  // ---- manager session: the SUBSCRIBER (separate authenticated client) ---
  const mClient = createClient(BASE, ANON, {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: false },
  });
  await mClient.auth.setSession({
    access_token: probe.M.session.access_token,
    refresh_token: probe.M.session.refresh_token,
  });

  const events = { chat_messages: [], leave_requests: [], tasks: [] };
  // subscribe(callback) is the canonical status hook — the callback is
  // registered BEFORE the join, so the SUBSCRIBED transition is never missed.
  const mkChannel = (table) => {
    const ch = mClient.channel(`t400-probe-${table}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => events[table].push(payload));
    return ch;
  };
  const subscribeWithStatus = (ch) =>
    new Promise((res) => {
      const t = setTimeout(() => res("timeout"), 15000);
      ch.subscribe((s) => { if (s === "SUBSCRIBED") { clearTimeout(t); res(s); } });
    });
  const chChat = mkChannel("chat_messages");
  const chLeave = mkChannel("leave_requests");
  const chTasks = mkChannel("tasks"); // expected DEAD (not a publication member)

  const subscribed = await Promise.all(
    [chChat, chLeave, chTasks].map(subscribeWithStatus));
  check("S3 all three subscriptions reached SUBSCRIBED", subscribed.every((s) => s === "SUBSCRIBED"),
    subscribed.join(","));
  await new Promise((r) => setTimeout(r, 1500)); // settle

  // ---- worker session: the WRITER -----------------------------------------
  const wToken = probe.W.session.access_token;
  const wProf = probe.W.profileId;
  const mProf = probe.M.profileId;
  const wPid = probe.W.personnel.id;

  const dm = await api("/rest/v1/rpc/create_direct_channel", {
    method: "POST", token: wToken, body: { p_other_profile_id: mProf, p_name: "T-400 RT W↔M" },
  });
  check("W1 worker opens DM (0105 gate)", dm.status === 200 && dm.data?.id, `http=${dm.status}`);

  const msg = await api("/rest/v1/chat_messages", {
    method: "POST", token: wToken,
    body: {
      tenant_id: TENANT, channel_id: dm.data?.id, author_id: wProf,
      body: `T-400 realtime probe ${STAMP}`,
      read_by: [{ user_id: wProf, read_at: new Date().toISOString() }], attachments: [],
    },
  });
  check("W2 worker sends message", msg.status === 201, `http=${msg.status}`);

  const req = await api("/rest/v1/leave_requests", {
    method: "POST", token: wToken,
    body: {
      tenant_id: TENANT, personnel_id: wPid, leave_type: "annual",
      start_date: "2026-11-02", end_date: "2026-11-03",
      reason: "T-400 realtime probe", amount_requested: null, status: "pending",
    },
  });
  check("W3 worker submits leave request", req.status === 201, `http=${req.status}`);

  // dead-control write: manager creates a task; worker progresses it
  const task = await api("/rest/v1/tasks", {
    method: "POST", token: probe.M.session.access_token,
    body: {
      tenant_id: TENANT, title: `T-400 RT control ${STAMP}`, description: "realtime dead control",
      status: "assigned", priority: "low", assignee_ids: [wProf], progress: 0, created_by: mProf,
    },
  });
  const taskUpd = await api(`/rest/v1/tasks?id=eq.${task.data?.[0]?.id}`, {
    method: "PATCH", token: wToken,
    body: { status: "in_progress", progress: 10, updated_at: new Date().toISOString() },
  });
  check("W4 dead-control write (task progressed by worker)", taskUpd.status === 200, `http=${taskUpd.status}`);

  // ---- collect -------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 8000));

  check("R1 chat_messages event received by MANAGER session (no reload)",
    events.chat_messages.length >= 1, `events=${events.chat_messages.length}`);
  check("R2 leave_requests event received by MANAGER session (no reload)",
    events.leave_requests.length >= 1, `events=${events.leave_requests.length}`);
  check("R3 dead control: NO tasks event (not a publication member)",
    events.tasks.length === 0, `events=${events.tasks.length}`);

  // REST still sees everything (the read path is independent of realtime)
  const mRead = await api(`/rest/v1/chat_messages?channel_id=eq.${dm.data?.id}&select=body`, {
    token: probe.M.session.access_token,
  });
  check("R4 manager REST read still sees the message", mRead.status === 200 && mRead.data?.length === 1,
    `n=${mRead.data?.length}`);

  // ---- cleanup --------------------------------------------------------------
  // No DELETE policies exist on these tables (RLS default-deny for every
  // authenticated role — §15.30b) → service-role deletes + COUNT assertions.
  const svcApi = (path, { method = "GET", body } = {}) =>
    api(path, { method, token: SERVICE, key: SERVICE, body });
  for (const [path, filter, expect] of [
    ["chat_messages", `channel_id=eq.${dm.data?.id}`, 1],
    ["chat_channels", `id=eq.${dm.data?.id}`, 1],
    ["leave_requests", `id=eq.${req.data?.[0]?.id}`, 1],
    ["tasks", `id=eq.${task.data?.[0]?.id}`, 1],
  ]) {
    const d = await svcApi(`/rest/v1/${path}?${filter}`, { method: "DELETE" });
    const n = Array.isArray(d.data) ? d.data.length : -1;
    check(`X cleanup ${path} (deleted ${n}/${expect})`,
      (d.status === 200 || d.status === 204) && n === expect, `http=${d.status} rows=${n}`);
  }
  // probe personnel (no salary history → hard-deletable)
  for (const key of ["W", "M"]) {
    const d = await svcApi(`/rest/v1/personnel?id=eq.${probe[key].personnel.id}`, { method: "DELETE" });
    const n = Array.isArray(d.data) ? d.data.length : -1;
    check(`X cleanup personnel ${key}`, (d.status === 200 || d.status === 204) && n === 1,
      `http=${d.status} rows=${n}`);
  }
  for (const key of ["W", "M"]) {
    const d = await fetch(`${BASE}/auth/v1/admin/users/${probe[key].authId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    check(`X cleanup auth user ${key}`, d.status === 200 || d.status === 204, `http=${d.status}`);
  }
  const profs = await svcApi(`/rest/v1/user_profiles?select=id&email=like.t400.rt.*${STAMP}*`);
  let profDeleted = 0;
  for (const p of (Array.isArray(profs.data) ? profs.data : [])) {
    const d = await svcApi(`/rest/v1/user_profiles?id=eq.${p.id}`, { method: "DELETE" });
    profDeleted += Array.isArray(d.data) && d.data.length === 1 ? 1 : 0;
  }
  check("X cleanup probe profiles", profDeleted === 2,
    `found=${Array.isArray(profs.data) ? profs.data.length : "?"} deleted=${profDeleted}`);
  try { mClient.removeAllChannels(); } catch { /* noop */ }
} catch (e) {
  check("probe crashed", false, String(e));
}

const red = results.filter(([, ok]) => !ok);
console.log(`\n== T-400 REALTIME SUMMARY: ${results.length - red.length}/${results.length} GREEN, ${red.length} RED ==`);
process.exit(red.length ? 1 : 0);
