/**
 * Receipt PDF generation — public barrel for the receipt-pdf module.
 *
 * Re-exports the 4 PDF generators + the browser-side download helper. Each
 * generator lives in its own file for clarity:
 *   - payment-receipt  — single-transaction receipt (plan §07.05)
 *   - account-statement — parent ledger statement
 *   - bulletin          — student term bulletin (spec §5.2)
 *   - payslip           — personnel payslip (spec §5.2)
 *
 * Shared drawing primitives (drawHeader, drawBox, drawKeyValue, palette
 * constants) live in `./shared`.
 *
 * Callers should import from `@/infrastructure/receipt-pdf` (this barrel)
 * or directly from a specific submodule when only one generator is needed.
 */
export { generatePaymentReceiptPdf } from "./payment-receipt";
export { generateAccountStatementPdf } from "./account-statement";
export { generateBulletinPdf } from "./bulletin";
export { generatePayslipPdf } from "./payslip";
export { downloadPdf } from "./download";
