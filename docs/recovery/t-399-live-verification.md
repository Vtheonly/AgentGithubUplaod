# T-399 Live Verification — the Ctrl+O test-data autofill (OPS-321)

> Task: T-399 — the owner's mandate: *"when i press Ctrl+O while i am on any form, it should automatically fill all fields with realistic, fake, but valid test data... the form can be submitted successfully and the data can actually be inserted into the database... this should work consistently across all forms in the application."*
> Session: 83rd (2026-09-21). Commits: 8985457 (registration) → e8b0d75 (the implementation) → the closeout.

## What was built

`src/shared/devtools/test-data/` — a cross-cutting module mounted once in `app.tsx` (next to the ToastViewport, inside ToastProvider + i18n):

| File | Role |
|---|---|
| `generators.ts` | The value source — REUSES the mock fixtures' seeded `makeRng`/`buildCode` + the Algerian name/occupation/street pools (additively exported from `parent-fixtures.ts`/`student-fixtures.ts` — §6, zero parallel pools). One coherent identity per press: gender-consistent first names (adult + student pools merged), a family last name, a run-unique phone in the field's own placeholder format (spaced `05XX XX XX XX` / `+213 …` / compact), a derived e-mail, ISO dates, in-range DZD amounts, ADR-003 identity codes (PAR-/ELV-/ACT-YYYY-AB1234). PURE module — imported by both the browser engine and the node live-e2e driver. |
| `classify.ts` | Field → semantic kind from label + placeholder + declared type. French-first vocabulary (the 83rd-session label census), Arabic + English synonyms. Two traps fixed: JS `\b` never matches around Arabic letters (Arabic rules are unbounded substrings), and NFD decomposes أ (U+0623) into ا + U+0654 — the strip range covers U+064b–U+065f and the RULES are normalized through the same `normalizeText` at module init. |
| `autofill-engine.ts` | The DOM engine. Scope: focused element → enclosing form → open dialog → largest form → main. Fills React controlled inputs via the native value setter + bubbling input/change. Honors min/max/step/minLength/maxLength/pattern/required. Radix Selects via the real open→pick→click dance (pointerType "mouse" + button 0; a compat shim patches ONLY the missing jsdom APIs — hasPointerCapture/releasePointerCapture/scrollIntoView/ResizeObserver; real browsers untouched). Picks REAL options (never the « Aucune zone » sentinel), gender-consistent. SAFETY RAILS: never submits, never flips switches, never touches file/disabled/readonly inputs, restores focus. |
| `use-test-data-autofill.tsx` | The global Ctrl+O/Cmd+O listener (the topbar Ctrl+K pattern — no Electron menu collision: Fichier carries quit only) + the toast feedback, every string through the fr/ar/en dictionaries (the T-385/T-388 discipline; parity check OK). |

Zero per-form registration — every form (the 4-step wizard, the 25+ AutoFormModal/handwritten modals, page forms) is covered by construction, and future forms inherit the capability.

## Verification evidence

### 1. Unit suite — `src/tests/features/t-399-test-data-autofill.test.tsx` — **23/23 PASS**

