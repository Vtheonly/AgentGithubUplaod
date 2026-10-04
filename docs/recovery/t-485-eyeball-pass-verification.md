# T-485 — The 141st Session's Eyeball Pass (VLM-assisted) + REALTIME-105

**Date:** 2026-10-04 · **Branch:** `feat/t485-eyeball-pass-toaster-loop` · **Task registry:** docs/recovery/task-registry.md (T-485)

## 1. Mandate

The 139th session's audit left ONE remaining item: the owner's manual eyeball of the three re-delivered surfaces — the redesigned Relevé tab (T-481), the warehouse dashboard's real receipts/dispatches (T-479), and the chat deep link (T-480). The owner's 141st-session mandate delegated that eyeball to the agent, to be performed **with the VLM** against the LIVE system (the real Supabase project, the real app, the owner-pinned admin credential — OPS-310: never rotate, never delete).

The pass ran the real app (`vite dev` on the live backend), drove it through the real browser (agent-browser), captured screenshots at every audited surface, and analysed each screenshot with the vision model against the audit's specific verification questions (not generic descriptions). Every finding below is live evidence; every fix was re-verified live after its change.

## 2. The probe methodology (zero-residue discipline, the t-400 convention)

The three audited surfaces need THREE role views: the admin (Relevé tab, employee drawer), a plain worker (the chat deep link lives on the WorkerDashboard), and a warehouse worker (the receipts/dispatches dashboard). The live project has exactly ONE owner-pinned account — so the pass provisioned THREE run-unique probe accounts through **the app's own sanctioned flows** (never raw SQL mutations of credentials):

- `eyeball.worker.{stamp}@elimtiyaz-test.dz` (worker) — personnel via REST (admin JWT), account via the `create-user-account` Edge Function (the exact Settings→Comptes path, T-371 binding included), supervisor set to a bound probe;
- `eyeball.wh.{stamp}@elimtiyaz-test.dz` (warehouse_worker) — same path;
- `eyeball.sup.{stamp}@elimtiyaz-test.dz` (teacher, the bound supervisor) — same path; needed because **live personnel has ZERO user_id bindings** (the T-482 discovery — only a bound recipient can receive a DM).

Cleanup: all three accounts hard-deleted through the app's own `delete-user-account` Edge Function (super-admin-gated, owner-pinned-admin-protected by design) with row-count assertions — see §7.

**Probe-creation discovery (recorded):** `personnel.staff_category` admits only `administration|support|teaching` live — the scripts' first attempt used `logistics` and was check-rejected. The t-400-era script family's `support` value is the correct warehouse category.

## 3. The eyeball results (VLM verdicts)

| Surface | Screenshot | VLM verdict | Notes |
|---|---|---|---|
| Relevé d'Activité tab (T-481, §09.05) | `03b-releve-full.png` + `vlm-01-releve.md` | **PASS on every functional check** — the staff picker, date, activity-kind select (all 8 §09.05 kinds incl. "Surveillance" post-0140), start/end times, the append-only/§09.05 explanatory text, the 30-day section with its honest empty state. The VLM's overall "FAIL" string is **solely** the live data itself: the picker lists the 8 `FAKE …` probe personnel (the t-400/t-412-era rows) — a DATA-hygiene item, not a UI defect (§5.3). | Admin session, live |
| Employee drawer "Horaires & Shifts" (T-484) | `04-drawer-horaires-shifts.png` + `vlm-02-shifts.md` | **PASS** — weekly volume pair (0/40 h), the honest "Aucun shift planifié." empty state, clean layout. | Admin session, live |
| Worker dashboard post-fix | `07-worker-dashboard-fixed.png` + `vlm-03-worker.md` | **PASS** — KPI cards render, punch card, supervisor card with the deep-link button, **no toast flood, no frozen main area** (the pre-fix state is `06-worker-state.png`: 9+ duplicate toasts + empty main). | Worker session, live |
| Chat deep link (CHAT-301) | `08-chat-deeplink.png` + `vlm-04-chat-deeplink.md` | **PASS** — the "Envoyer un message" click lands on the Messagerie Interne tab with the supervisor's DM created through the canonical `create_direct_channel` RPC ("EyeSUP Probe · Message direct") and the honest "Aucun message. Lancez la conversation !" empty state. | Worker session, live, bound recipient |
| Warehouse dashboard (T-479) | `10-warehouse-empty-states-fixed.png` + `vlm-05-warehouse.md` (+ the pre-fix `09b-warehouse-dashboard-full.png`) | **PASS** — the four real zero counters, the honest empty-state messages in ALL THREE cards, no mock rows. | Warehouse session, live |

## 4. THE PASS'S OWN FINDING — REALTIME-105 (Critical, fixed + live-verified)

Driving the worker session surfaced a live production bug the entire test battery could not see (it needs two sessions + realtime + a context identity churn):

**The AuditActivityToaster amplification loop.** `audit-activity-toaster.tsx`'s effect depended on `[repos.audit, toast]`. The toast context value re-identifies on EVERY toasts-state change (its useMemo keys on the array), and every resubscription to the audit repository's `SubjectBehavior` **replays the stored last event**. One realtime audit event → one toast → new context identity → teardown + resubscribe → replay → another toast → React's "Maximum update depth exceeded" — an unbounded toast stack and a session whose main content never renders. Live evidence: `06-worker-state.png` (9+ duplicate "Activité — admin@elimtiyaz.dz — user_account.create" toasts, empty main, the React warning with the component stack at `AuditActivityToaster` repeated 8+ times). In production this fires whenever any second operator writes while another session is open — the exact audience T-299 built the toaster for.

