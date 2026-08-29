/**
 * Regression test for SEC-100 (task T-001).
 *
 * The desktop used to ship nine staff email/password pairs as literals in
 * source control, in TWO places:
 *   1. `src/features/auth/login-screen.tsx` — the DEMO_ACCOUNTS quick-fill
 *      array (removed by T-001);
 *   2. `src/infrastructure/mock/seed-data.ts` — the mock layer's seedAccounts
 *      array (passwords removed by T-001; mock sign-in no longer matches on
 *      static password literals).
 *
 * Anything that reaches `src/` as a literal ends up in the production bundle,
 * where any user can extract it. This test scans the whole `src/` tree for the
 * nine leaked password literals and fails if any of them reappear.
 *
 * NOTE: this file intentionally CONTAINS the literals (as the detection list)
 * and therefore excludes itself from the scan.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

/** The `src/` tree that gets bundled into the production app. */
const SRC_ROOT = join(DESKTOP_ROOT, "src");

/** This test file — excluded because it holds the detection list itself. */
const THIS_FILE = fileURLToPath(import.meta.url);

/** The nine password literals that shipped with DEMO_ACCOUNTS / seedAccounts. */
const LEAKED_PASSWORDS: readonly string[] = [
  "admin123",
  "fin123",
  "teach123",
  "support123",
  "manager123",
  "buyer123",
  "driver123",
  "warehouse123",
  "worker123",
];

/** Recursively collect every .ts/.tsx file under `dir`. */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("SEC-100 — no demo credential literals in the desktop source tree", () => {
  it("src/ contains none of the nine leaked demo passwords", () => {
    const files = collectSourceFiles(SRC_ROOT).filter((f) => f !== THIS_FILE);
    expect(files.length).toBeGreaterThan(0); // sanity: the scan actually ran

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const password of LEAKED_PASSWORDS) {
        if (content.includes(password)) {
          offenders.push(`${file} contains "${password}"`);
        }
      }
    }

    expect(offenders, `Credential literals found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
