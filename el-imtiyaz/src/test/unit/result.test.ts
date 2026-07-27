/**
 * Unit tests for the Result<T, E> discriminated union.
 *
 * Result replaces try/catch in repository and use-case code paths so that
 * errors are explicit in the type signature and forced to be handled by callers.
 *
 * Covers: Ok, Err, tryResult, mapResult, flatMapResult, unwrapOr.
 */
import { describe, it, expect } from "vitest";
import {
  Ok,
  Err,
  tryResult,
  mapResult,
  flatMapResult,
  unwrapOr,
  type Result,
  type AppError,
} from "../../core/result/result";

describe("Ok / Err constructors", () => {
  it("Ok produces a discriminated Ok result", () => {
    const r = Ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("Err produces a discriminated Err result", () => {
    const err: AppError = {
      code: "E_TEST",
      message: "boom",
      userMessage: "Une erreur est survenue.",
    };
    const r = Err(err);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(err);
  });

  it("Ok accepts null and undefined values", () => {
    const r1 = Ok(null);
    const r2 = Ok(undefined);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});

describe("tryResult", () => {
  it("wraps a resolved Promise in Ok", async () => {
    const r = await tryResult(() => Promise.resolve("hello"));
    expect(r).toEqual({ ok: true, value: "hello" });
  });

  it("wraps a rejected Promise in Err with a structured AppError", async () => {
    const r = await tryResult(() => Promise.reject(new Error("network failed")));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_UNKNOWN");
      expect(r.error.message).toBe("network failed");
      expect(r.error.userMessage).toBe("Une erreur inattendue s'est produite.");
    }
  });

  it("wraps a non-Error rejection in Err", async () => {
    const r = await tryResult(() => Promise.reject("string error"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_UNKNOWN");
      expect(r.error.message).toBe("string error");
    }
  });

  it("accepts a custom error mapper", async () => {
    const r = await tryResult(
      () => Promise.reject(new Error("custom")),
      (err): AppError => ({
        code: "E_CUSTOM",
        message: String(err),
        userMessage: "Custom message",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("E_CUSTOM");
      expect(r.error.userMessage).toBe("Custom message");
    }
  });
});

describe("mapResult", () => {
  it("transforms the value of an Ok result", () => {
    const r: Result<number> = Ok(5);
    const mapped = mapResult(r, (n) => n * 2);
    expect(mapped).toEqual({ ok: true, value: 10 });
  });

  it("passes through an Err result unchanged", () => {
    const err: AppError = { code: "E", message: "x", userMessage: "y" };
    const r: Result<number> = Err(err);
    const mapped = mapResult(r, (n) => n * 2);
    expect(mapped).toEqual({ ok: false, error: err });
  });
});

describe("flatMapResult", () => {
  it("chains an Ok result into a new Result", () => {
    const r: Result<number> = Ok(5);
    const chained = flatMapResult(r, (n) => Ok(n + 1));
    expect(chained).toEqual({ ok: true, value: 6 });
  });

  it("can chain an Ok result into an Err", () => {
    const r: Result<number> = Ok(5);
    const err: AppError = { code: "E", message: "x", userMessage: "y" };
    const chained = flatMapResult(r, () => Err(err));
    expect(chained).toEqual({ ok: false, error: err });
  });

  it("short-circuits when the source is Err", () => {
    const err: AppError = { code: "E", message: "x", userMessage: "y" };
    const r: Result<number> = Err(err);
    const chained = flatMapResult(r, (n) => Ok(n + 1));
    expect(chained).toEqual({ ok: false, error: err });
  });
});

describe("unwrapOr", () => {
  it("returns the value when Ok", () => {
    expect(unwrapOr(Ok(42), 0)).toBe(42);
  });

  it("returns the fallback when Err", () => {
    const err: AppError = { code: "E", message: "x", userMessage: "y" };
    expect(unwrapOr(Err(err), 99)).toBe(99);
  });

  it("returns the fallback value as-is when it's an object", () => {
    const err: AppError = { code: "E", message: "x", userMessage: "y" };
    const fallback = { name: "default" };
    expect(unwrapOr(Err(err), fallback)).toBe(fallback);
  });
});
