# DELIVERY — T-488 (the 144th session, 2026-10-04)

## What this delivery is

The owner's **Staff DM report**, fixed and verified end-to-end:

> "The in-between messaging/DM functionality in the Staff section is not working. It says that at least one recipient is required, even when a recipient should already be selected. […] verify that sending justified messages with images/attachments works properly, including the recipient selection, upload, sending, delivery, and display of the images."

**The verdict: the reported bug is fixed (a real, two-part state-machine defect in the DM picker), the fix is red-then-green pinned, and the entire send pipeline — recipient selection → upload → sending → delivery → display — is LIVE-verified with a real image, byte-identical, zero probe residue.**

## The two zips

| Zip | Contents | Verified state |
|---|---|---|
| `AgentGithubUplaod-T488.zip` | The hub repository (desktop + backend + docs) at `684e80e` | The unified battery GREEN (typecheck 0 · vitest **4,787/0/5 BASELINE-MATCHED** · the equivalence layers) · the new suite 8/8 · the LIVE E2E **26/26** |
| `elimtiyaz-android-T488-session.zip` | The Android repository at `75377c7` | Unchanged this session (the T-476 ADR-033-aligned state; the DM creation surface is desktop-only by ADR-008); delivered per the "zip all the systems" mandate |

## What was wrong (CHAT-303 — two coupled defects, same error string)

1. **The append-toggle on radio inputs** — the "Nouveau canal" direct-DM picker rendered radio inputs driven by an append-only toggle: changing your mind about the recipient left BOTH rows checked with TWO ids in the selection, and the submit rejected with "Un message direct nécessite exactement 1 destinataire." — **while you visibly had a recipient selected** (the exact report). Switching the type group→direct with members already picked hit the same rejection. The radios also carried no `name` attribute, so the browser's own mutual exclusion never engaged.
2. **The unexplained empty picker** — the picker only lists staff whose personnel record carries a BOUND account; the live tenant has ZERO such bindings (18 personnel rows, 0 `user_id`), so the picker rendered a bare empty box — no hint, no path to fix it — and the submit surfaced the same opaque error.

The repository/RPC path was sound all along (the t-099 suite pins it; untouched by this fix).

## The fix (`elimtiyaz-desktop/src/features/personnel/management/chat-panel.tsx`)

- **Replace-on-select radio semantics** for the direct type (a pick REPLACES the selection, never appends; re-picking the selected one keeps it).
- **The type-switch trim** — switching into "Message direct" trims a carried-over group selection to one.
- **A real radio group** — the radios share `name="chat-dm-recipient"` (the browser's mutual exclusion + the accessibility tree).
- **The honest empty picker** — "Aucun collaborateur n'a de compte de messagerie rattaché. Créez un compte lié à un employé (Réglages → Comptes) pour pouvoir lui écrire."
- **The self-DM honest guard** — DM-ing your own record now toasts "Vous ne pouvez pas ouvrir un message direct avec vous-même." instead of the opaque validation error.
- **The optional DM name** — a DM's display name defaults to the recipient's own name (no cosmetic-only required field left in the flow).

## What was verified

1. **The red-then-green suite** (`src/tests/features/t-488-chat-dm-recipient-selection.test.tsx`, 8 tests): PRE-FIX it reproduced the reported bug exactly ("expected 2 to be 1" — two radios checked); POST-FIX 8/8 green, with the two preserved deep-link contracts (CHAT-302/T-480) pinned alongside.
2. **No regressions**: t-480 6/6 · t-485 6/6 · t-099 13/13 unchanged-green; tsc 0 errors; eslint 0 errors on the changed files; the FULL unified battery **4,787/0/5 BASELINE-MATCHED** (the baseline moved in the same commit).
3. **The LIVE E2E** (`elimtiyaz-desktop/scripts/t488-dm-e2e.py`, **26/26 GREEN**, re-runnable): two run-unique FAKE-marked staff accounts provisioned through the app's OWN flow (the create-user-account EF with the employee binding) → the canonical `create_direct_channel` RPC (the channel shape, the internal scope, IDEMPOTENCE, and both negative controls — the unbound target and the self-DM rejected) → **a real PNG uploaded** through the member-scoped storage policies → the message sent with the attachments metadata → **delivered** to the recipient under RLS (body + metadata intact) → the read receipt → **displayed** via the signed-URL fetch with **byte-identical** bytes → the NON-member denied → **zero residue** (verified independently: DB + storage + auth users all clean).

Full evidence: `docs/recovery/t-488-live-verification.md` (in the hub zip).

## The honest residual — a DATA step, not a code step

The live tenant still has **ZERO real staff accounts bound to personnel records** (the FAKE-probe hygiene of T-486 archived the bound-era rows). The DM **code path** is fully verified, but to actually exchange DMs between real staff, the accounts must be provisioned: **Settings → Comptes → "Créer un compte" with the employee picker** (the T-371 flow). The fixed picker then shows exactly those bound staff — and until then it says so instead of failing silently.

## The repository state

ONE authoritative `main` branch (the task branch `fix/t488-chat-dm-recipient-selection` deleted after the ADR-028 rule-2 containment census — `merge-base --is-ancestor` yes, `rev-list --count main..<branch>` = 0; every commit remains reachable from main). The concurrent agent's note: any local branch can still push (a deleted remote ref is recreated harmlessly).

## How to run the app from the zip

See the hub zip's `AGENTS.md` §11 (desktop: `cd elimtiyaz-desktop && npm install && npm run dev` / the packaged build via `build-windows.sh`; the backend is the live Supabase project).
