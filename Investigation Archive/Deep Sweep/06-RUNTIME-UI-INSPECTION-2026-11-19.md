# Deep Sweep 06 — RUNTIME UI INSPECTION (mock-mode dev server) — 2026-11-19

**Session:** S10 (routine 6-hourly sweep; trace `cron-agent-loop-202611191558`) · **HEAD at start:** `a7ff69f7` (main) · **Regime:** read-only for application code — this session ran the app, it did not modify it.

**What this is:** the ONE depth lane the S7/S8/S9 handoffs flagged as never-run ("runtime UI inspection via the mock-mode dev server — run it only if an execution environment allows it"). The environment allowed it. This document records the first RUNTIME evidence in the archive: the app was installed (`npm ci --ignore-scripts`), launched (`vite` dev server, Node v24.22.3), and driven surface-by-surface in a real Chromium (agent-browser, 1440×900) — with console capture, network capture, and screenshot evidence.

**Headline result:** the runtime lane immediately surfaced a **critical, test-invisible production defect that nine sessions of static analysis could not see** — an unbounded error-refetch loop in the Settings → Configuration tab (BUG-042: 7,148 live Supabase requests from two tab visits; 154 duplicated error banners; toast flood). Plus the mode-selection seam reality check (C-20), two minor defects, and the first runtime conformance evidence for the UI estate.

Evidence files (all in `Deep Sweep/censuses/`):
- `runtime-s10-network-summary.txt` — per-endpoint request census (the 7,148; the pre-login query set)
- `runtime-s10-console-summary.txt` — curated console transcript (boot, loop, copilot)
- `runtime-s10-dashboard.png` / `runtime-s10-parent-sheet.png` / `runtime-s10-student-drawer-payments.png` … `runtime-s10-config-loop-bug042.png` — visual evidence (incl. the toast-flood smoking gun)

---

## §1 Environment & method (re-runnable)

| Step | Command / value | Result |
|---|---|---|
| Install | `cd elimtiyaz-desktop && npm ci --ignore-scripts --no-audit --no-fund` | 931 packages, ~12 s; `--ignore-scripts` skips the Electron postinstall download (not needed for the renderer); lockfile untouched; `git status` stayed clean (node_modules is gitignored) |
| Serve | `npx vite --port 5173 --strictPort --host 127.0.0.1` | VITE v6.4.3 ready in 154 ms; HTTP 200 on `/` |
| Browser | `agent-browser` (Chromium, headless), viewport 1440×900 | login screen rendered |
| Mock toggle | `localStorage.setItem("el-imtiyaz.local-config", '{"supabase_use_supabase":false}')` + reload | **required** — see §2; repositories switch to `mockRepositories` (repository-provider.tsx:172) |
| Sign-in | `admin@elimtiyaz.dz` + any non-empty password (seed-data.ts:1670; MockAuthRepository.signIn matches email only — auth-repository.ts:30-38) | SuperAdmin session, dashboard reachable |
| Capture | `agent-browser console` / `errors` / `network requests` + screenshots per surface | evidence files above |

**Method lessons banked for future runtime lanes (S10 addendum to the S9 lexer lessons):**

1. **`offsetParent` is `null` for every `position:fixed` element** — a "is it visible" check based on `offsetParent !== null` reports false for open fixed overlays (cost this session one false negative on the search palette and two wasted probe rounds). Use `getBoundingClientRect()` + `getComputedStyle().pointerEvents` + `elementFromPoint` instead.
2. **Untrusted synthetic events do not activate Radix triggers.** `element.click()` / `dispatchEvent(new MouseEvent('click'))` on a `TabsPrimitive.Trigger` reports "clicked" but leaves `aria-selected=false`; only a trusted pointerdown→pointerup sequence (Playwright mouse or a real click at coordinates) activates it. A future probe that reports "tab won't activate" from synthetic clicks is measuring its own tooling, not the app.
3. **A full-width `z-50` fixed wrapper (search palette) silently intercepts page clicks while mounted** — check for mounted overlay wrappers before attributing click failures to the underlying component.

---

## §2 The mode-selection seam, runtime-verified (→ C-20)

The S7/S9 planning premise — "the mock-mode dev server" — assumed bare `npm run dev` yields mock mode. **Runtime proves otherwise.** The decision chain (`supabase-client.ts`), read at runtime behavior level:

