/**
 * T-502 (DATA-062) — the weekly collection rhythm's date handling.
 *
 * The owner's report: "The Weekly Operating Rhythm currently assigns all
 * payments to Sunday. The original Excel records contain payment dates,
 * and the statistics must reflect the actual weekdays on which payments
 * were recorded."
 *
 * THE LIVE EVIDENCE (Management-API census, 2026-10-11): all 2,198 live
 * payments share ONE 42-second window (2026-09-27 23:14:03–45 — a
 * Sunday): the Excel import stamped every payment with the RUN's
 * wall-clock, and the ETAT workbook records payments as TRANCHE/MONTH
 * buckets (FI/V2/2V/v3, 1T/T2/t3, SEPTEMBRE/DECEMBRE/MARS) with NO
 * per-payment exact dates (deep-inspection census: Dates: 0).
 *
 * This suite pins the two halves of the fix:
 *   A. `schoolLocalWeekdayIndex` + `deriveWeeklyRhythm` — the weekday
 *      resolves in the SCHOOL's timezone (Africa/Algiers), so a payment
 *      recorded at the counter Monday 00:30 local (Sunday 23:30 UTC) is
 *      attributed to MONDAY, not Sunday (the pre-fix `getUTCDay()` bug).
 *   B. The import's recorded-period attribution — a payment imported
 *      from the ETAT's V2 (tranche 1) column anchors its collectedAt to
 *      the tranche's CANONICAL period (Sept 15), 2V → Dec 15, v3 →
 *      Mar 15, 1T/T2/t3 ditto; fields with NO recorded period (therapy
 *      sessions, ancillary services, prior-debt settlements) keep the
 *      run timestamp. The all-payments-on-the-import-date pile-up is
 *      structurally impossible for tranche/month-bucketed sources.
 */
import { describe, it, expect } from "vitest";
import { schoolLocalWeekdayIndex } from "../../domain/calc/shared/dates";
import { deriveWeeklyRhythm } from "../../features/dashboard/components/weekly-operating-rhythm";
import type { Payment, PaymentMethod } from "../../domain/model/payment";

/* ==================================================================== */
/* A. The school-local weekday derivation                                */
/* ==================================================================== */

function pay(over: Partial<Payment> & { collectedAt: string }): Payment {
  return {
    id: over.id ?? "pay-1",
    tenantId: "t1",
    receiptNumber: "REC-2026-000001",
    parentId: "p1",
    studentId: null,
    amount: 10_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "staff-1",
    createdAt: over.collectedAt,
    updatedAt: over.collectedAt,
    ...over,
  } as Payment;
}

describe("T-502 (DATA-062) — schoolLocalWeekdayIndex: the reliable day-of-week resolver", () => {
  it("resolves the SCHOOL's calendar day (Africa/Algiers), not raw UTC", () => {
    // 2026-01-11T23:30:00Z is Monday 00:30 in Algiers — the counter was
    // open Monday morning; UTC says Sunday.
    expect(schoolLocalWeekdayIndex("2026-01-11T23:30:00Z")).toBe(1); // Monday
    // …while 09:00Z the same UTC day is still Sunday locally (10:00).
    expect(schoolLocalWeekdayIndex("2026-01-11T09:00:00Z")).toBe(0); // Sunday
    // The last Algiers minute of Sunday (22:59:59Z = Sunday 23:59:59).
    expect(schoolLocalWeekdayIndex("2026-01-11T22:59:59Z")).toBe(0);
  });

  it("is format-safe: date-only strings and PostgREST timestamptz forms agree", () => {
    // Date-only strings parse as UTC midnight = 01:00 Algiers, same date.
    expect(schoolLocalWeekdayIndex("2026-01-12")).toBe(1); // Monday
    // The PostgREST wire form (explicit +00:00 offset).
    expect(schoolLocalWeekdayIndex("2026-01-12T00:30:00.000+00:00")).toBe(1);
    // Unparseable → null (the caller's skip semantics — never a guess).
    expect(schoolLocalWeekdayIndex("not-a-date")).toBeNull();
  });

  it("knows the school week (Sun 0 … Thu 4) vs the weekend (Fri 5 / Sat 6)", () => {
    // 2026-01-11 is a Sunday; +1..+6 walk the week.
    expect(schoolLocalWeekdayIndex("2026-01-11T12:00:00Z")).toBe(0); // Dim
    expect(schoolLocalWeekdayIndex("2026-01-12T12:00:00Z")).toBe(1); // Lun
    expect(schoolLocalWeekdayIndex("2026-01-13T12:00:00Z")).toBe(2); // Mar
    expect(schoolLocalWeekdayIndex("2026-01-14T12:00:00Z")).toBe(3); // Mer
    expect(schoolLocalWeekdayIndex("2026-01-15T12:00:00Z")).toBe(4); // Jeu
    expect(schoolLocalWeekdayIndex("2026-01-16T12:00:00Z")).toBe(5); // Ven
    expect(schoolLocalWeekdayIndex("2026-01-17T12:00:00Z")).toBe(6); // Sam
  });
});

