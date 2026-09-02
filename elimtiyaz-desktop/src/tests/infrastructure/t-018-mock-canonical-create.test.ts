/**
 * T-018 mock alignment (19th session, migration 0065) — the mock CREATE path
 * mirrors the now-DETERMINISTIC server contract.
 *
 * History: T-018 (12th session) completed the desktop + sync layer but
 * INTENTIONALLY preserved the mock layer's `randomParentSuffix()` because it
 * mirrored the then-live server CREATE path (0022's `gen_random_bytes(3)` in
 * batch_register_family). Migration 0065 (reconstructed + committed this
 * session, T-115) made the server CREATE path deterministic — so the random
 * mock became a mirror of a DEAD server behavior and the last DRIFT-001
 * residue.
 *
 * Fixed: MockParentRepository.createParent derives the canonical
 * deterministicParentCode from the same identity fields the RPC hashes, and
 * REFUSES a duplicate identity exactly like the server's unique
 * (tenant_id, parent_code) constraint (the idempotency gate — "the dedup
 * match IS the code"). The dead randomParentSuffix copies are deleted from
 * core/format/id.ts and supabase-shared-repositories.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MockParentRepository } from "../../infrastructure/mock/repositories/parent-repository";
import { deterministicParentCode } from "../../core/format/id";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { CreateParentInput } from "../../domain/model/parent";

const SRC = join(__dirname, "../../");

function parentInput(overrides: Partial<CreateParentInput> = {}): CreateParentInput {
  return {
    firstName: "Karim",
    lastName: "Benali",
    displayName: "BENALI Karim",
    gender: "male",
    phone: `06${Math.floor(10000000 + Math.random() * 89999999)}`,
    ...overrides,
  };
}

describe("T-018 mock alignment — the mock CREATE path is canonical (migration 0065)", () => {
  let repo: MockParentRepository;

  beforeEach(() => {
    repo = new MockParentRepository();
  });

  it("createParent derives the SAME code the server RPC would (deterministic, no random)", async () => {
    const input = parentInput();
    const res = await repo.createParent(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const year = new Date().getFullYear();
    const expected = deterministicParentCode(year, {
      phone: input.phone,
      displayName: input.displayName ?? "",
      firstName: input.firstName,
      lastName: input.lastName,
    });
    expect(res.value.code).toBe(expected);
    expect(res.value.code).toMatch(/^PAR-\d{4}-[0-9A-F]{6}$/);
  });

  it("a DUPLICATE identity is refused (the server's unique-contract mirror)", async () => {
    const input = parentInput(); // same identity twice
    const first = await repo.createParent(input);
    expect(first.ok).toBe(true);
    const second = await repo.createParent(input);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("ERR_CONFLICT");
    // The store did not gain a second parent with the same code.
    const codes = store.parents.filter((p) => p.code === (first as { value: { code: string } }).value.code);
    expect(codes.length).toBe(1);
  });

  it("the same identity with cosmetic whitespace differences is STILL the same code (trim rule)", async () => {
    const a = await repo.createParent(parentInput({ phone: "0770000001", displayName: "  A SAME  " }));
    const b = await repo.createParent(
      parentInput({ phone: " 0770000001 ", displayName: "A SAME", firstName: " Karim " }),
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false); // refused: same identity after trimming
  });

  it("the random fallback generators are GONE (dead-code removal)", () => {
    const id = readFileSync(join(SRC, "core/format/id.ts"), "utf8");
    expect(id).not.toContain("randomParentSuffix");
    const shared = readFileSync(
      join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf8",
    );
    expect(shared).not.toContain("randomParentSuffix");
    const mockRepo = readFileSync(
      join(SRC, "infrastructure/mock/repositories/parent-repository.ts"),
      "utf8",
    );
    expect(mockRepo).toContain("deterministicParentCode");
  });
});
