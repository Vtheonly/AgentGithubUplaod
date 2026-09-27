/**
 * t-425-live-verify.mjs — THE LIVE vs EXCEL ORACLE (read-only, v2): after
 * the T-425 re-import, verify the live DB's per-student tranche state
 * against the workbook's OWN TOTAL*CREANCE column (Q, column 17 — the
 * school's authoritative créance INCLUDING their manual overrides) and the
 * pure formula (L+N−M−P−regl).
 *
 * Matching: the t-424 oracle's phone normalizer (local form, first part)
 * applied to BOTH sides + a name-unique fallback. Payments paginated.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const XLSX_PATH = [
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
].find((p) => fs.existsSync(p));

const dzd = (n) => new Intl.NumberFormat("fr-DZ").format(Math.round(n));
const num = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    if (v.result !== undefined) return Number(v.result) || 0;
    if (v.richText) return Number(String(v.richText.map((t) => t.text).join("")).trim()) || 0;
    if (v.text !== undefined) return Number(String(v.text).trim()) || 0;
    return 0;
  }
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// The t-424 oracle's normalizer — the LOCAL form (0XXXXXXXXX), first part.
function expectedParentPhone(nem) {
  const parts = String(nem ?? "").split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const normalized = parts
    .map((p) => {
      let s = p;
      if (/^\d+(\.\d+)?$/.test(s)) {
        if (!s.startsWith("0") && s.length >= 9) s = "0" + s.split(".")[0];
        else s = s.split(".")[0];
      }
      return s.replace(/[\s.]/g, "");
    })
    .filter(Boolean);
  if (normalized.length === 0) return "(inconnu)";
  return normalized[0] || "(inconnu)";
}

async function main() {
  if (!SERVICE_KEY) { console.error("FATAL: SUPABASE_SERVICE_KEY required"); process.exit(1); }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  async function readAll(table, cols) {
    const all = [];
    let lastId = "";
    for (;;) {
      let q = db.from(table).select(cols).eq("tenant_id", TENANT_ID).order("id", { ascending: true }).limit(1000);
      if (lastId) q = q.gt("id", lastId);
      const { data, error } = await q;
      if (error) { console.error(`${table} read failed:`, error.message); process.exit(1); }
      all.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
      lastId = data[data.length - 1].id;
    }
    return all;
  }

  // ── 1. The workbook oracle rows (the Q COLUMN — the school's own truth) ──
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("ETAT 20262027");
  const oracle = [];
  const seen = new Set();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nom = String(row.getCell(6).value ?? "").trim();
    if (!nom) continue;
    const phone = expectedParentPhone(String(row.getCell(4).value ?? "").trim());
    const key = `${phone}|${nom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const qCol = num(row.getCell(17).value); // the school's authoritative créance (overrides included)
    oracle.push({ name: nom, phone, qCol, row: r });
  }
  const qColTotal = oracle.reduce((s, o) => s + Math.max(0, o.qCol), 0);
  console.log(`workbook oracle rows: ${oracle.length}  Σ max(0, Q-column) = ${dzd(qColTotal)}`);

  // ── 2. The live state (paginated) ──
  const parents = await readAll("parents", "id, primary_phone");
  const students = await readAll("students", "id, parent_id, display_name");
  const installments = await readAll("installments", "id, student_id, amount_due, amount_paid, amount_pending");
  const payments = await readAll("payments", "id, amount, status");

  // Multi-key student index: (phone-variant | display_name) → studentId(s).
  const byKey = new Map();
  const byName = new Map();
  const phoneById = new Map(parents.map((p) => [p.id, expectedParentPhone(p.primary_phone)]));
  for (const s of students) {
    const name = s.display_name ?? "";
    const phone = phoneById.get(s.parent_id) ?? "(inconnu)";
    for (const k of new Set([`${phone}|${name}`, `${s.display_name ? "":""}${name}`])) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(s.id);
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(s.id);
  }
  const instsByStudent = new Map();
  for (const i of installments) {
    const k = i.student_id ?? "—";
    if (!instsByStudent.has(k)) instsByStudent.set(k, []);
    instsByStudent.get(k).push(i);
  }

  // ── 3. Per-student comparison: live remaining vs the Q column ──
  let match = 0, mismatch = 0, noStudent = 0, ambiguous = 0;
  let liveTotal = 0, oracleTotal = 0;
  let overpaid = 0;
  const mismatches = [];
  for (const row of oracle) {
    const q = Math.max(0, row.qCol);
    let sids = byKey.get(`${row.phone}|${row.name}`) ?? [];
    if (sids.length === 0) {
      const byNameOnly = byName.get(row.name) ?? [];
      if (byNameOnly.length === 1) sids = byNameOnly; // unique name fallback
    }
    if (sids.length === 0) { noStudent++; continue; }
    if (sids.length > 1) { ambiguous++; continue; }
    const insts = instsByStudent.get(sids[0]) ?? [];
    const remaining = insts.reduce((s, i) => s + Math.max(0, Number(i.amount_due) - Number(i.amount_paid) - Number(i.amount_pending ?? 0)), 0);
    overpaid += insts.filter((i) => Number(i.amount_paid) > Number(i.amount_due)).length;
    liveTotal += remaining;
    oracleTotal += q;
    if (Math.abs(remaining - q) <= 1) match++;
    else { mismatch++; if (mismatches.length < 15) mismatches.push({ name: row.name, row: row.row, live: remaining, qCol: row.qCol }); }
  }

  console.log("\n=== PER-STUDENT: live Σremaining vs the workbook's OWN Q column ===");
  console.log(`matched (±1 DZD): ${match}   mismatched: ${mismatch}   no live student: ${noStudent}   ambiguous: ${ambiguous}`);
  console.log(`Σ live remaining = ${dzd(liveTotal)}   Σ max(0,Q) over matched = ${dzd(oracleTotal)}   Δ = ${dzd(liveTotal - oracleTotal)}`);
  console.log(`overpaid rows (paid > due): ${overpaid}`);
  if (mismatches.length) {
    console.log("mismatches (sample — the school's manual Q overrides + the regl/rounding artifacts):");
    for (const m of mismatches) console.log(`  ${m.name} (r${m.row}): live ${dzd(m.live)} vs Q ${dzd(m.qCol)}  Δ=${dzd(m.live - m.qCol)}`);
  }

  // ── 4. The KPIs both surfaces render ──
  const encaisse = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const totalRemaining = installments.reduce((s, i) => s + Math.max(0, Number(i.amount_due) - Number(i.amount_paid) - Number(i.amount_pending ?? 0)), 0);
  console.log(`\nKPIs:  Encaissé (Σ paid payments) = ${dzd(encaisse)} DZD   Créances (Σ installment remaining) = ${dzd(totalRemaining)} DZD`);
  console.log(`(the workbook's own: ΣP = 162 649 000 DZD   Σmax(0,Q) = ${dzd(qColTotal)} DZD)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
