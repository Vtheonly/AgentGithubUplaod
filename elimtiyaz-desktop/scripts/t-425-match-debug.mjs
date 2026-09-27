/**
 * t-425-match-debug.mjs — READ-ONLY diagnostic: (1) the workbook's OWN Q
 * column (17) cached values vs the two computations (with/without the
 * ancillary subtraction), (2) live student/parent key samples vs the
 * workbook keys (why did the name|phone matching fail?).
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

const num = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v.result !== undefined) return Number(v.result) || 0;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
function expectedParentPhone(raw) {
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^0\d/.test(p)) p = "+213" + p.slice(1);
  return p;
}

async function main() {
  // ── 1. The workbook's own Q column ──
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("ETAT 20262027");
  let qColSum = 0, qWithAncSum = 0, qNoAncSum = 0, n = 0;
  const seen = new Set();
  const wbKeys = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nom = String(row.getCell(6).value ?? "").trim();
    if (!nom) continue;
    const phone = expectedParentPhone(String(row.getCell(4).value ?? "").trim());
    const key = `${phone}|${nom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (wbKeys.length < 8) wbKeys.push(key);
    const payments =
      num(row.getCell(18).value) + num(row.getCell(19).value) + num(row.getCell(20).value) + num(row.getCell(21).value) +
      num(row.getCell(23).value) + num(row.getCell(24).value) + num(row.getCell(25).value) + num(row.getCell(15).value);
    const ancillary = [44, 45, 46, 47].reduce((s, c) => s + num(row.getCell(c).value), 0);
    const devis = num(row.getCell(12).value), dettes = num(row.getCell(14).value), remb = num(row.getCell(13).value);
    const qRawNoAnc = devis + dettes - remb - payments;
    const qRawAnc = qRawNoAnc - ancillary;
    const qCol = num(row.getCell(17).value);
    qColSum += Math.max(0, qCol);
    qWithAncSum += Math.max(0, qRawAnc);
    qNoAncSum += Math.max(0, qRawNoAnc);
    n++;
  }
  console.log(`rows: ${n}`);
  console.log(`Σ max(0, Q-column-17 cached)          = ${Math.round(qColSum).toLocaleString("fr-DZ")}`);
  console.log(`Σ max(0, computed WITHOUT ancillary)  = ${Math.round(qNoAncSum).toLocaleString("fr-DZ")}`);
  console.log(`Σ max(0, computed WITH ancillary)     = ${Math.round(qWithAncSum).toLocaleString("fr-DZ")}`);
  console.log("workbook keys (samples):", JSON.stringify(wbKeys, null, 2));

  // ── 2. Live keys ──
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: parents } = await db.from("parents").select("id, primary_phone").eq("tenant_id", TENANT_ID).limit(2000);
  const { data: students } = await db.from("students").select("id, parent_id, display_name, first_name, last_name").eq("tenant_id", TENANT_ID).limit(2000);
  const phoneById = new Map((parents ?? []).map((p) => [p.id, p.primary_phone]));
  const liveKeys = (students ?? []).slice(0, 8).map((s) => ({
    key: `${phoneById.get(s.parent_id)}|${s.display_name ?? ""}`,
    phone: phoneById.get(s.parent_id),
    display: s.display_name,
    firstLast: `${s.first_name} ${s.last_name}`,
  }));
  console.log("live keys (samples):", JSON.stringify(liveKeys, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
