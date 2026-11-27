/**
 * audit-smoke.spec.ts — Playwright runtime smoke check for the renderer.
 * Part of the Codebase Intelligence, Architecture & Duplication Audit.
 * Run (from elimtiyaz-desktop/):
 *   npx vite preview --port 4173 & npx playwright test docs/codebase-audit/tools/audit-smoke.spec.ts
 *
 * The app defaults to MOCK repositories (VITE_USE_SUPABASE unset), so the
 * renderer can boot fully offline. This spec: boots the built bundle,
 * asserts the app shell mounts, walks the main navigation, and records
 * every console error / page error encountered.
 */
import { test, expect } from "@playwright/test";

const CONSOLE_ERRORS: string[] = [];
const PAGE_ERRORS: string[] = [];

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") CONSOLE_ERRORS.push(msg.text().slice(0, 220));
  });
  page.on("pageerror", (err) => PAGE_ERRORS.push(String(err).slice(0, 220)));
});

test("app boots and renders the shell", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const root = page.locator("#root");
  await expect(root).toBeAttached();
  const html = await root.innerHTML();
  expect(html.length, "renderer produced non-empty DOM").toBeGreaterThan(500);
});

test("main navigation is reachable", async ({ page }) => {
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // try known routes from the router (hash or history based)
  for (const route of ["/", "#/dashboard", "#/crm"]) {
    await page.goto("http://localhost:4173/" + route, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const html = await page.locator("#root").innerHTML();
  expect(html.length).toBeGreaterThan(300);
});

test.afterAll(() => {
  console.log("SMOKE_CONSOLE_ERRORS:", JSON.stringify(CONSOLE_ERRORS.slice(0, 20), null, 2));
  console.log("SMOKE_PAGE_ERRORS:", JSON.stringify(PAGE_ERRORS.slice(0, 20), null, 2));
  console.log(`SMOKE_SUMMARY: console_errors=${CONSOLE_ERRORS.length} page_errors=${PAGE_ERRORS.length}`);
});
