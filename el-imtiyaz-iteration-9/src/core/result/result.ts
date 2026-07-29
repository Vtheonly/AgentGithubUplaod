/**
 * Result<T, E> — discriminated union for fallible operations.
 *
 * Replaces try/catch in repository and use-case code paths so that errors
 * are explicit in the type signature and forced to be handled by callers.
 *
 * Mirrors the Android `core/common/Result.kt` sealed type so the desktop and
 * mobile platforms share a single mental model for fallible operations.
 */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type AppError = {
  readonly code: string;
  readonly message: string;
  readonly userMessage: string;
  readonly cause?: unknown;
};

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const Err = <E = AppError>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Wrap a Promise-returning function in a Result, capturing thrown errors
 * into a structured AppError. Use this at the boundary of any subsystem
 * that does not natively produce Results (e.g., a third-party SDK).
 *
 * Iteration 4 fix: the catch block now calls the `toError` parameter
 * (rather than `toAppError` directly), so callers that pass a custom
 * error mapper actually get their mapper applied. Previously the `toError`
 * parameter was accepted but silently ignored. Caught by the unit test
 * `tryResult > accepts a custom error mapper`.
 */
export async function tryResult<T>(
  fn: () => Promise<T>,
  toError: (err: unknown) => AppError = toAppError,
): Promise<Result<T>> {
  try {
    return Ok(await fn());
  } catch (err) {
    return Err(toError(err));
  }
}

/**
 * Map a Result's value when Ok; pass through when Err.
 */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? Ok(fn(r.value)) : r;
}

/**
 * Chain Results together. The fn only runs when r is Ok.
 */
export function flatMapResult<T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => Result<U, E>,
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

function toAppError(err: unknown): AppError {
  if (err instanceof Error) {
    return {
      code: "ERR_UNKNOWN",
      message: err.message,
      userMessage: "Une erreur inattendue s'est produite.",
      cause: err,
    };
  }
  return {
    code: "ERR_UNKNOWN",
    message: String(err),
    userMessage: "Une erreur inattendue s'est produite.",
  };
}
