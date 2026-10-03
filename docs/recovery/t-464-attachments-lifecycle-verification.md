# T-464 Verification — The Chat Attachments Lifecycle (Upload → Store → Send → Receive → Persist → Open → View → Download)

**Task:** T-464 · **Problem:** MEDIA-300 · **Session:** 135th (2026-10-03) · **Status:** COMPLETE — the lifecycle VERIFIED LIVE in both communication directions (11/11 live checks); the three repos' gates TESTED (the device eyeball check is owner-gated, as every UI change is).

## The mandate

The owner's issue: "fix all issues related to media/file attachments and test them thoroughly across all platforms… images and PDFs can be uploaded, stored, retrieved, displayed, and opened correctly across all supported platforms. Do not only test the upload itself. Test the complete lifecycle: Upload → Store → Send → Receive → Persist → Open → View → Download. Verify this from every relevant client and communication direction."

## What was wrong (MEDIA-300)

1. **The RLS bug:** `chat_attachments_read`/`chat_attachments_write` (migration 0018) gated on the 9-role STAFF list — a parent opening an attachment the school sent them got a storage RLS denial, and a parent could never attach a document to their own inquiry. The portal channel (ADR-012) was file-deaf end to end.
2. **No client implemented upload or rendering anywhere:** the desktop ChatPanel and both other chat clients were text-only; `sendMessage`'s attachments parameter was dead; the Android DTO never read the column and hardcoded `attachments: []`; the website inserted `attachments: []`.

## Root cause

Migration 0018 created every planned bucket, but the chat clients were built text-first (T-099/T-101/T-102) and the attachment half was never picked up. The 0018 policy author mirrored the task-attachments staff pattern without accounting for parents as legitimate chat participants — parents only became chat participants at all in 0067, nine migrations later.

## What was changed

### Backend — migration `0136_chat_attachment_storage_policies.sql` (applied live + registered, atomic)