```
useSupabase = isProductionDesktopBuild ? true
  : (localConfig.useSupabase ??                                  // localStorage toggle
     (envUseSupabase !== undefined ? envUseSupabase !== "false"   // VITE_USE_SUPABASE
      : !isVitestRun))                                            // DEFAULT: TRUE in dev
                                                                  // (supabase-client.ts:171-177)
supabaseUrl = localConfig.url ?? envSupabaseUrl ?? (isVitestRun ? undefined : CANONICAL_PRODUCTION_SUPABASE_URL)   // :119-120
supabaseAnonKey = localConfig.anonKey ?? envPublicKey                                                              // :121-122
envPublicKey = publishable ?? anon ?? (isVitestRun ? undefined : CANONICAL_PRODUCTION_PUBLIC_KEY)                  // :120
```

Runtime-verified consequences (all captured in the network evidence file):

1. **A clean dev environment targets LIVE production by default.** With no env and no localStorage config, the renderer fired the full query sweep against `vebfehrpzajhstyhinnw.supabase.co` (hard-coded fallback, `supabase-client.ts:33-38`) — every GET 402'd. This is the documented design intent (the source comment at :155-176 says "Live Supabase is the default whenever the application has a Supabase configuration") — but the archive's own planning docs mis-assumed it, hence **correction C-20** (FINDINGS_INDEX S10 addendum): the mock lane requires the explicit `el-imtiyaz.local-config` toggle (or `VITE_USE_SUPABASE=false` at build time).
2. **The login screen queries data before any session exists.** ~12 REST requests (academic_years/levels, classes, students, subjects, class_subjects, subject_configurations, rooms, personnel, timetable_versions) fired at `/login` — a boot-time warm-up sweep against the canonical project. Under a quota-restricted backend these all fail silently pre-auth. Static analysis never inventoried *when* the first query fires; the runtime lane did.
3. **With the toggle set, the renderer is fully wire-free** — zero Supabase requests on navigation across every surface walked (§4). The ONE residual live-wire caller in mock mode is the Configuration tab itself (its service gate is `isSupabaseConfigured()`, an independent gate from `useSupabase`) — which is exactly the ammunition of BUG-042.
4. The Settings → Configuration UI reflects runtime truth correctly: BACKEND badge showed "Mock", CONNEXION "Non testé", and the toggle's own description reads "Désactivé = mode mock (données en mémoire, réinitialisées au rechargement)" (visible in `runtime-s10-config-loop-bug042.png`).

---

## §3 BUG-042 (CRITICAL, runtime-proven): the Configuration-tab unbounded error-refetch loop

