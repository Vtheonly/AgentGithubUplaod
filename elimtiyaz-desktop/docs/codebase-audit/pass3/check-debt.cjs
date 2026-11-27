// From elimtiyaz-desktop: node --require tsx/cjs docs/codebase-audit/pass3/check-debt.cjs /path/to/website
const assert = require("node:assert/strict");
const path = require("node:path");
const staff = require("../../../src/domain/calc/ledger/debt-aging.ts");
const portal = require(path.resolve(process.argv[2], "src/lib/canonical/calc/ledger/debt-aging.ts"));
const factors = { outstandingAmount: 150000, debtAgeDays: 730, inactivityDays: 30 };
const reasons = [staff, portal].map(engine => engine.computeDebtAgingStatus(factors).reasonCode);
console.log(factors, reasons);
assert.deepEqual(reasons, ["critical_delinquency", "active_payer"]);
