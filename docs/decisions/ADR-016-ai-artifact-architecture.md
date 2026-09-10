# ADR-016: The Tool-Result Artifact Architecture — Charts, Diagrams, and Documents Rendered From Tool Results; the 27-Tool Capability Ecosystem

- **Status:** ACCEPTED (2026-09-10, 42nd session — T-272..T-276)
- **Context:** ADR-015 (the copilot's domain-data policy), AGENTS.md §15.5/§15.8/§15.16 (no client-side re-derivation; human-gated writes; canonical data first), the owner's 42nd-session mandate ("a much more capable AI system with a proper tool ecosystem: powerful tools for analyzing data, generating statistics and charts, drawing diagrams, working with documents… complex workflows instead of just answering a few questions").
- **Decision taken by:** the 42nd session agent, under the owner's capability-ecosystem mandate.

## Context

After the 41st session (AI-310), the copilot answered operational questions from 12 read/proposal tools — but every tool result was a flat JSON blob the model re-typed as prose. The user never SAW a chart, a diagram, or a downloadable document; the copilot could not produce statistical insight (trends, outliers, comparisons), could not compose visuals, could not generate a single official document, and could not run multi-step workflows (a collection campaign, a batch of reminders, a payment plan). This ADR records the architecture that closed those gaps without breaking ADR-015's data policy or the §15.5 mutation discipline.

## Decision

1. **The artifact contract (T-272).** A tool result remains a JSON string on the wire (the `role:"tool"` protocol is unchanged — the EF and the model need no new surface). That JSON may carry ONE structured `artifact` under the reserved key. Three kinds:
   - **Chart** (bar / grouped / stacked / line / area / pie / donut): categories + series + unit, capped at 60 categories × 6 series. Rendered by the zero-dependency `chart-svg.tsx` engine (the repo's markdown-view precedent: no recharts for a 576px drawer).
   - **Diagram** (hierarchy / flow): nodes + edges with level-based layout, built ONLY from canonical entities (family → children → classes; class → roster). Never from model memory.
   - **Document** (pdf / xlsx / csv): PDF documents carry REFETCH params (bytes never enter the conversation — the provider rebuilds them through the canonical generators at click time); XLSX/CSV exports embed their rows (capped at 500) so the export is self-contained and what-you-see-is-what-you-download.

2. **The render-path gate.** EVERY artifact entering the drawer is validated by `artifacts.ts` first (`validateChartArtifact` / `validateDiagramArtifact` / `validateDocumentArtifact` → `parseToolArtifact`). A malformed artifact — including one a model composed via `render_chart` — is DROPPED (logged), never rendered; the model's textual answer stands on its own. Fail-open to "no visual", never to a broken UI.

3. **Statistical enrichment over canonical streams, never a parallel derivation (the §15.5 boundary).** `analysis/statistics.ts` and `analysis/insights.ts` are GENERIC MATH (mean/median/quartiles/Tukey fences/OLS trend/risk scoring) over vectors that are ALWAYS canonical outputs — payment amounts from the payments stream, outstanding from `computeParentSummary`, GPAs from `evaluateStudentTermPerformance`, rates from `calculateAttendanceRate`. The tools quote those sources; no business number is re-derived client-side (§15.16).

4. **The heuristic layers are documented, bounded, and advisory.** Campaign priority (amount×aging weights per strategy), intervention risk (45 academic + 35 attendance + 20 data-gap), and payment plans (equal installments, last row absorbs the rounding rest so the plan sums EXACTLY to the canonical outstanding) are ranking/explanation aids surfaced WITH their formulas and thresholds in the tool output. They rank; they never mutate. A payment plan is a PRINTED commitment (PDF to hand the family), never an installment write — the registration goes through the canonical workflow if the school accepts it.

5. **Mutations stay proposal-only; one new type, one real execution leg.** `propose_batch_reminders` emits a single `ActionProposal` of type `batch_reminders` carrying ≤ 10 validated debtor ids; the approval leg executes the CANONICAL `repos.debt.sendReminder` per parent with honest per-parent results (partial failures are reported precisely; the card settles `executed` only when every reminder went out — the T-267 honest-settle rule, batched).

6. **Documents are read-only products.** `generate_parent_statement` reuses the SAME `generateAccountStatementPdf` the CRM drawer uses; `generate_class_report` / `generate_debt_report` / `generate_payment_plan` are thin adapters over ONE generic `report-document.ts` builder (which itself reuses the receipts' `shared.ts` primitives — one table renderer, three documents, zero duplication, §9). `export_data` builds rows through the SAME `buildXlsxBuffer` engine the app's export buttons use. No AI path writes to the database.

7. **The registry is composed, capped, and synchronized with the EF.** `tool-registry.ts` combines the five suites (core 12 + analysis 5 + visualization 2 + document 4 + workflow 4 = 27) into the single `SYSTEM_TOOLS_DEFINITIONS` wire array — all tools always on the wire (the T-266 no-slicing rule, preserved). The ai-proxy EF's `tools` array cap is 40: the cap must be ≥ the registry size or every agent-stream call 400s (`invalid_tools`) — the two MUST move in the same change (source-guard-pinned both sides: the test asserts `EF cap ≥ SYSTEM_TOOLS_DEFINITIONS.length`).

8. **MAX_TOOL_STEPS rose 5 → 8.** The composite workflows legitimately chain 4–6 tool rounds (search → analyze → visualize → propose → document) before the final synthesis; 5 cut them mid-flight. The runaway-loop guard stays meaningful at 8.

## Consequences

- The conversation (localStorage, T-268 cap 60) now persists tool outputs carrying artifacts — chart specs are small (aggregates), export rows are capped at 500; the cap discipline prevents unbounded growth.
- The model can compose charts via `render_chart`, but the validation gate makes a malformed composition a structured tool ERROR the model must correct — the UI never sees a bad chart.
- PDF byte generation happens at CLICK time in the provider (`downloadArtifact`) — a document artifact whose refetch params no longer resolve (data changed since generation) fails with an honest French error, never a silent no-op.
- The 42nd-session live evidence (t-277-live-verification.md P2) pins the deploy dependency: the EF cap-40 code is committed but the DEPLOY is owner-gated (sbp_ token not re-supplied this session). Until the owner runs the one-line deploy, edge-mode agent-stream calls with the 27-schema registry will 400 `invalid_tools` — the runbook is in the matrix script header; BYOK mode is unaffected (direct Groq, no cap).
- Future tool suites (e.g. timetable queries, expense analytics) join `tool-registry.ts` in the same change as: (a) the EF cap check, (b) the registry-count test update, (c) the system-prompt capability map update — all three source-guarded by T-278.