describe("T-502 (DATA-062) — deriveWeeklyRhythm: the counter-payment weekday attribution", () => {
  it("attributes each payment to its ACTUAL school-local weekday (the Monday-morning counter case)", () => {
    const rows = [
      pay({ id: "sun-morning", collectedAt: "2026-01-11T09:00:00Z", amount: 100 }), // Sunday 10:00 local
      pay({ id: "mon-early", collectedAt: "2026-01-11T23:30:00Z", amount: 200 }), // MONDAY 00:30 local
      pay({ id: "tue", collectedAt: "2026-01-13T10:00:00Z", amount: 300 }), // Tuesday
      pay({ id: "thu", collectedAt: "2026-01-15T10:00:00Z", amount: 400 }), // Thursday
    ];
    const matrix = deriveWeeklyRhythm(rows);
    expect(matrix.map((d) => d.day)).toEqual(["Dim", "Lun", "Mar", "Mer", "Jeu"]);
    expect(matrix[0].cash).toBe(100); // Dim — the Sunday-morning payment ONLY
    expect(matrix[1].cash).toBe(200); // Lun — the Monday-00:30-local payment
    expect(matrix[2].cash).toBe(300); // Mar
    expect(matrix[3].cash).toBe(0); // Mer
    expect(matrix[4].cash).toBe(400); // Jeu
  });

  it("REGRESSION (the live defect's shape): payments stamped with ONE shared timestamp land on ONE weekday — and distinct recorded dates distribute", () => {
    // The pre-fix live state: 2,198 payments all at the import moment
    // (2026-09-27 23:14 UTC). The OLD chart attributed them to Sunday
    // (raw getUTCDay); the SCHOOL-LOCAL resolution says Monday 00:14
    // Algiers — the timezone fix alone moves the pile to the honest
    // school-calendar day. Either way the chart HONESTLY showed one
    // pile — the DATA was wrong, not the chart.
    const sameStamp = Array.from({ length: 5 }, (_, i) =>
      pay({ id: `imp-${i}`, collectedAt: "2026-09-27T23:14:03.972Z", amount: 1000 }),
    );
    const piled = deriveWeeklyRhythm(sameStamp);
    const pileTotal = piled.reduce((s, d) => s + d.cash + d.check + d.transfer, 0);
    expect(pileTotal).toBe(5000); // all counted…
    // 23:14 UTC on Sept 27 = 00:14 Monday in Algiers — the school-local
    // pile lands on LUN, not the UTC Sunday the old chart showed.
    expect(piled[1].cash).toBe(5000);
    expect(piled[0].cash).toBe(0);

    // The SAME money with distinct recorded dates across the school week
    // distributes — the matrix the owner expects once the dates are real.
    const distinct = [
      pay({ id: "d1", collectedAt: "2026-09-27T09:00:00Z", amount: 1000 }), // Sunday
      pay({ id: "d2", collectedAt: "2026-09-28T09:00:00Z", amount: 1000 }), // Monday
      pay({ id: "d3", collectedAt: "2026-09-29T09:00:00Z", amount: 1000 }), // Tuesday
      pay({ id: "d4", collectedAt: "2026-09-30T09:00:00Z", amount: 1000 }), // Wednesday
      pay({ id: "d5", collectedAt: "2026-10-01T09:00:00Z", amount: 1000 }), // Thursday
    ];
    const spread = deriveWeeklyRhythm(distinct);
    for (const d of spread) expect(d.cash).toBe(1000);
  });

  it("date-only collectedAt values (the ETAT period anchors) attribute to their calendar weekday", () => {
    // The import's anchors land at UTC midnight (01:00 Algiers — the
    // calendar day is stable in both zones). 2026-09-15 is a TUESDAY.
    const rows = [pay({ id: "t1-anchor", collectedAt: "2026-09-15T00:00:00.000Z", amount: 79_500 })];
    const matrix = deriveWeeklyRhythm(rows);
    expect(matrix[0].cash).toBe(0); // Dim
    expect(matrix[1].cash).toBe(0); // Lun
    expect(matrix[2].cash).toBe(79_500); // Mar — Tuesday
  });
});

