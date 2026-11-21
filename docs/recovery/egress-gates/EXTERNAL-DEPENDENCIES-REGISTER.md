# T-595 — the external-dependencies register (D-17)

**Task:** T-595 (E7A-5 / ROADMAP 6.7) · **Generated:** 2026-11-21 (Session 36) · **Census:** `external-census.json` (same directory; regenerate with `node scripts/run-egress-harness.mjs --external <name>=<path> …`)

Per the T-595 card (step 3) and D-17: the client portal and the sibling repositories that consume the SAME Supabase estate are REGISTERED FOR AUDIT — their queries JOIN the egress audit set. Both sibling repos were provided to Session 36 and censused; the counts below are **static call sites** (the audit-set membership register), not runtime request counts.

## The register

| # | Dependency | Kind | Query surface (static census) | Status |
|---|---|---|---|---|
| 1 | `portal.elimtiyaz.dz` | The deployed client portal (the website deployment; the T-614 cutover target `https://elimtiyaz-website.vercel.app/`) | == the `Vtheonly/elimtiyaz-website` repo (below) — the portal is that repo's deployment; no separate codebase | REGISTERED (censused via the repo) |
| 2 | `Vtheonly/elimtiyaz-android` | The Android sibling (Kotlin/Compose; supabase-kt) | 30 `.from()` call sites across 21 tables (top: chat_messages, expense_tickets, user_profiles, notifications, homework) + 18 `.rpc()` sites across 14 functions; 450 code files scanned | CENSUSED (repo provided 2026-11-21) |
| 3 | `Vtheonly/elimtiyaz-website` | The website portal source (Next.js; @supabase/supabase-js) | 57 `.from()` call sites across 32 tables (top: student_documents, chat_messages, notifications, parents, notification_preferences) + 5 `.rpc()` sites across 4 functions; 181 code files scanned | CENSUSED (repo provided 2026-11-21) |
| 4 | `elimtiyaz-desktop` (this repo) | The desktop terminal (the audit-set owner) | 613 `.from()` call sites across 80 tables + 127 `.rpc()` sites across 74 functions; 1,095 code files scanned — the t-591 unbounded-read guard + the T-590/T-592/T-593 lanes govern the read family | The audit-set owner (measured by the harness) |

## What membership means (D-17)

- The censused query surfaces are part of the SAME egress budget as the desktop's — any future query-shape change in the portal/Android that reintroduces an unbounded or volley pattern lands in THIS audit set.
- The portal's cutover (T-614) re-points surfaces 1-3 onto the NEW project (`gvuvibcsfjhwcjikgxql`); the census is the pre-cutover baseline for the §A.7 end-to-end smoke.
- The static census does NOT gate the four OPS-015 classes (those are the desktop's own measured gates — see `OPS-015-DELTA-TABLE.md`); it exists so the LIVE-window audit sees every consumer of the estate.

## Re-run

```bash
cd elimtiyaz-desktop
node scripts/run-egress-harness.mjs \
  --external "elimtiyaz-android=/path/to/elimtiyaz-android" \
  --external "elimtiyaz-website=/path/to/elimtiyaz-website"
```