- **Generators vs the REAL validators**: the phone values match the app's `PHONE_RE` (imported from `edit-parent-modal.tsx`, now additively exported — never a re-typed copy), e-mails match `EMAIL_RE`, template phones preserve the placeholder's exact shape (`0550 12 34 56` → 4-digit-group spaced; `+213 555 …` → country head + a REAL mobile indicator 5/6/7; `0554288142` → compact), identity codes match `/^PAR-\d{4}-[A-HJ-NP-Z]{2}\d{4}$/`.
- **Constraints + coherence**: birth dates are valid ISO inside the declared window; amounts inside [min,max] snapped to step; two presses differ (run-unique); one press is coherent (gender-consistent names, family last name, phone == WhatsApp).
- **Classifier**: the app's actual vocabulary (Prénom/Nom/Genre/Téléphone/WhatsApp/E-mail/Date de naissance/Montant/Remise (DZD)/Notes/Code/Adresse…), the precedence pins (Prénom never a lastName — the `\b` trap; « Nom complet » → fullName — the rule-order pin), Arabic labels classify (`الاسم الأول`/`اللقب`/`الجنس`/`هاتف`), type-only fallbacks.
- **Engine + hook (jsdom, the REAL shared components)**: a representative parent form (the edit-parent shape: FormField + Input + Radix Select + Switch) is fully filled by a real Ctrl+O keydown on window — text fields valid, the toast reports the count, **the Radix selects got REAL options** (the zone ≠ the `__none__` sentinel; the gender consistent with the generated first name's pool), the Switch was NOT flipped (the safety rail), disabled/readonly skipped, a required checkbox checked, min/max/step/maxLength honored, a form-less screen reports "nothing to fill", plain `o` without Ctrl is a no-op.

### 2. Gates

- `tsc --noEmit`: **6 errors = the pre-existing concurrent-agent baseline** (the `editing`-prop fixture drift — zero new).
- `npm run lint`: **0 errors**.
- `scripts/i18n/check-parity.mjs`: **PARITY OK** (the 7 new `devtools.autofill.*` keys exist in fr/ar/en).
- FULL `npm test`: **3572 passed / 21 failed / 5 skipped** — the +23 new passing vs the 82nd-session 3549 baseline; the failing set IDENTICAL (the concurrent agent's fixture drift: t-355/356 dashboard, Tier4 mirrors, t-390 realtime, vault, t-134, ai-review-screens — untouched by this task).

### 3. LIVE e2e — `scripts/t-399-autofill-data-live-e2e.ts` — **ALL PASS (22 checks)**

The database is the final validator: the SAME generators built a complete registration payload, pushed through the **REAL `SupabaseStudentRepository.batchRegister`** (the T-398 ONE-round-trip path) against production:

- Leg 1 — the generated formats: phone `0542 27 15 47` matches PHONE_RE; e-mail `nawel.saidi120@example.dz` matches EMAIL_RE; birth date ISO `2011-10-11`; gender-consistent family names.
- Leg 2 — the real insert: `batchRegister` Ok in **447 ms** (ONE round-trip); identity codes `PAR-2026-7037B4` / `ELV-2026-5E1162`; the student linked to the parent.
- Leg 3 — the read-back: the persisted `parents` row carries EVERY generated value verbatim (`first_name`, `last_name`, `primary_phone`, `secondary_phone` == the run phone, `email`, `occupation`); the `students` row carries the generated name, the FAMILY last name, the ISO `date_of_birth`, the parent FK; the billing landed (4 ledger + 3 installments, Σ tuition == Σ installments == 305,000 DZD).
- Cleanup — the canonical soft-delete RPCs, **zero visible residue** (§15.38/§15.26: run-unique probe rows only; the audit rows stay as the honest record).
- Run-uniqueness across runs observed live: the first probe run drew `Reda Touati / 0656 83 38 45`, the second `Sabrina Saidi / 0542 27 15 47` — every Ctrl+O press generates fresh data.

## The two engineering discoveries (persisted as AGENTS.md §15.40)

1. **The act-deferral trap**: a DOM-driving engine that awaits portal mounts MUST run OUTSIDE an active `act()` scope — React captures every synthetic-event update inside the scope and defers the flush to the act boundary, so the Radix portals never mount during the engine's poll window (the select legs time out despite a correct dance). The fix is the test-side `runAutofillLive()` helper (`IS_REACT_ACT_ENVIRONMENT=false` around the engine call) — the browser has no act and is unaffected.
2. **The Radix Select synthetic-event contract** (verified against the packaged source): opening requires `pointerType === "mouse"` + `button === 0` + `!ctrlKey` on pointerdown; item selection fires on pointerup (after a pointermove records the pointer type); and the content-mount path calls `hasPointerCapture`/`scrollIntoView`/`ResizeObserver`, whose absence in jsdom CRASHES `SelectContentImpl`'s mount effect and silently unmounts the whole tree. Also: `data-state="closed"` sits on the TRIGGER of any closed select — a visibility filter matching it excludes every combobox before the dance starts.

## Remaining / follow-ups

- The owner's acceptance pass: press Ctrl+O on any form in the packaged app (the wizard, « Modifier le parent », the Settings forms) — review the toast, submit.
- The engine deliberately does NOT flip Switches/toggles (destructive-option risk, §15.38 discipline); if a specific form REQUIRES a switch on to submit, the operator flips it manually.
- Search inputs (`type="search"`), file inputs, and CAPTCHA-like surfaces are out of scope by design.
