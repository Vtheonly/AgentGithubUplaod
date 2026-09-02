/**
 * Regression tests for the DATA-005 desktop residual (task T-134, 22nd
 * session).
 *
 * DATA-005: the Excel import populated `parents.display_name` (e.g.
 * "ZIREG LEA") + `last_name` and left `first_name` = '' on ALL 258
 * production rows. The domain model's canonical renderer
 * `parentDisplayName()` (src/domain/model/parent.ts) prefers displayName
 * and falls back to `{firstName} {lastName}` — the doc comment mandates
 * "Use this everywhere a parent name is rendered in the UI". The portal
 * was fixed in session 8 (T-084, formatParentName) and Android is clean
 * (every render site uses `Parent.fullName`, which prefers displayName).
 * The desktop audit (22nd session) found FOUR residual sites bypassing
 * the canonical helper, rendering "␣BENALI"-style half-names on the live
 * corpus:
 *   1. student-detail/info-tab.tsx:164        — parent card name
 *   2. student-detail/payments-tab.tsx:88     — parentName navigation context
 *   3. shared/search-index.ts:75              — parent result label
 *   4. infrastructure/mock/.../parent-repository.ts:45 — search matches
 *      first/last only (the SUPABASE implementation already matches
 *      displayName — mock/supabase parity gap)
 *
 * Coverage: unit behaviour of the canonical helper on the DATA-005 corpus
 * shape + source scans pinning the four sites use it + a mock-search
 * displayName-match regression.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parentDisplayName, type Parent } from "../../domain/model/parent.ts";
import { MockParentRepository } from "../../infrastructure/mock/repositories/parent-repository.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

function source(rel: string): string {
  return readFileSync(join(DESKTOP_ROOT, rel), "utf8");
}

/* ------------------------------------------------------------------ */
/* 1. The canonical helper on the DATA-005 corpus shape                */
/* ------------------------------------------------------------------ */

describe("DATA-005 — parentDisplayName on the live corpus shape", () => {
  const corpusParent = {
    firstName: "",
    lastName: "ZIREG LEA",
    displayName: "ZIREG LEA",
  } as Pick<Parent, "firstName" | "lastName" | "displayName">;

  it("renders the displayName verbatim (no leading-space half-name)", () => {
    expect(parentDisplayName(corpusParent)).toBe("ZIREG LEA");
    expect(parentDisplayName(corpusParent).startsWith(" ")).toBe(false);
  });

  it("falls back to first+last only when displayName is empty", () => {
    expect(parentDisplayName({ firstName: "Lea", lastName: "Zireg", displayName: null })).toBe("Lea Zireg");
    expect(parentDisplayName({ firstName: "", lastName: "Zireg", displayName: "" })).toBe("Zireg");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Source scans — the four audited sites use the canonical helper   */
/* ------------------------------------------------------------------ */

describe("DATA-005 — desktop render sites canonicalized (source scans)", () => {
  it("student-detail/info-tab.tsx renders the parent card via parentDisplayName", () => {
    const src = source("src/features/crm/student-detail/info-tab.tsx");
    expect(src).toContain("parentDisplayName");
    expect(src).not.toMatch(/\{parent\.firstName\}\s*\{parent\.lastName\}/);
  });

  it("student-detail/payments-tab.tsx builds the navigation parentName via parentDisplayName", () => {
    const src = source("src/features/crm/student-detail/payments-tab.tsx");
    expect(src).toContain("parentDisplayName");
    expect(src).not.toMatch(/parentName:\s*parent\s*\?\s*`\$\{parent\.firstName\}\s*\$\{parent\.lastName\}`/);
  });

  it("shared/search-index.ts labels PARENT results via parentDisplayName (students/personnel keep first+last)", () => {
    const src = source("src/shared/search-index.ts");
    expect(src).toContain("parentDisplayName");
    // The parent branch must not compose first+last directly.
    expect(src).not.toMatch(/label:\s*`\$\{p\.firstName\}\s*\$\{p\.lastName\}`/);
  });

  it("NO parent first+last composition remains in the UI tree outside the canonical helper / edit modal / tests", () => {
    // Walk src/ and flag PARENT-variable compositions. The convention across
    // this codebase: a variable named `parent` is a Parent domain object
    // (verified by the T-134 audit — every genuine parent site used either
    // `parent.` or a loop variable over a `parents` collection; all of the
    // latter were fixed and are pinned individually above). Short loop
    // variables named `p` are usually PERSONNEL or STUDENTS (they have real
    // first/last names — first+last composition is CORRECT for them), so the
    // tree-wide guard pins the `parent.`-convention only. The edit-parent
    // modal legitimately seeds form fields from parent.firstName (editing,
    // not display); the canonical helper and the mock seed's displayName
    // derivation live outside src/features + src/shared.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSyncSync(join(DESKTOP_ROOT, "src", dir))) {
        const rel = join("src", dir, entry);
        const abs = join(DESKTOP_ROOT, rel);
        if (statSyncSync(abs).isDirectory()) {
          if (entry === "tests" || entry === "__tests__") continue;
          walk(join(dir, entry));
        } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
          const text = readFileSync(abs, "utf8");
          const parentComposition = /\$\{parent\.firstName\}\s*\$\{parent\.lastName\}/.exec(text);
          if (parentComposition) offenders.push(rel);
        }
      }
    };
    walk(".");
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Mock search parity with the Supabase implementation              */
/* ------------------------------------------------------------------ */

describe("DATA-005 — mock parent search matches displayName (parity with supabase)", () => {
  it("the mock repository's search match-string includes displayName", () => {
    const src = source("src/infrastructure/mock/repositories/parent-repository.ts");
    expect(src).toMatch(/displayName/);
    expect(src).toMatch(/`\$\{p\.firstName\}\s*\$\{p\.lastName\}\s*\$\{p\.displayName/);
  });

  it("a query matching ONLY the displayName finds the parent (live-corpus shape)", async () => {
    const repo = new MockParentRepository();
    const created = await repo.createParent({
      firstName: "",
      lastName: "KADER",
      displayName: "KADER AMINE",
      gender: "male",
      phone: "+213 555 000 111",
    });
    expect(created.ok).toBe(true);
    const found = await repo.search("amine");
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value.some((p) => p.displayName === "KADER AMINE")).toBe(true);
    }
  });
});

// Minimal fs helpers (node:fs sync API) — keep the walker readable.
import { readdirSync, statSync } from "node:fs";
function readdirSyncSync(p: string): string[] {
  return readdirSync(p);
}
function statSyncSync(p: string) {
  return statSync(p);
}
