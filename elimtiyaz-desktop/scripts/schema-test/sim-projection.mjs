// Simulate the adapter's documented identity projection over the workbook:
// parent = first token of NEM (/,;) or "(inconnu)"; student = displayName exact
// then (first,last) via splitFullName; first row wins per (student, field).
import ExcelJS from "exceljs";
import fs from "node:fs";
import { splitFullName } from "/home/z/my-project/agent-repo/elimtiyaz-desktop/src/infrastructure/excel/import-engine/mappers/name-splitter.ts";

const wb = new ExcelJS.Workbook();
const b = new Uint8Array(fs.readFileSync("../Excel/2027-2026.xlsx"));
await wb.xlsx.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const ws = wb.getWorksheet("ETAT 20262027");
const headers = {};
ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = String(cell.value ?? ""); });
const colOf = (name) => Number(Object.entries(headers).find(([c, t]) => t.trim() === name)?.[0] ?? 0);
const C = { nom: 6, nem: 4, devis: colOf("DEVIS ANNUEL"), fi: colOf("FI"), v1: colOf("V1"), v2: colOf("2V"), v3: colOf("v3"), t1: colOf("1T"), t2: colOf("T2"), t3: colOf("t3") };
console.log("cols:", JSON.stringify(C));

const val = (row, col) => {
  const v = row.getCell(col).value;
  if (typeof v === "object" && v != null && "result" in v) return v.result;
  return v;
};
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

// family map: phone -> students map: displayName -> first-wins row data
const families = new Map();
const FIELD_COLS = { DEVIS_ANNUEL: C.devis, FI: C.fi, V2: C.v1, V2_ALT: C.v2, V3: C.v3, T1: C.t1, T2: C.t2, T3: C.t3 };
const sums = Object.fromEntries(Object.keys(FIELD_COLS).map((f) => [f, 0]));
let rows = 0, noNem = 0;
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const nom = String(val(row, C.nom) ?? "").trim();
  if (!nom) continue;
  rows++;
  const nemRaw = String(val(row, C.nem) ?? "").trim();
  const phone = nemRaw.split(/[/,;]/)[0]?.trim() || "(inconnu)";
  if (phone === "(inconnu)") noNem++;
  const parts = splitFullName(nom);
  // The adapter's family key: real phone → phone; placeholder → the
  // NOM-derived parent lastName (the "(inconnu)" byName branch).
  const famKey = phone !== "(inconnu)" ? `tel:${phone}` : `fam:${parts.lastName}`;
  if (!families.has(famKey)) families.set(famKey, []);
  const fam = families.get(famKey);
  const existing = fam.find((s) => s.displayName === nom) ?? fam.find((s) => s.firstName === parts.firstName && s.lastName === parts.lastName);
  if (existing) continue; // merged — first wins
  const student = { displayName: nom, firstName: parts.firstName, lastName: parts.lastName };
  fam.push(student);
  for (const [field, col] of Object.entries(FIELD_COLS)) {
    sums[field] += num(val(row, col));
  }
}
console.log("named rows:", rows, "| no-NEM rows:", noNem, "| families:", families.size);
console.log("projected sums:", JSON.stringify(sums));
