# Handoff — Session 47 (from Session 46, 2026-11-22)
**Repo:** Vtheonly/AgentGithubUplaod · **Branch:** main ONLY · **Start here:** `docs/recovery/next-task.md` + this file.

## Where the system stands
The owner-reported client-history PDF misalignment is FIXED and pinned (commit 36cd861c): the account statement's Émis-le date no longer draws off-page, amounts are right-aligned, cells are clipped, continuation rhythm and the synthèse row are even, the count-note flows. 32 task cards solved since G0; 89 open (unchanged — this was an owner-reported defect outside the plan-card register). tsc 0; t-368 14/14.

## THE HARD RULES (unchanged)
§15.111(a) frozen admin accounts; §15.111(c) probe /v9/projects before any Vercel promise; the E6.7/E6.8/E6.10 composition surfaces; the person-name resolvers and the reversal idiom (Session 45).

## Exact next tasks, in priority order
1. The Session-45 queue head stands: the E6 remainder (E6.1-E6.6, E6.11, E6.12) or the E7A/E7B lanes (T-576, T-578-T-588); the ≥4-task mandate stands.
2. If the owner reports misalignment on the OTHER generators (receipt / bulletin / payslip / report-document): apply the S46 technique FIRST (scripts/verify-pdf-geometry.mts pattern — inflate + Tm/Tj + pdf-lib metrics), measure, then fix; the t-368 extractTextGeometry helper is the in-repo template.
3. UNKNOWN-031 (the prescolaire/AcademicLevel taxonomy) still awaits the owner.

## Key operational facts
- The sandbox was RECYCLED before this session: the repo was re-cloned fresh (node_modules reinstalled; the npm install-scripts gate blocks some optional packages — pdfjs-dist will NOT install; the zlib technique replaced it).
- The statement harness: `npx tsx /home/z/my-project/scripts/gen-statement.ts [outPath]` (run from elimtiyaz-desktop/).
- pdf-lib compresses content streams (FlateDecode) — raw PDF text is NOT greppable; inflate first.
