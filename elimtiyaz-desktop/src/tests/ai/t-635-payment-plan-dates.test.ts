import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

describe("T-635 — local payment-plan calendar dates", () => {
  it.each(["UTC", "Africa/Algiers", "Asia/Kolkata", "America/New_York"])("keeps the requested day in %s", (TZ) => {
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { buildPaymentPlan } from './src/core/ai/analysis/insights.ts';
      console.log(JSON.stringify(buildPaymentPlan(100001,3,new Date(2026,8,10),20000)));
    `], { cwd: process.cwd(), env: { ...process.env, TZ }, encoding: "utf8" });
    const plan = JSON.parse(output) as { schedule: { dueDate: string; amount: number }[]; totalPlanned: number };
    expect(plan.schedule.map(row => row.dueDate)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(plan.schedule.reduce((sum, row) => sum + row.amount, 20000)).toBe(100001);
    expect(plan.totalPlanned).toBe(100001);
  });
});
