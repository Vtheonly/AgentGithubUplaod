# T-488 — Live Verification Record (the Staff DM recipient-selection fix + the image-attachment round-trip: CHAT-303)

**Session:** 144th (2026-10-04) · **Task:** T-488 (CHAT-303) · **Live project:** `vebfehrpzajhstyhinnw` (eu-west-1)
**Harness:** `elimtiyaz-desktop/scripts/t488-dm-e2e.py` (the t-371/t-485 conventions: run-unique FAKE-marked probes, the app's OWN sanctioned account-provisioning flow, honest PASS/FAIL checks, zero-residue cleanup)
**Final verdict:** **26/26 GREEN** — with zero probe residue (DB + storage) after the cleanup.

## 1. The reported bug and its root cause

The owner's report: *"The in-between messaging/DM functionality in the Staff section is not working. It says that at least one recipient is required, even when a recipient should already be selected."*

Two coupled defects in `chat-panel.tsx`'s "Nouveau canal" modal (both producing the SAME error string, "Un message direct nécessite exactement 1 destinataire."):

1. **The append-toggle on radio inputs** — `toggleMember()` added the clicked id to `form.memberIds` regardless of the channel type. The direct-type picker rendered `<input type="radio">` WITHOUT a `name` attribute (each radio its own browser group), so a change of recipient left BOTH radios checked and `memberIds` holding TWO ids — the submit then rejected with the recipient-required error **while the user visibly HAD a recipient selected**. The `group→direct` type switch kept every picked member, hitting the same rejection.
2. **The unexplained empty picker** — the selectable set (`personnel.userId !== null && ≠ the session`) was EMPTY on the live DB (census at registration: 18 personnel rows, **ZERO `user_id` bindings**; only the admin + 2 probe parents hold profiles), rendered as a bare bordered box with no hint and no pointer to the account-binding flow.

The repository/RPC path (`SupabaseChatRepository.createChannel` → `translateToProfileIds` → the canonical `create_direct_channel` RPC, 0105) is sound — pinned by the t-099 suite, byte-untouched by this fix.

## 2. The fix (commit `d7569e0`, merged to main as `d033214`)

All in `chat-panel.tsx` (the modal's selection state machine — minimal blast radius):

| Change | What it does |
|---|---|
| `toggleMember` radio semantics | For `type === "direct"`, a pick **REPLACES** the selection (`memberIds = [id]`); re-picking the selected one keeps it (radio deselect is impossible by design). The group/department/announcement checkbox semantics are unchanged. |
| The type-switch trim | Switching the Select INTO `direct` trims a carried-over group selection to its first member — the exactly-one contract holds at every entry point. |
| `name="chat-dm-recipient"` | The radios form a real browser radio group (mutual exclusion + the a11y tree finally match the semantics). |
| The honest empty picker | `selectablePersonnel` extracted to a `useMemo`; when empty the field renders: "Aucun collaborateur n'a de compte de messagerie rattaché. Créez un compte lié à un employé (Réglages → Comptes) pour pouvoir lui écrire." (the CHAT-302 wording pattern + the pointer to the T-371 binding flow). |
| The self-DM honest guard | The deep link to one's OWN personnel record now toasts "Vous ne pouvez pas ouvrir un message direct avec vous-même." instead of dying in the repository's opaque `others.length !== 1` validation (the same "1 destinataire" string the reported bug carried). |
| The optional DM name | A DM's display name defaults to the recipient's own name (the deep-link shape; the RPC already coalesces) — no cosmetic-only required field left in the DM flow. |

## 3. The red-then-green behavioural evidence (`t-488-chat-dm-recipient-selection.test.tsx`, 8 tests)

PRE-FIX (the exact reproduction): S1 failed as *"the second pick must REPLACE the first (radio semantics), not append: expected 2 to be 1"* — two radios checked after the change of recipient, exactly the owner's report. S1-source-guard, S2 (the type-switch trim), S4 (the self-DM toast), S6 (the empty-picker state), S6-source-guard (the radio name) all red; S3/S5 (the preserved CHAT-302/T-480 deep-link contracts) green — the bug was isolated to the modal's state machine.

POST-FIX: **8/8 green.** The regression blast radius: t-480 (6/6), t-485 (6/6), t-099 (13/13) unchanged-green; `tsc --noEmit` 0 errors; eslint 0 errors on the changed files (1 pre-existing warning — the deep-link effect's `session` dep, byte-identical before/after, verified via git stash); the FULL unified battery **4,787/0/5 BASELINE-MATCHED** (281 files; the baseline moved to the new count in the SAME commit, §15.84c — supersedes T-487's 4,779/0/5).

## 4. The live E2E (26/26 GREEN, run `1791119068`)

The full owner mandate — *"the recipient selection, upload, sending, delivery, and display of the images"* — executed against the live project through the REAL stack (GoTrue + PostgREST + RLS + the RPC + Storage), every probe FAKE-marked and run-unique (§15.50), zero real-row exposure (§15.38):

| Phase | What was verified | Result |
|---|---|---|
| A | The owner-pinned admin sign-in + tenant resolution | PASS ×2 |
| B | Two probe employee rows created (the DM-able precondition the live DB had LOST — zero bound staff) | PASS |
| C | The app's OWN provisioning: the `create-user-account` EF ×2 with `personnel_id` (the AccountsTab call) — both `personnel.user_id` bindings landed | PASS ×3 |
| D | **The DM creation** — probe A → the canonical `create_direct_channel` RPC → probe B: the channel shape (direct, both members, the deterministic `DM-…` code), the 0135 scope trigger deriving `internal` (both members staff), the IDEMPOTENT re-open returning the same channel, and the two negative controls (the unbound-target rejection 400/22023, the self-DM rejection 400/22023 — the exact edges the fixed UI now guards honestly) | PASS ×7 |
| E | **The image lifecycle's first half** — the real PNG (8×8, valid CRCs) uploaded to `chat-attachments` under the canonical `{tenant}/{channel}/{file}` path with A's JWT (the 0136 member-scoped write policy), then the message insert with the attachments jsonb (the repository's `sendMessage` shape) | PASS ×2 |
| F | **Delivery** — probe B reads the channel through PostgREST under RLS: the message AND the attachment metadata (file_name / storage_path / mime_type / size_bytes) arrive intact; the author's own read-receipt seeded | PASS ×4 |
| G | **The read receipt** — B's append-only `read_by` update accepted (the 0051 guard contract); both members carry receipts | PASS ×2 |
| H | **Display** — B mints the signed URL (the exact API `freshSignedMediaUrl` drives; the 0136 member-read policy) and fetches it: the bytes are **IDENTICAL** to the upload (74/74); the NON-member (the admin, not in the probe DM) is DENIED the mint — the member scoping enforced | PASS ×4 |
| I | **The cleanup** — messages, channel, personnel, profiles, auth users, the storage object: zero residue (verified independently post-run: `auth_users=0, profiles=0, personnel=0, channels=0, messages=0`, the bucket list `[]`); the append-only audit rows KEPT per §15.26 | PASS |

## 5. The state of the live system after this session (the honest operator note)

The DM **code path** is now verified end-to-end (creation → send → deliver → display, with images). But the live tenant still has **ZERO real staff accounts bound to personnel records** (the census: 18 personnel rows, 0 `user_id` — the FAKE-probe hygiene of T-486 archived the 8 bound-era rows; the admin account is not personnel-bound). Consequence for the owner: **to actually use staff↔staff DMs, create the staff accounts through Settings → Comptes (the "Créer un compte" flow with the employee picker)** — the picker in the fixed modal then shows exactly those bound staff, and the empty state now says so instead of failing silently.

## 6. Discoveries worth pinning (the §13 discipline — knowledge, not chat)

1. **The live empty-picker state is the DEFAULT experience until accounts are bound** — the modal's empty state and the CHAT-302 toast are the two honest surfaces for it; no code can conjure DM-able staff out of unbound personnel rows (the member set is profile-keyed by ADR-008/CHAT-200 design).
2. **The radio-without-name + toggle pattern is a class of bug**: any future "select exactly one" picker must implement replace-on-select semantics AND a shared `name` — the browser's mutual exclusion is part of the contract, not decoration. Pinned by the S1/S6 source guards.
3. **The E2E harness pattern for account-bound probes** (two EF-provisioned staff + the RPC + the storage round-trip) is reusable for any future chat/attachment verification — `t488-dm-e2e.py` is the template (26 checks, self-cleaning).

## 7. Status

- **CHAT-303: RESOLVED-VERIFIED** (the behavioural suite 8/8 + the live E2E 26/26 + the adjacent suites + the full battery).
- **T-488: VERIFIED** (all four phases complete: registration → red suite → fix → live E2E).
- Residuals (deliberately out of scope, registered in the task entry): none blocking. The owner-facing next step is DATA, not code: bind the real staff accounts (Settings → Comptes).
