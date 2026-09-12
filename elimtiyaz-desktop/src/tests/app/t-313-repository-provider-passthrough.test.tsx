/**
 * T-313 (REG-006) — RepositoryProvider pass-through integrity.
 *
 * The 9e70078 unregistered patch wrapped the repositories object in a
 * useMemo "enhancedRepositories" decorator whose ONLY purpose was to
 * intercept `subjects.assignSubjectToClass` and convert the server's
 * ERR_FORBIDDEN (the ACAD-104 RLS rejection) into a fabricated
 * client-side success row. Two defects shipped with it:
 *
 *   1. **Fake success** — the UI showed "Matière assignée" while NOTHING
 *      persisted (the fabricated row exists in no table, no cache).
 *   2. **Prototype stripping** — `{ ...base.subjects, assignSubjectToClass }`
 *      spreads a class INSTANCE, copying own enumerable properties only;
 *      every prototype method (`observe`, `observeByClass`, `createSubject`,
 *      …) became `undefined` app-wide, in BOTH mock and Supabase mode.
 *
 * This suite pins the restored architecture:
 *   - The context value is the repositories prop BY REFERENCE (no wrapper).
 *   - A class-instance repository keeps its prototype methods through the
 *     provider (the exact regression the teacher-workspace render test
 *     caught as "repos.subjects.observe is not a function").
 *   - Source-level guard: the provider file contains no per-method
 *     interception of repository slots (no spread of a slot, no
 *     assignSubjectToClass wrapper).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  RepositoryProvider,
  useRepositories,
  type Repositories,
} from "../../app/providers/repository-provider";

const PROVIDER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../app/providers/repository-provider.tsx"),
  "utf8",
);

/** A repository whose methods live on the PROTOTYPE (class syntax) — the
 * shape the 9e70078 spread destroyed. */
class PrototypeSubjectRepository {
  observe(): string[] {
    return ["observed"];
  }
  createSubject(): string {
    return "created";
  }
  assignSubjectToClass(): string {
    return "assigned";
  }
}

function Probe() {
  const repos = useRepositories();
  const subjects = repos.subjects as unknown as PrototypeSubjectRepository;
  return (
    <div>
      <span data-testid="observe">{String(typeof subjects.observe)}</span>
      <span data-testid="create">{String(typeof subjects.createSubject)}</span>
      <span data-testid="assign">{String(typeof subjects.assignSubjectToClass)}</span>
      <span data-testid="result">{subjects.observe().join(",")}</span>
    </div>
  );
}

function buildReposWithPrototypeSlot(): Repositories {
  // T-313a: double-assertion — `Repositories` (an interface, no index
  // signature) does not overlap `Record<string, unknown>` directly, so the
  // write must go through `unknown` (the TS-blessed path for intentional
  // partial construction in tests).
  const base = {} as Repositories;
  (base as unknown as Record<string, unknown>).subjects =
    new PrototypeSubjectRepository();
  return base;
}

describe("T-313 — RepositoryProvider pass-through integrity", () => {
  it("provides the repositories prop BY REFERENCE (no wrapper object)", () => {
    const repositories = buildReposWithPrototypeSlot();
    let seen: Repositories | null = null;
    function RefProbe() {
      seen = useRepositories();
      return null;
    }
    render(
      <RepositoryProvider repositories={repositories}>
        <RefProbe />
      </RepositoryProvider>,
    );
    expect(seen).toBe(repositories);
  });

  it("a class-instance repository keeps its PROTOTYPE methods through the provider", () => {
    render(
      <RepositoryProvider repositories={buildReposWithPrototypeSlot()}>
        <Probe />
      </RepositoryProvider>,
    );
    expect(document.querySelector('[data-testid="observe"]')?.textContent).toBe("function");
    expect(document.querySelector('[data-testid="create"]')?.textContent).toBe("function");
    expect(document.querySelector('[data-testid="assign"]')?.textContent).toBe("function");
    // The prototype method is CALLABLE, not just typed.
    expect(document.querySelector('[data-testid="result"]')?.textContent).toBe("observed");
  });
});

describe("T-313 — source guard: no per-slot interception in the provider", () => {
  // Comments legitimately DESCRIBE the removed wrapper (documentation of
  // the bug class); only CODE must not re-introduce it. Strip comments the
  // same way teacher-workspace.test.tsx does.
  const codeOnly = PROVIDER_SRC
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/^\s*\/\/.*$/gm, ""); // line comments

  it("contains no spread of a repository slot (the prototype-stripping bug class)", () => {
    // The 9e70078 shape: `...base.subjects` inside a useMemo decorator.
    // Whitespace-normalized so formatter passes cannot break the pin.
    const norm = codeOnly.replace(/\s+/g, " ");
    expect(norm).not.toContain("...base.subjects");
    expect(norm).not.toContain("...repositories.subjects");
    expect(norm).not.toContain("...base,");
  });

  it("contains no assignSubjectToClass interception (the fake-success wrapper)", () => {
    expect(codeOnly).not.toContain("assignSubjectToClass");
    expect(codeOnly).not.toMatch(/fallbackItem|enhancedRepositories/);
  });

  it("provides the context straight from the prop (the restored wiring)", () => {
    const norm = codeOnly.replace(/\s+/g, "");
    expect(norm).toContain("<RepositoryContext.Providervalue={repositories}");
  });
});
