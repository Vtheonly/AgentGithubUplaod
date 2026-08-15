# 08 — Expense Workflow

The two-tier approval lifecycle for outgoing institutional expenditures: staff request → manager authorization + disbursement → mandatory proof-of-purchase receipt upload → closed. Includes AI-powered anomaly detection.

---

## Status Lifecycle (3 Statuses, Strictly Ordered)

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌───────────────────────┐
│ PENDING_APPROVAL    │ ──► │ APPROVED_FUNDS_RELEASED  │ ──► │ SETTLED_AND_CLOSED    │
│ (staff submitted)   │     │ (manager approved)       │     │ (receipt verified)    │
└─────────────────────┘     └──────────────────────────┘     └───────────────────────┘
```

A ticket **cannot skip** from `APPROVED_FUNDS_RELEASED` to closed — the receipt upload step is mandatory. This prevents "approved but no proof" leaks.

---

## Tier 1 — Request Initiation

**Actor:** Staff Member (any role with expense-submission permission).

**Form fields:**

| Field | Notes |
| :--- | :--- |
| Expense Title | Free text |
| Description | Free text |
| Category | Controlled list — **no free-text**: Maintenance, Office Supplies, Educational Material, Utilities |
| Requested Funding Amount | DZD |
| Operational Justification | Free text |
| Urgency | Low / Medium / High |

**Submittable from:** Desktop (full form) or Staff Android App (field-optimized). Initial status: `PENDING_APPROVAL`.

---

## Tier 2 — Authorization and Disbursement

**Actor:** Admin or Financial Officer.

The approver reviews the request and any attached context (photos, vendor quotes). The approver executes `APPROVE` or `REJECT`.

### On Approve

- Status → `APPROVED_FUNDS_RELEASED`.
- Funds authorized; cash disbursed or bank transfer initiated.
- Audit log records approver identity + timestamp.

### On Reject

- Status returns to closed.
- Requester is notified with the rejection reason.
- No funds released.

> **Critical rule:** Self-approval is forbidden. The approver must be a different user from the requester. The system must enforce this at the service layer — an approver attempting to approve their own request must receive an error.

---

## Tier 3 — Proof-of-Purchase Settlement

**Actors:** Staff Member (uploads receipt) + Financial Officer (verifies).

### Workflow

1. Staff completes the field transaction.
2. Staff opens the active ticket on the Staff Android App.
3. Staff uses the **in-app camera** (CameraX) to photograph the physical vendor receipt.
4. Staff inputs the actual final spent amount.
5. Image is auto-compressed (WebP) and uploaded directly to the private Supabase storage bucket.
6. Financial Officer verifies the receipt against the disbursed amount.
7. Status → `SETTLED_AND_CLOSED`.

> **Critical rule:** Never let staff upload receipts from the phone's public photo gallery. Camera capture must write directly to the private bucket. Gallery uploads risk leaking unrelated personal photos and bypass the compression / clarity-threshold pipeline.

---

## Expense Anomaly Detection (AI-Powered)

The system scans Tier-1 requests and vendor receipt descriptions, flagging:

| Anomaly | Detection logic |
| :--- | :--- |
| **Duplicate requests** | Same vendor + same amount from different staff within ~24 hours |
| **Missing documentation** | No receipt attached or low-quality image |
| **Budget overruns** | Request exceeds ~3× the category's monthly average |
| **Vendor anomalies** | Unknown vendor with no prior payment history |

> **Critical rule:** Flags are signals for human review, **never** automatic rejections. A human financial officer always makes the final call. The AI detector reduces noise; it does not replace judgment.

### AI provider

The anomaly detector is powered by the Groq LPU API (primary) with OpenRouter as the fallback gateway. See note 11 — AI Integration.
