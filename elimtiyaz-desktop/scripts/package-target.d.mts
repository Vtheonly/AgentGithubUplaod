/**
 * Type declarations for scripts/package-target.mjs (the packager's pure
 * target-resolution helpers — T-573). The root tsconfig does not compile
 * .mjs sources; this adjacent declaration file gives tsc the surface while
 * vitest imports the real module.
 */

export declare const FACTORY_DEFAULT_SUPABASE_URL: string;
export declare const FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY: string;

export interface ResolvedPackageTarget {
  url: string;
  key: string;
  source: string;
}

export declare function resolvePackageTarget(input: {
  processEnv: Record<string, string | undefined>;
  viteEnv: Record<string, string | undefined>;
  allEnv?: Record<string, string | undefined>;
}): ResolvedPackageTarget;

export declare function isValidTargetUrl(value: unknown): boolean;

export declare function isValidTargetKey(value: unknown): boolean;

export declare function probeTargetReadiness(
  url: string,
  key: string,
): Promise<{ ok: boolean; status: number; detail: string }>;