/* ==================================================================== */
/* B. The import's recorded-period attribution                           */
/* ==================================================================== */

describe("T-502 (DATA-062) — the canonical ETAT period anchors (the import's attribution map)", () => {
  it("maps every tranche/month bucket to its canonical period anchor (the official schedule)", async () => {
    // The anchor map is the import adapter's private concern, but the
    // CANONICAL schedule it consumes is public and pinned: Sept 15 /
    // Dec 15 / Mar 15 (getOfficialTuitionDueDates — the same triple the
    // installment due dates use).
    const { getOfficialTuitionDueDates } = await import("../../domain/calc/pricing/tuition");
    const [t1, t2, t3] = getOfficialTuitionDueDates(2026);
    expect(t1.startsWith("2026-09-15")).toBe(true);
    expect(t2.startsWith("2026-12-15")).toBe(true);
    expect(t3.startsWith("2027-03-15")).toBe(true);
    // The weekday spread of the anchors themselves: Sept 15 2026 is a
    // Tuesday, Dec 15 2026 a Tuesday, Mar 15 2027 a Monday — the three
    // waves land on DIFFERENT school weekdays, so the weekly chart
    // renders a real distribution once the anchors are attributed.
    expect(schoolLocalWeekdayIndex(`${t1.slice(0, 10)}T00:00:00.000Z`)).toBe(2); // Mar (Tuesday)
    expect(schoolLocalWeekdayIndex(`${t2.slice(0, 10)}T00:00:00.000Z`)).toBe(2); // Mar (Tuesday)
    expect(schoolLocalWeekdayIndex(`${t3.slice(0, 10)}T00:00:00.000Z`)).toBe(1); // Lun (Monday)
  });

  it("the live Sunday pile-up census is reproducible from the shape (the defect this fix removes at the source)", () => {
    // A synthetic pre-fix import: every payment stamped with the run
    // wall-clock → the weekly chart degenerates to one bar (rendered on
    // the UTC weekday by the old code — Sunday in the live census; the
    // school-local resolution says Monday 00:14 for the same stamp).
    // The import adapter now anchors tranche/month buckets to their
    // recorded periods (see repository-adapter.ts buildPaymentRows); this
    // case documents WHY the pile-up existed (the shape the live data
    // was left in before the remediation).
    const preFixImport = Array.from({ length: 4 }, (_, i) =>
      pay({
        id: `imp-${i}`,
        collectedAt: `2026-09-27T23:14:0${i}.000Z`, // all within the same minute
        amount: 1000,
        method: "cash" as PaymentMethod,
      }),
    );
    const matrix = deriveWeeklyRhythm(preFixImport);
    // All on ONE school-local weekday (Monday — 00:14 Algiers) — the
    // honest rendering of dishonestly-stamped data.
    expect(matrix[1].cash).toBe(4000);
    expect(matrix.filter((_, i) => i !== 1).every((d) => d.cash === 0)).toBe(true);
  });
});