**Reproduce (deterministic):** any environment where `isSupabaseConfigured()` is true AND `systemConfigService.listAll()` fails (e.g. today's `exceed_egress_quota` 402 on every request) → open Paramètres → Configuration. Verified twice in the same session, plus once in a fresh reload state.

**Observed numbers:**
- **7,148** GET `rest/v1/system_settings?select=*&order=category.asc,sort_order.asc` requests, **all 402**, across two Configuration visits (≈6,177 + ≈971 before navigation away) — `runtime-s10-network-summary.txt`.
- **154** duplicated `Erreur chargement paramètres: …` banner paragraphs in the DOM at the first visit; **10+ stacked red error toasts** visible in the screenshot (`runtime-s10-config-loop-bug042.png`).
- React console: `Maximum update depth exceeded` fired continuously during the visit.

**The full causal chain (file:line precision):**

```
toast-provider.tsx:57-70
  const value = useMemo<ToastContextValue>(() => ({
    ..., showError: (t, d) => show("danger", t, d), ...
  }), [toasts, show, dismiss]);            // ← `toasts` in the dep array: EVERY toast
                                           //   add/remove rebuilds the context value and
                                           //   the showError identity with it
        ↓
configuration-tab.tsx:85-105
  const loadSettings = useCallback(async () => {
      if (!isSupabaseConfigured()) return;
      const result = await systemConfigService.listAll();
      if (result.ok) setSettings(result.value);
      else showError(`Erreur chargement paramètres: ${result.error.userMessage}`);   // :78
      setIsLoading(false);
    }, [systemConfigService, showError]);  // ← new identity on every toast change
  useEffect(() => { loadSettings(); }, [loadSettings]);   // ← re-runs on every toast change
        ↓
supabase-client.ts:171-177, :33-38
  isSupabaseConfigured() = !!(supabaseUrl && supabaseAnonKey)   // TRUE even in mock mode
                               // (the canonical-key fallback lives in the URL/key chain,
                               //  which the local toggle does not empty)
        ↓
  listAll() → GET /rest/v1/system_settings → 402 exceed_egress_quota
        ↓
  showError(...) → toast appended → `toasts` array changes → context value rebuilt
  → showError identity changes → loadSettings identity changes → effect re-runs →
  listAll() again → 402 → showError … (UNBOUNDED)
```

**Why React's guard does not stop it:** "Maximum update depth exceeded" caps *synchronous* update depth (50 nested updates in one flush). Here every cycle crosses an `await` boundary (`listAll()` → HTTP → `showError`), resetting the counter each time. The loop is a **true infinite network cycle** that terminates only on component unmount — measured: requests kept firing for seconds after navigating away until the pending chains drained.

**Severity reasoning (why CRITICAL and not cosmetic):**
1. **The trigger condition is the app's CURRENT production state.** The backend is quota-restricted (OPS-011, 8-run-stable — every request 402s). Any end user who opens Paramètres → Configuration on the deployed desktop build (where `isProductionDesktopBuild` forces the same canonical URL/key) detonates the same loop: thousands of doomed requests, a toast flood, and a settings screen that never loads — **the app itself deepens the very quota problem it is dying of.**
2. **Test-invisible (S5 census blind spot):** the vitest settings tests stub `useToast` with `vi.fn()` (e.g. t-505-backup-tab-file-ui.test.tsx:48,84 — stable identities), and the hermeticity contract (T-472) disables the canonical-key fallback under Vitest — so neither the identity churn nor the live-wire precondition can ever co-occur in the suite. The full 5,270-test green wall (Session 5) does not cover this class.
3. **The same loop shape threatens every consumer of the toast context whose callbacks feed a `useCallback`+`useEffect` fetch cycle.** The Configuration tab is the confirmed detonation; the pattern audit is part of the fix draft (§3.2).

### §3.1 Related gate divergence (architectural note, no new ID)

`useSupabase` (repository layer: mock vs live) and `isSupabaseConfigured()` (Configuration tab: "do we have a URL+key") are **two independent gates** that can disagree. In mock mode (`useSupabase=false`) the Configuration tab still queries the wire through the canonical fallback. For the Configuration tab this is semi-intentional (it is the screen that *edits* the connection), but the canonical-key fallback means "mock mode" never fully isolates the renderer from the production wire. The local-first migration (DataBackendPort seam, LOCAL-FIRST-BLUEPRINT §"DataBackendPort") already plans a single backend gate; this runtime evidence strengthens the case that **one** gate must govern all wire access. Recorded as an addendum note in the S10 FINDINGS_INDEX entry — not a separate ID (the consolidation home is the planned seam).

### §3.2 Fix draft (plan only — staged as T-559 + T-560 in the S10 report)

- **T-559 (one-line root fix):** split the toast context value — keep `show/showSuccess/showError/…` (stable `useCallback`s) in a **separate memo with `[show, dismiss]` deps only**, expose `toasts` as a second context (or let the viewport subscribe) so toast *content* changes do not rebuild the callback identities. Every consumer's `showError` becomes referentially stable.
- **T-560 (loop breaker, defense in depth):** in `configuration-tab.tsx`, gate the effect on a load-generation ref (load-on-mount + manual refresh only), and/or dedupe identical consecutive error toasts (same title+description within N ms → re-rate instead of re-stack). Both are cosmetic-layer safe and preserve the refresh affordance.
- **Verification ladder:** (a) reproduce loop at HEAD in the dev server (done — evidence files); (b) after fix, re-run the same probe and require **0** repeated fetches + ≤1 error toast per visit; (c) vitest: replace the `vi.fn()` toast stub in one settings test with a REAL ToastProvider + failing service and assert a bounded call count (turns the S5 blind spot into a regression test — the exact "independent oracle" lesson of S8).

---

## §4 Per-surface runtime walkthrough ledger (mock mode)

All surfaces walked as SuperAdmin. **Page error channel: zero uncaught exceptions for the entire session.** All overlay categories from the STEP-2 charter were exercised where encountered.

| Surface (route) | Runtime result | Overlay categories exercised | Console notes |
|---|---|---|---|
| `/login` (login screen) | Renders; mock sign-in matches email-only (auth-repository.ts:30-38); **pre-auth query sweep fires** (§2.2) | — | SyncService warning ×3 |
| Dashboard `#/` (4 tabs) | All 4 tabs render with full mock data (KPIs 15 foyers / 110,5 k DZD / 4,3 M DZD / 83%; T1-T3 tranche cards; créances funnel 3/3/3/3; notifications center TOTAL 4 / NON LUES 3 / URGENTES 1) | KPI cards, tab bar, year picker, notification dropdown | clean |
| Dashboard → Rapports tab | **Master Workbook export WORKS at runtime** — toast "Export complet généré" fired (§5) | export buttons ×11 (5×XLSX/PDF pairs + workbook + audit link) | clean |
| CRM `#/crm` — Parents (8 rows) | Table renders; per-row Actions dropdown opens with 8 items (Aperçu rapide / Ouvrir le panneau latéral / Dossier famille / Finances & Tranches / Suivi des dettes / WhatsApp / Appeler / E-mail) | **DropdownMenu** (ParentActionsMenu, DUP-022 site) | clean |
| CRM — parent side panel | Sheet drawer opens right-half with 3 tabs (Coordonnées & Accès / Enfants 2 / Finances & Échéances), contact channel row (WhatsApp/Appeler/Messager interne/E-mail), portal-security section; **Esc closes cleanly (0 dialogs remain)** | **Sheet/drawer** (parent-detail-drawer) | clean |
| CRM — Élèves (12+ rows) | Table renders; student drawer opens with 5 tabs; Paiements & Tranches tab shows full financial stack (PART INDIVIDUELLE 372 000 / SOLDE FAMILLE 138 000 dont 295 000 en retard; payment history with coverage breakdown) | **Student drawer** (5-tab Sheet family) | clean |
| CRM — Réinscription tab | Year-transition UI renders (Année source 2025-2026 courante / Année cible / Générer / Rafraîchir) | tab activation (trusted-event verified) | clean |
| CRM — Messagerie Portail tab | Conversations UI renders (CONVERSATIONS PARENTS (1) — Famille Benali thread) | tab activation | clean |
| Academics `#/academics` (13 sub-tabs all mounted) | Niveaux & Classes (8) / Annuaire (15) / Enseignants (6) / Matières (12) / Cycles / Emploi du temps (honest empty state: "Aucun emploi du temps généré") / Années / Devoirs (4) / Examens / Justificatifs / **Clubs 4 / Psychologie 2 / Orthophonie 2 (mock-slot features live, D-6 question visible at runtime)** | PageTabs segmented control | clean |
| Nouvelle classe modal | UnifiedModal opens ("Créer une nouvelle classe"); footer = Annuler / Créer la classe (matches Deep Sweep/05 footer vocabulary); **Esc closes** | **UnifiedModal** (the census subject — runtime-conformant) | clean |
| Emploi du temps sub-tabs | Essais & publication / Configuration / Salles / Contraintes all render | nested tabs | clean |
| Financials `#/financials` (7 sub-tabs) | KPI strip (ENCAISSÉ 1,7 M / ENCOURS 3,2 M dont 286,5 k échues / DÉPENSES 2); Paiements 15 rows; Créances 7; **Reçus: receipt PDF button runs clean** (§5); Diagnostic & Requêtes renders | finance tabs, receipt table | clean |
| Personnel `#/personnel` | Renders: MASSE SALARIALE 851 k DZD / 14 actifs / TÂCHES 1 / ABSENCES 1; 8 sub-nav items; onboarding reset affordance | personnel tabs | clean |
| Workflow `#/workflow` | 3 workflows listed (Relance impayés — Déployé; Promotion fin d'année — Brouillon); Éditeur/Exécutions tabs | workflow cards | clean |
| Settings `#/settings` (15 tabs mounted) | Général + Thèmes (5 official themes + Créer un thème) render; **Configuration tab = BUG-042 detonation** (§3); Synchronisation renders honest state (§5); Sauvegardes renders full backup UI (§5); **deep-link `?tab=backup` works on fresh mount only → BUG-043** | 15-tab estate + 14 hidden tabpanels | **loop errors (Configuration only)** |
| Topbar — Assistant IA | Drawer opens (Copilot Éducatif / openai/gpt-oss-120b); input accepts text; **unconfigured state: no reply, error toast transient, user turn persisted (§6.3)** | **floating side drawer** | 1× update-depth error (once only) |
| Topbar — Synchronisation / Sauvegardes buttons | Navigate to `#/settings?tab=…` (deep-link semantics → BUG-043) | — | clean |
| Topbar — Alertes dropdown | Opens: 3 unread, urgent alert card with full body | **DropdownMenu (popover)** | clean |
| Topbar — Langue menu | FR / AR / EN options render | **DropdownMenu** | clean |
| Topbar — User menu | Mon profil / Paramètres / Se déconnecter | **DropdownMenu** | clean |
| Topbar — Search (Ctrl+K) | Command palette opens (`fixed top-[15vh] z-50`): full-app sections (Parents/Élèves/Paiements/Dépenses/Audit/Personnel) + "Demander à l'IA: « Karim »" entry; typing "Karim" produced results; **Esc unmounts wrapper** (verified) | **Command palette / modal overlay** | clean |
| Right-click (context menu) on CRM table row | **No custom context menu** — browser default only | confirms S7 static census (0 `onContextMenu` sites) at runtime | — |
| Tooltips | No dedicated tooltip trigger encountered on the CRM/settings walk (S7 static census — 10 usage files, 5 analytics cards — remains the authority; runtime spot-check inconclusive on the walked pages) | — | — |

**Runtime conformance verdict for the UI estate:** every overlay category opened, closed, and rendered correctly; zero uncaught page errors outside the Configuration loop; the UnifiedModal estate (S9's 114-usage census) behaved per contract at every sampled site (modal + drawer + sheet + dropdown + palette + toast all observed live). The design-token visual identity (dark theme, radii, spacing) renders coherently across all walked surfaces — `runtime-s10-dashboard.png`, `runtime-s10-parent-sheet.png`, `runtime-s10-student-drawer-payments.png`.

---

## §5 Runtime proofs for the pipeline/infrastructure lanes

1. **Master Workbook export (Excel pipeline)** — full success in mock mode: toast "Export complet généré" fired; the export path is the browser blob-anchor download (`export-engine.ts:162-165`), NOT Electron-only — so the S3/S8 inventory assumption "renderer export = Electron dialog" is refined: in the browser the export degrades to a plain download gracefully. (The one-time live-DB re-verification lane of Deep Sweep/04 §8 remains owner-gated — unchanged.)
2. **Receipt PDF regeneration (ADR-004 lane)** — clean run, no console noise, download event fired.
3. **Synchronisation status layer (sync pipeline)** — the panel reports RÉSEAU "Hors ligne" while `navigator.onLine === true`. Verified correct-by-design at `online-detector.ts:88-130`: the detector probes the backend health endpoint and distinguishes navigator-online from backend-reachable — under the 402 restriction "Hors ligne" is the truthful state. Queue counters all 0; mock data correctly labelled "exclues" from sync (matches the C-6 sync-queue contract).
4. **Backup tab (backup pipeline)** — full UI live: last backup 18/11/2026, AES-256-GCM cycle, 365-day retention, "Sauvegarder maintenant" / "Exporter l'archive…" / "Point de contrôle Excel (ZIP)…" / per-archive Inspect/Restore/Delete, passphrase state "Aucune phrase secrète configurée — les sauvegardes sont désactivées jusqu'à configuration" (fail-closed as designed). Scheduler console evidence: dev mode arms a 5-minute interval (backup.scheduler.armed nextRunInMs 300000) with the 02:00 production schedule preserved in the config field — dev-only behavior, noted in the console evidence file. The backup scheduler console sequence start→armed→stop→start→armed is the React dev StrictMode double-mount (two effects), benign.
5. **Live Supabase (OPS-011)** — re-probed GET-only this run (see `01-INFRASTRUCTURE-STATUS.md` S10 section): **8-run-stable**, all 402 `exceed_egress_quota`; management token still 401; GitHub 200 + push. The runtime lane gave the restriction a NEW measurable consequence (BUG-042's 7,148 requests) — the cap lift is now urgent not just for the census but because the deployed app is self-DDoS-ing under it.

---

## §6 Minor runtime findings

### §6.1 BUG-043 (LOW): settings `?tab=` deep link is consumed at mount only

Clicking the topbar **Sauvegardes** button while ALREADY inside Paramètres navigates to `#/settings?tab=backup` (hash verified) but the active tab **stays on the previous tab** (Synchronisation at the time of the probe). After a hard reload of the same URL the backup tab activates. Verified once in both directions; the tab state is read on mount and not synced to query changes. User impact: the topbar backup shortcut silently does nothing when the user is already in settings. Fix sketch (T-561 candidate, cosmetic): `useEffect` syncing the query param into the PageTabs value (or the router-side `key` remount).

### §6.2 (no ID — documented design) the canonical-key fallback drives BUG-042's precondition

The hard-coded `CANONICAL_PRODUCTION_PUBLIC_KEY` (supabase-client.ts:33-38) is deliberate production hard-wiring (the source comment explains why: persisted desktop settings must not break the packaged build). The defect is not the constant itself but that no runtime gate isolates mock mode from it (§3.1). Recorded here so the executor does not "fix" it by deleting the constant — the fix home is T-559/T-560.

### §6.3 AI Copilot drawer in unconfigured state (BUG-044, LOW, honest-uncertainty)

Observed: first message send (after conversation restore from localStorage) → `Maximum update depth exceeded` ×N in console, drawer subsequently unmounted, **no assistant reply**, error toast transient; second send in a clean console → 0 loop warnings, still no reply (the provider is unconfigured — expected), and the user turn persisted anyway (two unanswered user messages after reload — T-268 persistence stores failed turns). Registered as BUG-044 with verification level "runtime-observed once, non-deterministic; origin not pinned" — the follow-up probe (clean localStorage, fresh session, instrumented send) is the next-session candidate. The deterministic part (unanswered turns persist silently) is confirmed.

### §6.4 Console noise (cosmetic, no ID)

`[SyncService] Already initialised — returning existing instance.` ×3 by dashboard time — the re-entrancy guard trips on module re-eval/double provider mount. Benign; candidate for the cosmetic queue alongside Deep Sweep/05 §7.

### §6.5 Dev scheduler interval (dev-only, no ID)

`backup.scheduler.armed {nextRunInMs: 300000}` in dev vs the `scheduledHour: 2` config — the dev-mode arm interval is 5 minutes, not the 02:00 daily. Production config field is intact; behavior difference documented in the console evidence file so a future runtime probe does not mis-read it as a schedule bug.

---

## §7 What the runtime lane changed in the record (register deltas)

| Register item | Content |
|---|---|
| **BUG-042** (CRITICAL) | Configuration-tab unbounded error-refetch loop — full chain, 7,148-request evidence, test blind-spot analysis, T-559/T-560 fix drafts (§3) |
| **BUG-043** (LOW) | Settings `?tab=` deep link mount-only (§6.1) |
| **BUG-044** (LOW) | Copilot unconfigured failure mode: silent no-reply + failed-turn persistence + once-observed update-depth error (§6.3) |
| **C-20** (correction) | The "mock-mode dev server" premise: bare dev defaults to LIVE canonical Supabase; mock requires the localStorage/local-config toggle (§2) — corrects handoff-session-08/09/10 planning text and S7 report §carry-forward |
| OPS-011 | now **8-run-stable** (S10 probe; `01-INFRASTRUCTURE-STATUS.md`) |
| Method lessons | 3 banked (§1): offsetParent-on-fixed, untrusted-events vs Radix, z-50 overlay interception |

Next free IDs after S10: **BUG-045, DEAD-018, DUP-035, ARCH-037, OPS-014; next correction C-21.**

---

## §8 Re-run recipe (next runtime probe)

```bash
cd elimtiyaz-desktop
npm ci --ignore-scripts --no-audit --no-fund
npx vite --port 5173 --strictPort --host 127.0.0.1 &
# agent-browser:
#   open http://127.0.0.1:5173
#   storage local set "el-imtiyaz.local-config" '{"supabase_use_supabase":false}'
#   reload → login admin@elimtiyaz.dz (any password)
#   … walk …; before leaving: network requests | grep -c system_settings
# BUG-042 regression check = the count must stay 0 unless Configuration is visited,
# and 1 visit must produce ≤1 fetch and ≤1 toast after T-559/T-560 land.
```

The evidence files + 5 screenshots in `Deep Sweep/censuses/runtime-s10-*` are the comparison baseline.
