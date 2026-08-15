# 17 — Comparisons

Side-by-side decision tables for quick stakeholder reference. Most of this content consolidates matrices documented in detail in other notes (02, 05, 07, 11).

---

## Desktop vs. Mobile Capabilities

Both Desktop and Staff Android App have **100% data read parity**. The differences are operational — they reflect which tool is the better fit for a given task, not which tool *can* do it.

| Operation | Desktop | Mobile |
| :--- | :--- | :--- |
| View any profile | Yes | Yes |
| Counter payments | Yes | Yes |
| Take attendance | Yes | **Primary** |
| Submit / approve expense | Yes | Yes |
| Capture check scan | File upload | **Camera native** |
| Edit visual DAG workflow | **Yes** | No |
| Import `.xlsx` | **Yes** | No |
| Generate XLSX / CSV | **Yes** | No (PDF share only) |
| Generate local DB backup | **Yes** | **Prohibited** |
| Configure RBAC matrix | **Yes** | No |

> **Critical rule:** Treat "No" on Mobile as intentional design, not a bug. The three mobile-prohibited operations (local DB backup, raw `.xlsx` parsing, visual DAG canvas editing) are physically impractical on a phone or represent security risks.

---

## Cash vs. Check vs. Bank Transfer

| Aspect | Cash (Espèces) | Bank Check (Chèque) | Bank Transfer (Virement) |
| :--- | :--- | :--- | :--- |
| Verification speed | Immediate | Days (clearance) | Hours to days |
| Proof upload | No | Yes (check scan) | Yes (transfer receipt) |
| Initial status | `PAID` | `PENDING` | `PENDING` |
| Bounce risk | None | Yes (NSF) | Low |
| Required fields | Amount, date | Check #, Bank, Issue Date, Expiry Date | Transaction Ref #, Source Bank |
| Best for | Counter payments | Large installments | Remote payments |

> **Critical rule:** Never mark a Check or Bank Transfer as `PAID` on submission. Non-cash payments must start as `PENDING` until bank clearance is confirmed.

---

## Recent Receipt vs. Full Account Statement

| Aspect | Recent Payment Receipt | Full Account Statement |
| :--- | :--- | :--- |
| Scope | Single transaction | Complete financial history |
| Length | 1 page | Multiple pages |
| When generated | Auto-generated on payment entry | On-demand from Parent drawer |
| Audience | Anyone needing quick proof | Parent / accountant / auditor |
| Access control | Less sensitive | Strict — parent/authorized staff only |

> **Critical rule:** Never send the Full Account Statement to a third party without explicit parent consent. The Full Statement contains the family's complete payment history and is significantly more sensitive than a single receipt.

---

## Scolarite vs. Extracurricular Clubs

See note 05 for the full domain split. Key points:

| Aspect | Scolarite | Clubs & Therapy |
| :--- | :--- | :--- |
| Affects GPA | Yes | No |
| Affects promotion | Yes | No |
| Billing | Term / monthly installments | Flat / session-based |
| Levels | Primaire / CEM / Lycee | None (open enrollment) |

> **Critical rule:** Club/Therapy grades must never bleed into the Scolarite GPA. The `isExtracurricular` flag on each assessment record controls exclusion.

---

## Groq vs. OpenRouter

| Aspect | Groq LPU API | OpenRouter API |
| :--- | :--- | :--- |
| Role | Primary engine | Multi-model fallback gateway |
| Hardware | LPU (fast inference) | Routes to multiple providers |
| Free tier | Yes (rate-limited) | Limited free credits |
| Speed | Sub-second on common prompts | Varies by routed model |
| Best for | Real-time drafting, narrative generation | Long-context tasks, model variety |

> **Critical rule:** Never send the same prompt to both Groq and OpenRouter in parallel. This doubles cost and rate-limit pressure. Use OpenRouter only as a fallback when Groq fails or when a specific use case needs a model Groq does not offer.
