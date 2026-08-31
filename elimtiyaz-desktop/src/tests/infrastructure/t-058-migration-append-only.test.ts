/**
 * Regression test for T-058 (REG-001) — append-only migration discipline.
 *
 * The canonical migration chain (supabase/migrations/, ADR-001) is the
 * contract between the committed repo and the LIVE Supabase project
 * (schema_migrations registration, AGENTS.md §15.9/§15.10). Editing an
 * already-applied migration makes the two silently diverge — exactly the
 * ARCH-011 incident (0053/0054 applied live but missing from a fresh
 * clone's chain) and the REG-001 fix-up pattern (0034–0043, ten
 * migrations patching three "final" unifications).
 *
 * scripts/check-migrations-append-only.sh is the enforcement guard. This
 * suite wires it into `npm test`:
 *   1. the REAL chain must pass (working tree clean vs HEAD, all files
 *      headed, all names NNNN_*.sql);
 *   2. the guard must REJECT planted violations (edit, delete, rename,
 *      committed edit vs base, headerless/misnamed new files) — proved
 *      against a THROWAWAY git repo so the real tree is never dirtied
 *      and parallel test files are unaffected.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** …/elimtiyaz-desktop (this file lives in src/tests/infrastructure/). */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

const GUARD = join(DESKTOP_ROOT, "scripts", "check-migrations-append-only.sh");
const REAL_MIGRATIONS = join(DESKTOP_ROOT, "supabase", "migrations");

/** Runs the guard; returns the exit code (0 pass, 1 violations, 2 env). */
function runGuard(dir: string, base?: string): number {
  const args = ["--dir", dir, ...(base ? ["--base", base] : [])];
  try {
    execSync(`bash ${JSON.stringify(GUARD)} ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    const e = err as { status?: number };
    return e.status ?? 1;
  }
}

/** Creates a throwaway git repo with ONE well-formed migration. */
function makeTempRepo(): { repo: string; mig: string; base: string } {
  const repo = mkdtempSync(join(tmpdir(), "t058-"));
  const mig = join(repo, "supabase", "migrations");
  mkdirSync(mig, { recursive: true });
  writeFileSync(join(mig, "0001_init.sql"), "-- 0001 init\nCREATE TABLE t (id int);\n");
  execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: repo });
  execSync("git add -A && git commit -qm init", { cwd: repo });
  const base = execSync("git rev-parse HEAD", { cwd: repo }).toString().trim();
  return { repo, mig, base };
}

/** git helper inside the temp repo. */
function git(repo: string, cmd: string): void {
  execSync(cmd, { cwd: repo, stdio: "pipe" });
}

describe("T-058 append-only migration discipline (REG-001)", () => {
  it("passes on the real canonical chain (working tree clean vs HEAD, headers + naming well-formed)", () => {
    expect(runGuard(REAL_MIGRATIONS, "HEAD")).toBe(0);
  });

  it("rejects an unstaged edit to an existing migration", () => {
    const { repo, mig, base } = makeTempRepo();
    try {
      writeFileSync(join(mig, "0001_init.sql"), "-- 0001 init\nCREATE TABLE t (id int);\n-- planted edit\n");
      expect(runGuard(mig, base)).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects a deletion even when git prunes the empty migrations directory", () => {
    const { repo, mig, base } = makeTempRepo();
    try {
      git(repo, "git rm -q supabase/migrations/0001_init.sql");
      expect(runGuard(mig, base)).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects a rename of an existing migration", () => {
    const { repo, mig, base } = makeTempRepo();
    try {
      git(repo, "git mv supabase/migrations/0001_init.sql supabase/migrations/0002_moved.sql");
      expect(runGuard(mig, base)).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects a COMMITTED edit (only visible against the base ref — the PR case)", () => {
    const { repo, mig, base } = makeTempRepo();
    try {
      writeFileSync(join(mig, "0001_init.sql"), "-- 0001 init\nCREATE TABLE t (id int, planted int);\n");
      git(repo, "git add -A && git commit -qm edit");
      expect(runGuard(mig, base)).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("allows a NEW migration, but only with a '--' header and NNNN_name.sql naming", () => {
    const { repo, mig, base } = makeTempRepo();
    try {
      writeFileSync(join(mig, "0002_next.sql"), "-- 0002 next\nSELECT 1;\n");
      expect(runGuard(mig, base)).toBe(0);

      writeFileSync(join(mig, "0003_bad.sql"), "SELECT 1;\n"); // no header
      expect(runGuard(mig, base)).toBe(1);
      rmSync(join(mig, "0003_bad.sql"));

      writeFileSync(join(mig, "zz.sql"), "-- bad name\nSELECT 1;\n"); // wrong name shape
      expect(runGuard(mig, base)).toBe(1);
      rmSync(join(mig, "zz.sql"));

      expect(runGuard(mig, base)).toBe(0); // back to clean
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
