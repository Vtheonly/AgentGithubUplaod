/**
 * t-425-q-column-diagnostic.mjs — READ-ONLY: pin down the workbook's OWN Q
 * (TOTAL*CREANCE, column 17) formula by comparing, per row, the cached Q
 * value against the candidate computations. Lists the divergent rows.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const XLSX_PATH = [
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
].find((p) => fs.existsSync(p));

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

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("ETAT 20262027");
  let n = 0;
  let qColTotal = 0, pColTotal = 0, computedPTotal = 0, ancTotal = 0;
  const diffs = [];
  const seen = new Set();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nom = String(row.getCell(6).value ?? "").trim();
    if (!nom) continue;
    const phoneRaw = String(row.getCell(4).value ?? "").trim();
    const key = `${phoneRaw}|${nom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const qCol = num(row.getCell(17).value);
    const pCol = num(row.getCell(16).value);
    const devis = num(row.getCell(12).value), dettes = num(row.getCell(14).value), remb = num(row.getCell(13).value);
    const pComputed =
      num(row.getCell(18).value) + num(row.getCell(19).value) + num(row.getCell(20).value) + num(row.getCell(21).value) +
      num(row.getCell(23).value) + num(row.getCell(24).value) + num(row.getCell(25).value);
    const anc = [44, 45, 46, 47].reduce((s, c) => s + num(row.getCell(c).value), 0);
    const qFromP = devis + dettes - remb - pCol;
    n++;
    qColTotal += Math.max(0, qCol);
    pColTotal += pCol;
    computedPTotal += pComputed;
    ancTotal += anc;
    if (Math.abs(qCol - qFromP) > 1 && diffs.length < 12) {
      diffs.push({ r, nom, qCol, pCol, pComputed, devis, dettes, remb, qFromP, anc });
    }
  }
  console.log(`rows: ${n}`);
  console.log(`Σ P-column(16) cached        = ${Math.round(pColTotal).toLocaleString("fr-DZ")}`);
  console.log(`Σ P computed (R+S+T+U+W+X+Y) = ${Math.round(computedPTotal).toLocaleString("fr-DZ")}`);
  console.log(`Σ ancillary (44-47)          = ${Math.round(ancTotal).toLocaleString("fr-DZ")}`);
  console.log(`Σ max(0, Q-column cached)    = ${Math.round(qColTotal).toLocaleString("fr-DZ")}`);
  console.log("\nrows where Q-column ≠ (L+N−M−P-column):");
  for (const d of diffs) console.log(JSON.stringify(d));
}
main().catch((e) => { console.error(e); process.exit(1); });