- The 0018 staff-role-list policies RETIRED; replaced by **member-scoped** `chat_attachments_member_read` / `chat_attachments_member_write`: the object's channel folder (`folder[2]`) must be a `chat_channels` row the caller belongs to. Staff AND parent uniformly; strictly tighter for staff (channel members only, was: any staff member).
- The documented path canon: `{tenant_id}/{channel_id}/{timestamp}-{sanitized-filename}` (the T-362 `{tenant}/{entity}/{file}` canon, entity = channel).
- The bucket itself unchanged (private, 10 MB, jpeg/png/webp/pdf/xlsx/plain — 0018's limits stay the enforcement).

### Desktop (hub repo)

- `media-vault.ts`: the `MediaBucket` union extended with `chat-attachments`; the client-side limit helpers (`CHAT_ATTACHMENT_MAX_BYTES`, `CHAT_ATTACHMENT_MIME_TYPES`, `isChatAttachmentAllowed`); `freshSignedMediaUrl` gained the `download` flag (one signed-URL authority, extended — not duplicated).
- `ChatPanel` (BOTH scopes — internal and portal): the paperclip composer (validated against the bucket limits, pending chips with remove, upload-on-send with a failed-upload ABORT — the homework-push pattern), inline image previews via fresh signed URLs, document chips with open + download affordances.
- Guard-test compliance: the upload call passes an explicit `tenantId: tenantId` (the T-361 UPLOAD-102 scanner) — 5/5 t-361 tests green.

### Website (portal — the parent side)

- `MessagesView`: the parent composer gained the paperclip (upload authorized by the NEW write policy — first time a parent can attach anything to a conversation); the message bubbles render image previews inline and document chips with open/download via signed URLs; the send path uploads FIRST and aborts on failure; an attachment may stand alone as the message (no empty-body requirement then).
- The i18n dictionary gained the three `messages.attachments.*` keys in ALL THREE locales (fr/en/ar).
- The T-360 upload-path guard satisfied (the tenant-first `objectPath` construction).

### Android

- `ChatAttachment` domain model + `ChatAttachmentLimits` (the client-side gate); the DTO parses the attachments jsonb leniently (a malformed entry is skipped, never a crash); `ChatRepository.send` gained the attachments parameter (the caller uploads FIRST via the canonical `StorageRepository` — honest-failure classes, tenant-scoped paths, the unique-name prefix prevents same-name overwrites); the Room cache stores the array (`attachmentsJson`, schema **v18 → v19**, `MIGRATION_18_19`); `ChatDetailScreen` gained the paperclip (system file picker), the pending chips, inline image rendering via Coil on fresh signed URLs, and the document chip that opens the system viewer through a fresh signed URL.
- The F-19(a)/(b) token gates satisfied (no raw token-sized literals; the image height snapped to the 4dp grid).

## What was verified (all commands actually run this session)

### LIVE — the full lifecycle, both directions (`scripts/verify_t464_lifecycle.py`, 11/11 green)

A real test parent (created via the admin API, the 0002 auto-profile activated, the parent role assigned) against the real administrator, on the live project:

- **staff → parent:** the parent opened the admin channel (`open_parent_admin_channel`, scope='portal' — the 0135 derivation live); the ADMIN uploaded a PNG into `{tenant}/{channel}/…`; inserted the message with the metadata; the PARENT's RLS select returned the message + metadata; the PARENT's JWT minted a signed URL; the download returned the EXACT bytes (66B = 66B).
- **parent → staff:** the PARENT uploaded a PDF under their own JWT (**the new write policy — the OLD 0018 policy DENIED exactly this**); inserted the message; the staff side received both messages; the 0061 touch trigger moved the channel's last-message columns; the scope stayed 'portal' end to end.
- Cleanup: messages, channel, both objects, and the test user removed (zero residue).

### The repos' gates

- **Desktop:** `npm run typecheck` 0 errors; `npx eslint` on the changed files 0 errors; the FULL vitest run **4,604 passed / 17 failed / 5 skipped (4,626)** — the failing-file set byte-identical to the documented baseline (BASELINE-MATCHED); the t-361 guard 5/5 (the new call site passes the tenant-variable scan).
- **Website:** `npm run lint` 0 errors 0 warnings; `npm test` **657/657**; `npm run build` green.
- **Android:** `./gradlew compileDebugKotlin` BUILD SUCCESSFUL; `./gradlew testDebugUnitTest` **709 tests, 0 failed, 1 skipped** (+6: 4 attachment DTO/limit tests + 2 Room v19 migration tests); `./gradlew lint` BUILD SUCCESSFUL.
- **Migration chain:** the append-only guard OK (131 files, +1 new in worktree); 0135 + 0136 both registered live (`schema_migrations` census).

## What remains unresolved (Left)

1. **OWNER (device smoke test):** eyeball the attachment flows on real screens (desktop composer + previews; the portal parent composer; the Android picker + inline images) — the code gates and the LIVE chain are green; the visual acceptance is the owner's.
2. **The upload's offline-first Android leg:** an attachment picked offline is validated but the SEND requires connectivity (chat sends are online-only by the T-102 doctrine — a queued-send architecture is explicitly out of scope, recorded in the repository interface docs).
3. **Voice notes** (`voiceNoteSeconds` on the desktop model) remain a desktop-only display artifact of the old mock — not part of this mandate.

## New discoveries documented this task

1. **The signed-URL response is relative to the STORAGE SERVICE base, not the project root** — the raw `/storage/v1/object/sign/…` response's `signedURL` value must be prefixed with `/storage/v1` when constructing the download URL by hand (the JS/Kotlin clients do this internally; a hand-rolled URL 404s with `{"error":"requested path is invalid"}`). Recorded here because every future raw-REST verify script hits it.
2. **The T-361 UPLOAD-102 guard requires an EXPLICIT `tenantId: <variable>` at every `uploadPrivateMedia` call site** — the ES6 shorthand (`tenantId,`) does not match its scanner even though it is semantically identical. Recorded in the call-site comment.
3. **The F-19(a)/(b) spacing token gates apply to icon-size and image-dimension literals too** (`Modifier.size(16.dp)` → `ElTheme.spacing.lg`; a 150.dp image height is off-grid — snapped to 152). The gates are the reason the first Android run failed; the fix is the token, not a suppression.
