# ADR-015: The Copilot's Domain-Data Policy — Grounded Tool Results, BYOK/EF Transports, Human-Gated Writes

- **Status:** ACCEPTED (2026-09-10, 41st session — T-267/T-269)
- **Context:** ADR-002 (canonical financial engine), ADR-008 (chat is committed), plan §11.02 (keys never leave the server), SEC-002 (PII masking on single-shot paths), AGENTS.md §15.5/§15.8 (no client-side re-implementation of server-owned rules; no AI writes without human validation).
- **Decision taken by:** the 41st session agent, under the owner's production-quality AI mandate.

## Context

The Universal Copilot (T-260/T-261) executes function-calling tools against the REAL repositories and canonical calc engines, then sends the tool results (real parent names, balances, GPAs, attendance records) into the model's context to ground its answers. This is deliberately DIFFERENT from the single-shot feature paths (narrative/drafting/anomaly), which mask PII client-side (`AIRequest.maskedContent`, SEC-002) before any network transport. The asymmetry needs an explicit, recorded decision — otherwise a future agent will "fix" one side or the other as an inconsistency.

## Decision

1. **The agentic path is domain-grounded BY DESIGN.** Tool results carry real data because the staff user asked about it and the answers must be ledger-exact (§15.16: never synthesize financial data). Masking would break the grounding (the model could not distinguish Benali from a placeholder) and add nothing: the desktop is a staff terminal, the conversation is user-initiated, and every tool call is attributable.

2. **Transports, in order:**
   - Single-shot features (narrative/drafting/anomaly): `ai-proxy` Edge Function with the PII-masked prompt (SEC-002 unchanged); BYOK direct only when the EF is unreachable; mock only for dev/demo.
   - Agentic copilot: BYOK direct from the desktop with the AES-256-GCM-encrypted key (T-260), or the EF's agent-stream mode (T-262/T-269) when the staff terminal is configured for the server-side key. Both are staff-authenticated (`use_ai` permission + SuperAdmin grant per AI-309).

3. **Writes are human-gated, always.** Mutating tools emit `ActionProposal`s (validated arguments — T-267); the only executions are canonical repository methods (`payments.adjust`, `debt.sendReminder`). No AI path writes directly. Types without a canonical execution settle as `dismissed` with a truthful toast — never a fake "executed" (the honest-settle rule).

4. **Default models must be LIVE-reachable.** Every hardcoded model id (defaults, EF fallbacks, placeholders) must be verifiable against the owner's actual key (the T-269 discovery: the entire llama/qwen line was removed from Groq's 2026 catalog for this account; `openai/gpt-oss-120b` / `openai/gpt-oss-20b` are the reachable ids). The settings tab's live model discovery (`queryLiveProviderModels`) is the sanctioned re-derivation path — catalog drift is a selection, not a code change.

## Consequences

- The copilot's conversation (including tool results) may contain parent names and amounts in the provider's context. Acceptance basis: BYOK keys are the owner's own; the EF path is authenticated and rate-limited with audit logging (`ai_request_logs`); the conversation never persists to any server table (localStorage only, T-268).
- gpt-oss reasoning tokens share the `max_tokens` budget — budgets must leave room after reasoning (default 2048 is safe; the T-269 live evidence documents the failure mode).
- Future proposal types (record_attendance, dispatch_task) require their execution leg to be added to `approveAction` in the SAME change that introduces the generating tool (pinned by the T-270 source guards).
- If a future compliance requirement demands PII masking on the agentic path, that is a NEW ADR superseding this one — not a silent change to either path.
