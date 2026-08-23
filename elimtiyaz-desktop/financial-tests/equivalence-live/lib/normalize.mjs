// ============================================================================
// lib/normalize.mjs — State normalization + centime-exact deep comparison.
// ----------------------------------------------------------------------------
// The suite never compares raw rows: UUIDs and timestamps differ by design.
// Normalization maps scope-specific identifiers to stable labels and drops
// non-semantic fields; amounts are compared EXACTLY (centime precision),
// mirroring the comparison philosophy of financial-tests/equivalence.
// ============================================================================

/** Normalize one scope's collected DB state into a comparable shape. */
export function normalizeScopeState(scope, state) {
  const idMap = new Map();
  const label = (kind, id) => {
    if (id == null) return null;
    const key = `${kind}:${id}`;
    if (!idMap.has(key)) idMap.set(key, `${kind}#${idMap.size + 1}`);
    return idMap.get(key);
  };

  const parent = state.parent ? {
    label: label("parent", state.parent.id),
    parentCode: state.parent.parent_code,
    displayName: state.parent.display_name,
    primaryPhone: state.parent.primary_phone,
    firstName: state.parent.first_name,
    lastName: state.parent.last_name,
    isActive: state.parent.is_active,
  } : null;

  const student = state.student ? {
    label: label("student", state.student.id),
    parentLabel: label("parent", state.student.parent_id),
    studentCode: state.student.student_code,
    displayName: state.student.display_name,
    gradeLevelCode: state.student.grade_level_code,
    paymentPlan: state.student.payment_plan,
    enrollmentStatus: state.student.enrollment_status,
    isActive: state.student.is_active,
  } : null;

  const ledger = (state.ledger || [])
    .map((e) => ({
      parentLabel: label("parent", e.parent_id),
      studentLabel: label("student", e.student_id),
      entryType: e.entry_type,
      category: e.category,
      amount: round2(e.amount),
      sourceType: e.source_type,
      sourceIdTail: tail(e.source_id),
      paymentStatus: e.payment_status,
      method: e.method,
      accountIdShape: accountShape(e.account_id),
    }))
    .sort(by(
      (e) => e.category,
      (e) => e.entryType,
      (e) => e.amount,
      (e) => e.sourceIdTail,
    ));

  const payments = (state.payments || [])
    .map((p) => ({
      studentLabel: label("student", p.student_id),
      parentLabel: label("parent", p.parent_id),
      amount: round2(p.amount),
      method: p.method,
      category: p.category,
      status: p.status,
      receiptShape: receiptShape(p.receipt_number),
    }))
    .sort(by((p) => p.category, (p) => p.amount, (p) => p.method));

  const installments = (state.installments || [])
    .map((i) => ({
      studentLabel: label("student", i.student_id),
      parentLabel: label("parent", i.parent_id),
      trancheNumber: i.tranche_number,
      category: i.category,
      amountDue: round2(i.amount_due),
      amountPaid: round2(i.amount_paid),
      amountPending: round2(i.amount_pending ?? 0),
      status: i.status,
      dueDate: i.due_date,
    }))
    .sort(by((i) => i.category, (i) => i.trancheNumber));

  // Derived financial state (recomputed, never stored — INV-1):
  const totals = {
    charged: round2(sum(ledger.filter((e) => e.entryType === "charge"), (e) => e.amount)),
    paid: round2(sum(ledger.filter((e) => e.entryType === "payment"), (e) => Math.abs(e.amount))),
    adjusted: round2(sum(ledger.filter((e) => e.entryType === "adjustment"), (e) => e.amount)),
    balance: round2(sum(ledger, (e) => e.amount)),
    paymentsTableTotal: round2(sum(payments, (p) => p.amount)),
    paymentCount: payments.length,
    ledgerCount: ledger.length,
    installmentCount: installments.length,
  };

  return { scope, parent, student, ledger, payments, installments, totals };
}

/** Deep structural comparison. Returns { equal, diffs[] }. */
export function deepCompare(a, b, path = "$") {
  const diffs = [];
  walk(a, b, path, diffs);
  return { equal: diffs.length === 0, diffs };
}

function walk(a, b, path, diffs) {
  if (a === b) return;
  if (a == null || b == null) {
    diffs.push({ path, a, b }); return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push({ path: `${path}.length`, a: a.length, b: b.length });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) walk(a[i], b[i], `${path}[${i}]`, diffs);
    return;
  }
  if (typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(a[k], b[k], `${path}.${k}`, diffs);
    return;
  }
  // numeric comparison at centime precision
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 0.005) diffs.push({ path, a, b });
    return;
  }
  diffs.push({ path, a, b });
}

// ---------- helpers ----------
function round2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function sum(arr, f) { return arr.reduce((acc, x) => acc + f(x), 0); }
function tail(s) { return s ? String(s).split(":").slice(-2).join(":") : null; }
function accountShape(acc) {
  // shape only: parent#? :category:<cat>[:student:?]
  if (!acc) return null;
  const parts = String(acc).split(":");
  return parts[0] + ":*:category:" + (parts[3] || "?") + (parts.length > 5 ? ":student:*" : "");
}
function receiptShape(r) { return r ? String(r).replace(/[-0-9a-f]{8}-[-0-9a-f]{4}-[-0-9a-f]{4}-[-0-9a-f]{4}-[-0-9a-f]{12}/gi, "UUID") : null; }
function by(...fs) {
  return (x, y) => {
    for (const f of fs) {
      const a = f(x), b = f(y);
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  };
}
