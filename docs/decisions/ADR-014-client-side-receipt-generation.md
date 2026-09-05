# ADR-014 — Receipts are generated client-side (no server persistence)

- **Status:** Accepted (2026-09-05, 30th session — resolves UNKNOWN-004, unblocks T-066, closes CROSS-101)
- **Context:** the `receipts` table (migration 0007) was designed to persist PDF receipts (one row per payment + account statements, `pdf_path` into the `receipts` storage bucket). Its only writer — the `collect_payment` SQL RPC — was dropped in migration 0034; the successor `collect_and_allocate_payment` allocates the receipt number ON the payments row (0058) and writes no receipts rows. The table sat orphaned with 0 rows and 0 storage objects; the website's querying hooks had zero consumers; the storage policies documented an Edge-Function writer that never existed.
- **Decision:** receipts (payment receipts AND account statements) are generated **client-side, deterministically from the canonical rows**:
  - Desktop (staff): the existing `src/infrastructure/receipt-pdf/` pdf-lib module (unchanged — remains the reference generator).
  - Website (parents): `src/lib/pdf/` ports (T-194 payment receipt, T-195 account statement) — pdf-lib, identical layout constants, WinAnsi sanitization and branding; data from the canonical `payments` / ledger-replay totals the portal already renders.
  - The orphaned `receipts` table, its storage bucket and its policies are REMOVED (hub migration 0079; the bucket via the Storage API — SQL deletion is blocked by `storage.protect_delete`).
- **Consequences:**
  - Parents can download receipts/statements at any time with **zero staff action and zero backend state** — the previous "wait for the backend to start generating rows" state was permanent (no writer existed).
  - A receipt's identifier is the payments-row receipt number (RCP-2026-XXXXX, server-allocated since 0058/ADR-004) — one number, one document, on every platform.
  - No storage costs, no upload path, no service-role writer, no RLS surface for receipt files; the PDF is a pure view of canonical data.
  - **Rejected alternative** (persist to Storage + `receipts` rows): strictly more machinery (writer EF/trigger, bucket policies, signed-URL path) to reproduce a document that is already a deterministic function of rows every client can read; it stays rejected until a business need appears (e.g. legally sealed immutable receipts) — reopen via a new ADR if so.
  - The equivalence corpus does NOT change: no financial rule moved (the statement totals are the canonical ledger-replay values passed in; T-168's reconciliation/provenance derivations are untouched).
- **Related:** UNKNOWN-004 (resolved), CROSS-101 (closed), T-066 (unblocked — no server-side model needed), ADR-004 (server-authoritative receipt numbers — still authoritative, unchanged), migrations 0007/0034/0058/0079.
