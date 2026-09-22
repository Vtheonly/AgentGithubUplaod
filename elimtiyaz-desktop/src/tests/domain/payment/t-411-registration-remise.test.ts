/**
 * T-411 Phase 4 (DATA-028) — the negotiated remise survives live
 * persistence.
 *
 * The wizard's step-3 devis promises `fi + scolarité + transport −
 * remise`; the Supabase batchRegister previously built its tuition wire
 * with ZERO references to the remise (audit FA-17 — the wizard-collected
 * value was silently dropped in live mode). This suite pins the wire
 * construction: the remise reduces the persisted charges, the
 * sticker-price case records it without subtracting, and the metadata
 * carries both values.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SupabaseStudentRepository } from "../../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { CreateParentInput, CreateStudentInput } from "../../../domain/model/student";

type Row = Record<string, unknown>;

const TENANT = "00000000-0000-4000-8000-000000000001";

function makeStudent(overrides: Partial<CreateStudentInput> = {}): CreateStudentInput {
  return {
    firstName: "Probe",
    lastName: "T411",
    gender: "male",
    birthDate: "2015-01-01",
    level: "primary",
    gradeYear: 3,
    paymentPlan: "tranches",
    remise: overrides.remise,
    chargeStickerPrice: overrides.chargeStickerPrice,
    ...overrides,
  } as CreateStudentInput;
}

function makeFakeClient() {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args?: Row) => {
      rpcCalls.push({ fn, args: args ?? {} });
      if (fn === "register_family_batch") {
        return {
          data: [
            {
              out_parent: { id: "p-1" },
              out_students: [{ id: "s-1" }],
              out_ledger_written: 4,
              out_installments_written: 4,
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    }),
    from: vi.fn(() => {
      throw new Error("unexpected table access in this probe");
    }),
  };
  return { client, rpcCalls };
}

describe("T-411 / DATA-028 — the negotiated remise survives the Supabase batchRegister wire", () => {
  beforeEach(() => {
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: "u-1", displayName: "T-411" }),
    );
  });

  async function collectWire(remise: number | undefined, sticker: boolean | undefined) {
    const { client, rpcCalls } = makeFakeClient();
    const repo = new SupabaseStudentRepository(client as never);
    const parent: CreateParentInput = {
      firstName: "Probe",
      lastName: "Parent",
      gender: "male",
      phone: "0554289999",
    } as CreateParentInput;
    const res = await repo.batchRegister({
      parent,
      students: [makeStudent({ remise, chargeStickerPrice: sticker })],
      includeRegistration: false,
      includeTransport: false,
    });
    expect(res.ok).toBe(true);
    const call = rpcCalls.find((c) => c.fn === "register_family_batch");
    expect(call).toBeDefined();
    const installments = call!.args.p_installments as Row[];
    const ledger = call!.args.p_ledger_entries as Row[];
    return { installments, ledger };
  }

  it("the remise reduces the persisted tuition total (the devis is honored)", async () => {
    const without = await collectWire(undefined, undefined);
    const withRemise = await collectWire(20_000, undefined);
    const totalWithout = without.installments.reduce((s, i) => s + Number(i.amount_due), 0);
    const totalWith = withRemise.installments.reduce((s, i) => s + Number(i.amount_due), 0);
    // The old code: both totals EQUAL (the remise vanished). Now: 20 000 less.
    expect(totalWithout - totalWith).toBe(20_000);
    // …and the ledger charge amounts match the installment amounts.
    const ledgerTotal = withRemise.ledger.reduce((s, e) => s + Number(e.amount), 0);
    expect(ledgerTotal).toBe(totalWith);
  });

  it("the sticker-price case records the remise WITHOUT subtracting it (SEDIKI convention)", async () => {
    const sticker = await collectWire(20_000, true);
    const plain = await collectWire(undefined, undefined);
    const stickerTotal = sticker.installments.reduce((s, i) => s + Number(i.amount_due), 0);
    const plainTotal = plain.installments.reduce((s, i) => s + Number(i.amount_due), 0);
    expect(stickerTotal).toBe(plainTotal);
    // …but the charge metadata records BOTH the negotiated value and the
    // applied-to-devis value (0 in the sticker case).
    const meta = sticker.ledger[0].metadata as Record<string, unknown>;
    expect(meta.remise).toBe(20_000);
    expect(meta.remiseAppliedToDevis).toBe(0);
  });

  it("the applied remise is recorded in the charge metadata", async () => {
    const applied = await collectWire(20_000, undefined);
    const meta = applied.ledger[0].metadata as Record<string, unknown>;
    expect(meta.remise).toBe(20_000);
    expect(meta.remiseAppliedToDevis).toBe(20_000);
  });
});
