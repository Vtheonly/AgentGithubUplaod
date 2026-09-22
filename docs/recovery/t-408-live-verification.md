# T-408 — Live Verification Evidence (88th session, 2026-09-22)

**Task:** T-408 — Academic Setup Unblocked (subjects / teachers / classes) + the Algerian curriculum catalog + the portal timetable.
**Problems closed:** ACAD-506, ACAD-507, ACAD-508, SCHED-105, SCHED-106 (+ SCHED-103 flipped MITIGATED → RESOLVED).
**Backend:** vebfehrpzajhstyhinnw (eu-west-1), owner-supplied sbp_ Management token (never persisted; used for the atomic applies below).

---

## 1. The owner's reports, decoded

| Console evidence (owner-supplied) | Decoded root cause | Problem |
|---|---|---|
| `POST/GET /rest/v1/classes?select=*,academic_years!inner(code,label)` → 400 | The bare-select URL is the POST-with-representation of class creation; the payload carried `academicLevelId: "al-1ap"` (mock-era) into the uuid column | ACAD-506 |
| `class_subjects?...personnel!left(...)` → 400 ×5 (previous session) | SCHED-103 — already mitigated app-side; 0112 was pending the token | SCHED-103 |
| "issue when creating subjects" | Phantom required zod `level` field never rendered → invisible validation block | ACAD-507 |
| "issue when creating teachers" | `repos.teachers` = mock in Supabase mode; live personnel uuids rejected by the mock store | SCHED-105 |
| "modules and subjects according to the Algerian system" | ADR-018 architecture in place but ZERO catalog data (0 subjects, 0 configurations) + the 62nd session's standing "populate the real coefficients" residual | ACAD-508 |
| "no timetable in the web version" | 0110 had exposed published versions to parents; the portal had no view/hook/i18n | SCHED-106 |

## 2. Live reproduction (before the fix — the evidence chain)

Rolled-back transactions against the production DB (the inspect-live-db convention; zero residue):

- `INSERT classes ... academic_level_id 'al-1ap'` → `22P02: invalid input syntax for type uuid: "al-1ap"` (TEST E) — the exact 400.
- `INSERT classes ... academic_level_id NULL` → `23502` NOT NULL (the same failure class if the dialog ever omitted the level).
- `INSERT subjects ... domain 'sciences'` → `23514 subjects_domain_check` (an aside — the app never sends domain; the column default 'scolarite' is valid; TEST C2 with the app's exact shape PASSED, proving the client-side block was the subject-creation failure).
- FK census: `classes→academic_years` FK EXISTS; `class_subjects→personnel` FK MISSING while `schema_migrations` (supabase_migrations schema) listed '0112' — **the false registration**.
- Data census: tenants 1 (El-Imtiyaz Boumerdès); academic_years 1 (2026-2027, is_current, **code NULL**); academic_levels 14 (the Algerian ladder, seeded); classes 0; subjects 0; class_subjects 0; personnel 5 (all soft-deleted T-400 test residue).

## 3. The atomic live apply (HTTP 201)

`SUPABASE_ACCESS_TOKEN=sbp_… bash scripts/apply_0113_fk_0114_catalog_live.sh` — one transaction: the 0112 idempotent body (orphan cleanup + both FKs NOT VALID→VALIDATE) + its `ON CONFLICT DO NOTHING` registration + the 0113 body (§1 identities, §2 configurations, §3 the year-code backfill, §4 `v_timetable_published`) + its registration. Pre-checked with a full dry-run in a rolled-back transaction (both FKs visible inside the transaction; no errors).

**Post-check (verbatim):** `fks_validated: 2, catalog_rows: 14, years_missing_code: 0, portal_view: 1`.

## 4. verify_t-408.sql matrix (all GREEN live)

- C1: 14 identity matières, all cycle NULL, all domain 'scolarite'.
- C2 (the 4AM BEM scale, verbatim): ANGLAIS 2, ARABE 5, EDU_ISLAM 2, FRANCAIS 3, HIST_GEO 2, MATHS 4, PHYSIQUE 2, SVT 2 (+ the coefficient-1 EPS/Art/Info rows).
- C3: 127 configuration rows across all 14 levels, direction 'general', current year.
- C4: 0 academic years missing a code.
- C5: both 0112 FKs `convalidated = true`.
- C6: 0 orphans (class_subjects.teacher_id / classes.homeroom_teacher_id).
- C7: the view's 20-column shape as designed.
- C8: 0 non-published rows leak through the view.

## 5. The SCHED-103 flip (t404-postgrest-smoke.sh --expect-fk) — 10/10

- P2 — the USER-REPORTED production URL (verbatim): **400 → 200** (the personnel!left embed resolves).
- P3/P4/P5 — the fixed curriculum query, the other loadProblem queries, every other app embed: all 200.

## 6. End-to-end creation proofs (the exact app payload shapes, admin JWT, zero residue)

- **Class creation:** `POST /rest/v1/classes?select=*,academic_years!inner(code,label)` with the FIXED payload (the real 1am level uuid, the 2026-2027 year) → **HTTP 201**, the representation carries `"academic_years":{"code":"2026-2027"}` (the §3 repair visible in the embed); cleanup DELETE 204.
- **Subject creation:** `POST /rest/v1/subjects` (the app's shape — no domain, no level) → **HTTP 201**; cleanup 204.
- **Teacher registration:** the personnel UPDATE path proven at the policy level (personnel_admin ALL for super_admin/manager/support_staff over the tenant) + the t-407 suite pins the repository behavior (the live personnel table holds no real staff yet — only soft-deleted T-400 residue — so the flow needs the owner's real personnel first).

## 7. The portal view (live probes)

- Authenticated (admin JWT): `GET /rest/v1/v_timetable_published?select=...` → **200** `[]` (no published version yet — the honest state).
- Anon: → **401** `permission denied for view v_timetable_published` (the REVOKE holds).

## 8. Suites and gates

- Desktop: t-408-academic-setup.test.ts **18/18**; FULL suite **3709 passed / 21 failed** = the byte-identical session-opening baseline (10 files: the parallel agent's dashboard/analytics/financial/vault zone); `tsc --noEmit` **0**; eslint **0 errors**; vite production build green.
- Website: t-407-portal-timetable.test.tsx **11/11**; FULL suite **640/640** (629 baseline + 11); `tsc --noEmit` **0**; eslint clean; next production build green.

## 9. Residuals (honest)

- Per-filière BAC coefficients at 2AS/3AS: owner-configurable via the SubjectConfigurationsPanel (data, not code).
- Tamazight: identity-only (configure where taught).
- The 0112 false-registration ROOT CAUSE is unidentified; the guard is AGENTS.md §15 rule 45 (verify catalog state, never trust the version table).
- The .exe rebuild + ASAR verification: see the change-log 88th-session entry (the packaging gates re-run).
