/**
 * Personnel payslip PDF generator (fiche de paie).
 *
 * Iteration 9 — entity-specific reports (spec §5.2).
 *
 * Per spec:
 *   - Bulletins trimestriels → generated in StudentDetailDrawer
 *   - Relevé de compte      → generated in ParentDetailDrawer
 *   - Fiche de paie         → generated in PersonnelDetailDrawer
 *
 * These functions are kept here because they share the same PDF rendering
 * primitives (drawHeader, drawBox, drawKeyValue, etc.).
 *
 * Uses pdf-lib (MIT, no native deps, runs in browser + Node).
 *
 * T-368 (67th session, REPT-500/502): amounts render via `dzdPdf` — the
 * old path piped `formatDzdPlain` output through sanitizePdfText, turning
 * the U+202F grouping separator into literal "?" glyphs ("65?000 DZD" on
 * every payslip); label lookups are null-safe; footers carry the true page
 * count. The net-pay row remains the honest gross-to-net identity the
 * domain provides (no deduction engine exists — see unknowns; never
 * invented here).
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Personnel } from "../../domain/model/personnel";
import { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } from "../../domain/model/personnel";
import {
  PAGE_H,
  MARGIN,
  CONTENT_W,
  PAGE_BOTTOM_LIMIT,
  BORDER,
  BRAND_BLUE_DEEP,
  TEXT_PRIMARY,
  TEXT_MUTED,
  PRIMARY_BG,
  dzdPdf,
  sanitizePdfText,
  drawHeader,
  drawKeyValue,
  drawBox,
  stampPageFooters,
} from "./shared";

/**
 * Generate a personnel payslip PDF (fiche de paie).
 *
 * Iteration 9 — spec §5.2: this PDF is generated exclusively inside the
 * PersonnelDetailDrawer, NOT from the global Reports tab.
 */
export async function generatePayslipPdf(
  personnel: Pick<Personnel, "firstName" | "lastName" | "id" | "staffCategory" | "position" | "hireDate" | "salary" | "weeklyHoursTarget" | "weeklyHoursLogged" | "status" | "email" | "phone">,
  period: string = new Date().toISOString().slice(0, 7),
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const title = "FICHE DE PAIE";
  const page = drawHeader(doc, font, title);

  let y = PAGE_H - 130;

  // Identity box
  drawBox(page, MARGIN, y - 60, CONTENT_W, 60, undefined, BORDER);
  drawKeyValue(page, font, MARGIN + 15, y - 18, "Employé:", `${personnel.firstName} ${personnel.lastName}`);
  drawKeyValue(page, font, MARGIN + 15, y - 36, "Matricule:", personnel.id);
  drawKeyValue(page, font, MARGIN + 280, y - 18, "Catégorie:", STAFF_CATEGORY_LABELS_FR[personnel.staffCategory] ?? "—");
  drawKeyValue(page, font, MARGIN + 280, y - 36, "Poste:", personnel.position ?? "—");
  drawKeyValue(page, font, MARGIN + 440, y - 18, "Période:", period);
  drawKeyValue(page, font, MARGIN + 440, y - 36, "Statut:", PERSONNEL_STATUS_LABELS_FR[personnel.status] ?? "—");

  y -= 90;

  // Salary details
  page.drawText(sanitizePdfText("Détails de la rémunération"), { x: MARGIN, y, size: 14, font: fontBold, color: TEXT_PRIMARY });
  y -= 22;

  const salary = personnel.salary ?? 0;
  const hourlyRate = personnel.weeklyHoursTarget > 0 ? salary / (personnel.weeklyHoursTarget * 4.33) : 0;
  const hoursWorked = personnel.weeklyHoursLogged * 4.33; // monthly equivalent
  const hoursTarget = personnel.weeklyHoursTarget * 4.33;

  const rows: Array<[string, string]> = [
    [sanitizePdfText("Salaire mensuel brut"), `${dzdPdf(salary)} DZD`],
    [sanitizePdfText("Heures hebdo. cibles"), `${personnel.weeklyHoursTarget} h`],
    [sanitizePdfText("Heures hebdo. effectuées"), `${personnel.weeklyHoursLogged} h`],
    [sanitizePdfText("Heures mensuelles cibles"), `${hoursTarget.toFixed(1)} h`],
    [sanitizePdfText("Heures mensuelles effectuées"), `${hoursWorked.toFixed(1)} h`],
    [sanitizePdfText("Taux horaire estimé"), `${dzdPdf(Math.round(hourlyRate))} DZD/h`],
    [sanitizePdfText("Date d'embauche"), personnel.hireDate],
  ];

  for (const [labelText, value] of rows) {
    if (y - 18 < PAGE_BOTTOM_LIMIT) break; // 7 fixed rows never overflow; guard stays defensive
    drawBox(page, MARGIN, y - 18, CONTENT_W, 18, undefined, BORDER);
    page.drawText(labelText, { x: MARGIN + 15, y: y - 13, size: 10, font, color: TEXT_PRIMARY });
    page.drawText(sanitizePdfText(value), { x: MARGIN + 460, y: y - 13, size: 10, font: fontBold, color: TEXT_PRIMARY });
    y -= 18;
  }

  y -= 20;
  // Total
  drawBox(page, MARGIN, y - 30, CONTENT_W, 30, PRIMARY_BG, BORDER);
  page.drawText(sanitizePdfText("Net à payer"), { x: MARGIN + 15, y: y - 20, size: 12, font: fontBold, color: TEXT_PRIMARY });
  page.drawText(sanitizePdfText(`${dzdPdf(salary)} DZD`), { x: MARGIN + 460, y: y - 20, size: 16, font: fontBold, color: BRAND_BLUE_DEEP });

  page.drawText(sanitizePdfText("Document généré automatiquement par El-Imtiyaz Desktop Terminal — non officiel sans signature."), { x: MARGIN, y: 60, size: 8, font, color: TEXT_MUTED });

  stampPageFooters(doc, font, new Date().toISOString());

  return doc.save();
}
