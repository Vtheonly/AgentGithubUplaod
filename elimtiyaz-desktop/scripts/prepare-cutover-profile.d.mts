/**
 * Type declarations for scripts/prepare-cutover-profile.mjs (T-614/P3 — the
 * desktop reconnect tool: the T-573 BackendProfile writer for the relocation
 * target). The root tsconfig does not compile .mjs sources; this adjacent
 * declaration file gives tsc the surface while vitest imports the real module
 * (the preflight-target.d.mts convention).
 */

export declare const TARGET_URL_ENV: string;
export declare const TARGET_KEY_ENV: string;
export declare const PROFILE_FILE_NAME: string;
export declare const DEFAULT_NOTE: string;

export interface BackendProfileTarget {
  url: string;
  anonKey: string;
}
export interface BackendProfile {
  profileVersion: 1;
  backendKind: "supabase";
  supabase: BackendProfileTarget;
  note?: string;
}

export type BuildCutoverProfileResult =
  | { ok: true; profile: BackendProfile }
  | { ok: false; reason: string };

export interface PublicKeyClassification {
  ok: boolean;
  reason?: string;
  shape?: "sb_publishable" | "legacy-anon-jwt";
}

export interface MainIo {
  writeFileSync(path: string, content: string, encoding?: string): void;
  renameSync(from: string, to: string): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFileSync(path: string, encoding: string): string;
}

export interface MainResult {
  exitCode: number;
  dryRun?: boolean;
  written?: string;
  profile?: BackendProfile;
}

export declare function isValidSupabaseProjectUrl(value: unknown): boolean;
export declare function classifyPublicKey(
  value: unknown,
  options?: { allowLegacyAnonJwt?: boolean },
): PublicKeyClassification;
export declare function buildCutoverProfile(
  env: Record<string, string | undefined>,
  options?: { allowLegacyAnonJwt?: boolean; note?: string },
): BuildCutoverProfileResult;
export declare function userDataGuidance(): string;
export declare function main(
  argv?: string[],
  env?: Record<string, string | undefined>,
  io?: MainIo,
): MainResult;