**The fix** (the file's own sessionRef pattern, applied to the toast): the churny context value is held in a ref and read inside the subscription; the effect pins to `[repos.audit]` (the stable module singleton). The subscription arms once per mount and can never resubscribe on toast churn. Live re-verification: 0 render-depth errors, 0 duplicate toasts, the worker dashboard renders fully (`07-worker-dashboard-fixed.png`).

**Registered residual (NOT fixed, by scope discipline):** the SubjectBehavior still replays its stored last event to a FRESH mount (e.g. a sign-out/sign-in switch without reload surfaces one stale toast). The clean fix needs an event-seq/dedupe contract in the stream or a remount-surviving last-seen key — a contract change beyond the minimal loop kill; recorded in the problem entry as the follow-up note.

## 5. The two sibling findings (both fixed + live-verified)

### 5.1 WORKFORCE-511 — the warehouse cards' silent empty boxes

The pre-fix `09b-warehouse-dashboard-full.png`: the "Réceptions attendues" / "Expéditions à préparer" cards rendered `<ul>` with zero `<li>` — silent blank boxes (indistinguishable from loading), while the sibling stock-activity card directly below models the honest-empty pattern. Fixed with the two muted empty-state paragraphs ("Aucune réception en attente." / "Aucune expédition à préparer."); live re-verified in `10-warehouse-empty-states-fixed.png`.

### 5.2 CHAT-302 — the deep link's silent no-op for unbound recipients

The live zero-binding state (T-482's discovery) makes the deep link's `recipient.userId` guard reachable: the worker clicks "Envoyer un message", the tab switches, the channel list stays empty, and NOTHING explains why (the WORKFORCE-510 swallowed-failure class). Fixed with the honest warning toast ("Messagerie indisponible — Ce collaborateur n'a pas de compte de messagerie rattaché."); live re-verified in `11-chat302-unbound-toast.png`. The data guard itself survives (an unbound record is never DM-able — the member set is profile-keyed).

### 5.3 DATA-hygiene note (owner-gated, NOT a code fix)

The live `personnel` table carries the t-400/t-412-era probe rows: 8 active "FAKE {name}" staff (email `fake.t5@elimtiyaz-test.dz`, "FAKE Enseignant Sciences (test)") + 5 archived T400 workers + 1 archived T-412 payroll probe. The Relevé tab's staff picker and the directory list them because they ARE the live rows. The VLM's Relevé "FAIL" verdict is entirely this data. Recommended owner action: archive/deactivate the FAKE rows (a one-line admin PATCH each) once the owner confirms no test dependence remains — the desktop surfaces will then show only real staff. No code change is warranted.

## 6. The verification stack (the no-evidence-no-green rule)

- **The new suite `t-485-audit-toaster-loop.test.tsx` — 6/6**: the BEHAVIOURAL loop kill (the real ToastProvider + the real replaying SubjectBehavior: one event → one toast, the subscribe count stays EXACTLY 1 across two events — the count is the loop's pulse), the unchanged stream replay contract (late subscribers still receive the store's value), the REALTIME-105 source guard (deps `[repos.audit]`, the toastRef, the self-suppression comparison), and the WORKFORCE-511/CHAT-302 source guards.
- **The FULL battery: 4,767 / 0 failed / 5 skipped (279 files) — BASELINE-MATCHED** after the registered baseline move (net +6; the T-484 baseline 4,761/0/5 superseded, `scripts/test-baseline.json` cites T-485). The unified runner's verdict GREEN across every gating layer (equivalence 810/0/10 + 774/0/10/36 + tier-4 784/820 0 rows + sanity 820/820 canonical 319/319). tsc 0; eslint 0 errors on the changed files (the chat-panel `session` deps warning is pre-existing — the dependency array was not touched).
- **Live re-verification per fix** (the browser round-trips above): loop dead (0 depth errors, 0 spam), warehouse empty states visible, unbound-recipient toast shown, deep link DM created against a bound recipient.

## 7. The probe cleanup (zero residue, count-asserted)

All three probe accounts + their personnel rows were removed through the app's own `delete-user-account` Edge Function (the super-admin-gated path; the owner-pinned admin is protected from deletion BY DESIGN inside the EF — the OPS-310 rule is enforced in code, not just in the docs), followed by the t-369 archive convention for the personnel rows themselves (`is_active=false` + `deleted_at` stamped — the EF clears the binding; the archived probe rows stay as the honest record). The runner: `scripts/eyeball-probe-cleanup.py` (asserts per-target: the EF 200, the profile row gone, the personnel binding cleared; then a final live census asserts ZERO `eyeball.*@elimtiyaz-test.dz` rows remain) — **12/12 GREEN**. The FAKE/T400 rows were NOT touched (§5.3 — owner-gated).

## 8. Left open (the honest list)

1. The SubjectBehavior replay-on-remount stale-toast nit (REALTIME-105's registered follow-up note) — needs a stream-contract change (event-seq or remount-surviving dedupe key), deliberately not bundled with the loop kill.
2. The FAKE-prefixed live personnel rows (§5.3) — owner-gated data hygiene.
3. The chat panel's `session` exhaustive-deps warning — pre-existing, cosmetic, untouched (minimal diff).
