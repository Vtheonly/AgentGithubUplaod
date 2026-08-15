# 10 — Workflow Automation

The 24/7 serverless automation runtime (Supabase Edge Functions), the Desktop-only visual DAG canvas builder, trigger types, the Boolean condition evaluator, supported action outcomes, and manual one-click admin triggers.

---

## Runtime — Supabase Edge Functions

Workflow automation runs on **Supabase Edge Functions**:

- **Runtime:** Deno / TypeScript.
- **Deployment:** serverless, 24/7, auto-scaled by Supabase.
- **Cold start:** minimal (Deno isolate).
- **State:** stateless. The database is the source of truth; Edge Functions read state, execute logic, and write results.

> **Critical rule:** Never put long-running or stateful logic in an Edge Function. If a workflow needs to maintain state across executions, store that state in a database table and have the Edge Function read/write it transactionally.

---

## Visual DAG Canvas Builder (Desktop-Only)

The drag-and-drop workflow editor is **Desktop-only**. It connects Triggers, Conditions, Actions, Delays, and Transforms into a Directed Acyclic Graph (DAG).

### Node library

| Node type | Examples |
| :--- | :--- |
| **Triggers** | Payment Overdue, Student Enrolled, Payment Recorded, Schedule (Cron), Absence Limit Exceeded, Manual Run |
| **Conditions** | Debt > Threshold, Payment Method Match, Student Status Match |
| **Actions** | Send Email (Resend API), Apply Account Discount, Create Invoice, Dispatch Push Notification, Log Audit Activity |
| **Delays & Transforms** | Wait Duration, Database Query, Extract Field |

### DAG validation

The canvas enforces DAG integrity using **Kahn's algorithm** to prevent circular loops prior to deployment.

> **Critical rule:** Never port the canvas to Mobile. Touchscreen drag-and-drop on a complex node graph is ergonomically impractical. The Mobile app can list and run workflows but cannot edit them.

---

## Trigger Types

### Automated event triggers

| Type | Example |
| :--- | :--- |
| **Time-based (cron)** | "Check upcoming installment due dates every morning at 08:00 AM" |
| **State-based (DB event)** | "Student GPA calculated below passing threshold" or "Payment record updated to `UNPAID`" |

### Manual action triggers (one-click)

Single-button admin triggers executed on demand:

- "Broadcast Overdue Payment Reminders"
- "Execute Batch Year-End Promotion"
- "Lock Delinquent Accounts" (applies `FINANCIALLY_RESTRICTED` to accounts > 90 days overdue)

> **Critical rule:** Never use a manual trigger for time-sensitive automations. If a workflow must run every morning, use a cron trigger. Manual triggers are for on-demand bulk actions that an admin initiates after reviewing context.

---

## Condition Evaluator

The condition evaluator evaluates Boolean logic trees.

### Operators

`AND`, `OR`, `NOT`, `>`, `<`, `>=`, `<=`, `==`, `!=`

### Worked example

```
student.absence_count >= 3
AND
student.has_medical_certificate == false
→ send parent alert
```

> **Critical rule:** Always validate field availability before evaluating. If a condition references a field that does not exist on the entity (e.g. `student.gpa` on a parent record), the condition evaluator must return `false` and log a warning — never throw an exception that crashes the workflow.

---

## Supported Action Outcomes

| Action | Details |
| :--- | :--- |
| Dispatch automated email | Via Resend API |
| Dispatch web portal push alert | To parent / student web portal |
| Dispatch mobile staff notification | Via FCM (Firebase Cloud Messaging) |
| Adjust student account status | e.g. flag `FINANCIALLY_RESTRICTED` |
| Generate administrative task / convocation | e.g. schedule a parent meeting |
| Write structured event to System Audit Log | Mandatory companion to any mutating action |

> **Critical rule:** Never add a mutating action without also writing to the audit log. Every workflow-driven change must be auditable. A workflow that mutates data silently is a security and compliance risk.

---

## Manual One-Click Triggers

Manual triggers live as prominent buttons in the relevant Desktop Hub:

- "Execute Batch Promotion" in Hub 4 (Academic Management).
- "Broadcast Overdue Reminders" in Hub 2 (Financial Portal).
- "Lock Delinquent Accounts" in Hub 2.

They also appear as quick actions on Mobile.

> **Critical rule:** Every manual trigger must require a confirmation dialog (two clicks: initiate + confirm) to prevent accidents. A single-click bulk action is a footgun.

---

## Workflow DAG Validation Best Practices

1. Run Kahn's algorithm to verify DAG integrity (no cycles) on every canvas save — not just on publish.
2. Test against mock data before deploying to production.
3. Add a `Delay` node between aggressive actions (e.g. email bursts) to avoid rate-limiting.
4. Include an audit log write as the final action node so silent failures become visible.
5. Set a maximum execution count per day per workflow to prevent runaway loops.
6. Use `AND` conditions to prevent accidental mass-firing (require multiple conditions to be true before an action executes).
7. Provide visual feedback (red edges) in the canvas when a connection would create a cycle.
