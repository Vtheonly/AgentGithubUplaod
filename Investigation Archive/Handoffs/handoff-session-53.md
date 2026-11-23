# HANDOFF — Session 54 (from Session 53, 2026-11-24)

## Where things stand
- **The baseline is FULLY GREEN at HEAD (`bfc5e242` + this closeout): 5,853 passed / 0 failed / 5 skipped** (domain/core/cross-platform 2,608 · infrastructure 1,538 · features+perf+security+shared+integration+app 1,334 · ai 161 · ui 212). tsc 0 (renderer + electron).
- **The census: 55 task cards solved since G0; 73 open; 127 registered.**
- All five Session-53 commits are PUSHED to main (`29b3f4e4` → `8a45ef0e` → `f6417d8c` → `99f32772` → `bfc5e242`).

## The queue head for Session 54
1. **T-588 — the settings 8-store unification** (the LAST S50-batch card): system_settings becomes the single tenant-level store — the RBAC matrix → `tenant_role_overrides` (BUG-017), the dead keys (DEAD-018), the `?tab=` deep-link effect (BUG-031/043), the backup passphrase mirror + daemon-schedule read wiring to the DB (with T-581), and the 13+ store collapse (C-25). READ THE CARD FRESH in EXECUTION-PLAN §4 — E6.11's hooks (use-settings-section / use-edit-modal) are the canonical convergence destination.
2. **T-590 — the dashboard aggregation** (per EXECUTION-PLAN §4 — read the card).
3. **T-591 — the projections/pagination.**
4. Then the §16 overhaul family (T-587/T-612/T-613) or the E7A/E7B lanes per §2's sequencing.

## Files to inspect first
- `elimtiyaz-desktop/src/i18n/i18n.ts` — the lazy ar/en backend (T-583). Any NEW locale work must go through the backend's `read` (never re-bundle ar/en eagerly). The t-583 E-suite pins the contract.
- `elimtiyaz-desktop/supabase/functions/workflow-scheduled-runner/` — the T-584 runner (cron.ts + core.ts are Deno-free BY DESIGN — the desktop imports them; index.ts is the thin Deno wrapper). If a scheduled workflow misbehaves: the EF response's `skipped[]` carries per-workflow reasons; the seeded template's cron is NOW `"0 18 1 1,4,7 *"` (the old "0 18 * * 12" was invalid — DOW 12).
- `elimtiyaz-desktop/src/infrastructure/ai/ai-config-storage.ts` + `electron/main.cts` (safeStorage handlers) — the T-585 keychain. The passphrase file is `userData/ai-passphrase.bin` (safeStorage-encrypted). The legacy localStorage slot self-purges on migration.
- `docs/decisions/ADR-036-ai-surfaces-french-only.md` — the AI-i18n decision (French-only; prompts never branch on the locale).
- `docs/operations/credentials.md` §10 — the owner's deploy + dry-run commands for the runner EF.

## Owner-facing notes
- The desktop boots −71 % lighter (eager JS 6.2 MB → 1.8 MB; pdf-lib/exceljs/recharts load on first use); the splash is 1 s and click-dismissible; Ctrl+O autofill is dev-build-only now.
- The AI requests no longer target a model id that 404s on the owner's Groq key (both feature modals ride the configured gpt-oss defaults).
- The scheduled-workflow runner needs the owner's one-command deploy on gvuvibcsfjhwcjikgxql (credentials.md §10) — the dry-run curl verifies it without side effects.

## Verification discipline (this session's hard-won specifics)
- **The full battery in chunks**: domain+core+cross-platform (~98 s) → infrastructure (~338 s) → features+performance+security+shared+integration+app (~477 s) → ai (~30 s) → ui (~48 s). Background `nohup` processes do NOT survive between tool calls — run everything inline.
- **The Electron boot smoke under Xvfb**: the container's GPU process cannot launch (`--disable-gpu` still crashes) — use `--in-process-gpu`; launch with `NODE_ENV=production` (main.cts otherwise loads localhost:5173); the userData artifacts land at the ROOT of `--user-data-dir` (no `Default/` subdir) — poll for `<user-data-dir>/Session Storage`; Xvfb must be started IN THE SAME tool call as the smoke (it dies between calls).
- **A manualChunks change must be verified against `dist/index.html`'s modulepreload list** — the entry size alone hides small shared deps dragging whole vendor chunks eager (the T-583 tailwind-merge discovery).
- **Block comments cannot contain `*/n`-like sequences** (the T-584 test-comment self-close) and rg multi-pattern output in this container can garble some tokens — prefer `grep -n` for exact-string checks on critical files.
- **The t-575 ARCH-046 census is 16 now** (T-584's EF) — any NEW EF must grow BOTH the directory and the config entry, and re-pin the census count.

## Uncertainties / open items
- T-588's store inventory (C-25's 13+) needs a fresh census at HEAD — the E6.11 boundary documented which ceremonies converge onto the hook as T-588 lands.
- The live EF deploy (workflow-scheduled-runner) is owner-gated per the egress charter — everything code-side is verified; credentials.md §10 carries the commands.
- Owner-gated items unchanged: the 6 flagged workbook rows, UNKNOWN-031, the Vercel redeploy (§15.111c).
