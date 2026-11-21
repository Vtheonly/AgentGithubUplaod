/**
 * ARCH-046 — the config.toml ↔ supabase/functions/ drift reconciliation gate.
 *
 * The S27 re-check found the drift: 15 function directories + `_shared`
 * existed under supabase/functions/ while the [functions.*] table carried TWO
 * STALE entries (generate-receipt-pdf, export-data — no directory) and MISSED
 * three code-present directories (create-user-account, delete-user-account,
 * send-push-notification). The reconciliation (Session 30) deleted the stale
 * entries and added the three. THIS TEST pins the 1:1 map permanently — any
 * future function directory without a config entry (or a stale entry without
 * a directory) fails here.
 *
 * OPS-020 note: config.toml is NOT a migration file — the append-only guard
 * is unaffected (and run separately at the session ladder).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const FUNCTIONS_DIR = join(DESKTOP_ROOT, "supabase", "functions");
const CONFIG_PATH = join(DESKTOP_ROOT, "supabase", "config.toml");

describe("ARCH-046 — supabase/config.toml ↔ supabase/functions/ census", () => {
  const configText = readFileSync(CONFIG_PATH, "utf8");
  const configFunctionNames = [...configText.matchAll(/^\[functions\.([a-z0-9-]+)\]/gm)].map(
    (m) => m[1],
  );
  const directoryNames = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  it("the [functions.*] entries map 1:1 to the code-present directories (+ _shared excluded)", () => {
    expect(directoryNames).toContain("_shared");
    const codeFunctions = directoryNames.filter((name) => name !== "_shared").sort();
    expect([...configFunctionNames].sort()).toEqual(codeFunctions);
  });

  it("the drift the S27 re-check found is GONE (no stale entries, no missing entries)", () => {
    // Asserted against the PARSED header list — a doc comment naming the
    // stale entries must never trip this gate.
    for (const stale of ["generate-receipt-pdf", "export-data"]) {
      expect(configFunctionNames).not.toContain(stale);
    }
    for (const required of [
      "create-user-account",
      "delete-user-account",
      "send-push-notification",
    ]) {
      expect(configFunctionNames).toContain(required);
    }
  });

  it("the three added entries keep the runtime auth contract (verify_jwt = true — the platform default they always ran under)", () => {
    for (const required of [
      "create-user-account",
      "delete-user-account",
      "send-push-notification",
    ]) {
      const section = configText.slice(configText.indexOf(`[functions.${required}]`));
      const body = section.slice(0, section.indexOf("[", 1) === -1 ? undefined : section.indexOf("[", 1));
      expect(body).toContain("verify_jwt = true");
    }
  });

  it("every entry is unique (no duplicate [functions.*] headers)", () => {
    expect(new Set(configFunctionNames).size).toBe(configFunctionNames.length);
  });
});
