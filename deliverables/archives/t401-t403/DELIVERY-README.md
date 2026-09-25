# T-401 + T-402 + T-403 — Delivery Archives (85th session, 2026-09-22)

The three-task mandate, fully delivered and verified on production:

- **T-401 — Full Filière / Spécialité Integration** (migration 0107, ADR-019,
  live 17/17): the canonical Niveau → Filière → Spécialité → Classe/Section model —
  catalog, columns, the compatibility guard, class-formation stamping, promotion
  history stamping, import preserve, desktop + portal integration.
- **T-402 — Canonical Batch Promotion** (live 9/9 + the t-041 regression 10/10):
  the 12-surface promotion-path audit; the desktop history-read gap closed
  (embedAcademicHistories); ONE business path, source-guarded.
- **T-403 — Batch Promotion Cycles** (migration 0108, live 16/16): the
  human-in-the-loop academic-year workflow — one cycle per source year,
  class-by-class review + confirm, the [NOTES_INCOMPLETES] two-phase ack, the
  reopen path, whole-cycle completion gating; the one-shot modal retired.

## The archives

| File | Content |
|---|---|
| `AgentGithubUplaod-main-t401-t403.zip` | The hub repo at main `070d0cb` (desktop app + canonical Supabase backend + the documentation system) |
| `elimtiyaz-website-main-t401.zip` | The parent portal at main `f1d0ef1` |

Evidence: `docs/recovery/t-401-live-verification.md`, `t-402-live-verification.md`,
`t-403-live-verification.md` inside the hub zip; the registries
(task/problem/change-log/next-task) are all updated.
