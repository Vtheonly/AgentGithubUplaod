# ADR-037 — Student import codes cannot replace another family’s child

Status: Accepted, 2026-11-28 (T-634 / BUG-082).

The canonical deterministic code contains a six-hex short hash. Server parent UUIDs participate in the hash; a finite hash is an identity candidate, not proof. A forced collision on the offline chain reproduced the canonical RPC overwriting another child’s parent/name (4/10 checks failed). The once-observed 240,000 DZD workbook gap remains an observation, not conclusively attributed forensic evidence.

The canonical `upsert_student_from_import` RPC resolves a proposed code occupied by a different parent into a deterministic salted six-hex candidate, probing until available. Competing calls for the same tenant/base code serialize inside the transaction. The code remains `ELV-YYYY-XXXXXX` for canonical inputs. Existing same-family code updates and family-scoped exact-name fallback remain unchanged; import code matching cannot implicitly transfer a child between families. Explicit student-edit operations remain the place for intentional parent changes.

The RPC signature, return shape, grants, SECURITY DEFINER/search_path and all RLS policies stay unchanged. Desktop, Android and batch-registration callers continue to call this one canonical writer; no client formula or second code allocator is added. Existing rows/codes are never rewritten. The new migration is append-only and is not applied remotely in this session.

Verification: the forced collision/re-import matrix, local full-chain census, real-workbook import/re-import and financial oracles. Packaged and production application checks remain pending; TESTED is the maximum status for this session.
