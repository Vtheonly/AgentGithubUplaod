#!/usr/bin/env node
/**
 * prepare-cutover-profile.mjs — T-614/P3: the desktop reconnect tool (the
 * T-573 BackendProfile writer for the relocation target).
 *
 * WHAT THIS IS: the ONE-COMMAND operator tool that builds the validated
 * `backend-profile.json` pointing the DESKTOP app at the relocation target
 * (the new Supabase project) — the §A.5 "switching credentials & reconnecting
 * the Windows clients" lane's desktop half. The T-573 switcher's whole point
 * is that a PACKAGED app re-points WITHOUT a rebuild: drop a valid profile
 * into userData, relaunch. This tool writes exactly that file, from the
 * OPERATOR's environment — the key NEVER lives in any committed file.
 *
 * FAIL-CLOSED (the relocate-auth/preflight-target conventions):
 *   - SUPABASE_TARGET_URL and SUPABASE_TARGET_PUBLISHABLE_KEY are read from
 *     the environment ONLY (never argv — argv leaks into shell history and
 *     process listings); either missing → refuse with the exact remedy.
 *   - The URL must be https://<ref>.supabase.co (the contract's supabase-kind
 *     rule); a non-https origin, a hash, or a path → refuse.
 *   - The key must look like a PUBLIC key (sb_publishable_… / a legacy anon
 *     JWT shape is REFUSED by default — the new project issues sb_publishable
 *     keys; pass --allow-legacy-anon-jwt only if the owner explicitly
 *     supplies an old-style anon JWT). A SECRET/service-role key
 *     (sb_secret_… / service_role payload) → refuse, always.
 *   - DRY-RUN BY DEFAULT: prints the profile JSON + the resolved target path
 *     and writes NOTHING. --write (with --userData <dir>) is the only write
 *     path; it creates the file atomically (tmp + rename) and never touches
 *     anything else in userData.
 *
 * ZERO NETWORK I/O (the OPS-015/G2 fence: this tool never probes the target
 * — the T-573 kind-aware validateConnection and the T-575 preflight own the
 * connectivity proof, inside the owner's window).
 *
 * The emitted profile is proven contract-valid by the t-t614 suite, which
 * imports BOTH this module and the REAL validateBackendProfile (no mirror
 * drift is possible: the suite is the equivalence proof).
 *
 * Usage:
 *   SUPABASE_TARGET_URL=https://gvuvibcsfjhwcjikgxql.supabase.co \
 *   SUPABASE_TARGET_PUBLISHABLE_KEY=sb_publishable_… \
 *   node scripts/prepare-cutover-profile.mjs            # dry-run
 *   … node scripts/prepare-cutover-profile.mjs --write --userData "/c/Users/<owner>/AppData/Roaming/El-Imtiyaz Desktop"
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

export const TARGET_URL_ENV = "SUPABASE_TARGET_URL";
export const TARGET_KEY_ENV = "SUPABASE_TARGET_PUBLISHABLE_KEY";
export const PROFILE_FILE_NAME = "backend-profile.json";
export const DEFAULT_NOTE = "T-614 cutover profile — the relocation target (set by prepare-cutover-profile.mjs at the owner's window)";

/** The pure URL shape check — mirrors the contract's supabase-kind rule. */
export function isValidSupabaseProjectUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hash || parsed.pathname !== "/") return false;
  return parsed.hostname.toLowerCase().endsWith(".supabase.co") && parsed.hostname.length > ".supabase.co".length;
}

/** The pure key classifier — PUBLIC keys only, fail-closed on secret material. */
export function classifyPublicKey(value, { allowLegacyAnonJwt = false } = {}) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) return { ok: false, reason: "the publishable key is empty" };
  if (key.startsWith("sb_secret_") || key.includes("service_role")) {
    return { ok: false, reason: "REFUSED: that looks like a SECRET/service-role key — the profile carries the PUBLIC (publishable) key only" };
  }
  if (key.startsWith("sb_publishable_")) {
    return { ok: true, shape: "sb_publishable" };
  }
  // Legacy anon keys are JWTs (eyJ… three dot-separated base64url segments).
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    if (!allowLegacyAnonJwt) {
      return { ok: false, reason: "REFUSED: legacy anon-JWT key shape — the new project issues sb_publishable_… keys (pass --allow-legacy-anon-jwt ONLY if the owner explicitly supplies the old-style key)" };
    }
    return { ok: true, shape: "legacy-anon-jwt" };
  }
  return { ok: false, reason: "unrecognized key shape — expected sb_publishable_… (the NEW project's publishable key from Settings → API)" };
}

/**
 * The pure builder — from the operator env to the profile object.
 * Returns { ok: true, profile } | { ok: false, reason }.
 */
export function buildCutoverProfile(env, { allowLegacyAnonJwt = false, note } = {}) {
  const url = (env[TARGET_URL_ENV] ?? "").trim();
  const key = (env[TARGET_KEY_ENV] ?? "").trim();
  if (!url) {
    return { ok: false, reason: `missing ${TARGET_URL_ENV} — export it with the relocation target's https://<ref>.supabase.co URL` };
  }
  if (!key) {
    return { ok: false, reason: `missing ${TARGET_KEY_ENV} — export it with the relocation target's sb_publishable_… key (Settings → API; read from the OPERATOR environment, never committed)` };
  }
  if (!isValidSupabaseProjectUrl(url)) {
    return { ok: false, reason: `REFUSED: ${TARGET_URL_ENV} must be exactly https://<ref>.supabase.co (https, no hash, no path) — got: ${url}` };
  }
  const keyVerdict = classifyPublicKey(key, { allowLegacyAnonJwt });
  if (!keyVerdict.ok) return { ok: false, reason: `REFUSED: ${keyVerdict.reason}` };
  const normalizedUrl = new URL(url).origin;
  return {
    ok: true,
    profile: {
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: normalizedUrl, anonKey: key },
      note: note ?? DEFAULT_NOTE,
    },
  };
}

/** The per-OS userData guidance (electron's app.getPath("userData")). */
export function userDataGuidance() {
  return [
    "Windows (packaged): %APPDATA%\\El-Imtiyaz Desktop  (C:\\Users\\<owner>\\AppData\\Roaming\\El-Imtiyaz Desktop)",
    "Linux: ~/.config/el-imtiyaz-desktop",
    "macOS: ~/Library/Application Support/El-Imtiyaz Desktop",
  ].join("\n  ");
}

function usage() {
  return [
    "prepare-cutover-profile.mjs — the T-614/P3 desktop reconnect tool",
    "",
    "  env (REQUIRED, both):",
    `    ${TARGET_URL_ENV}                 the target's https://<ref>.supabase.co URL`,
    `    ${TARGET_KEY_ENV}    the target's sb_publishable_… key`,
    "",
    "  flags:",
    "    --write                    actually persist (default: dry-run, writes nothing)",
    "    --userData <dir>           the app's userData directory (REQUIRED with --write)",
    "    --note <text>              override the profile note (≤ 500 chars)",
    "    --allow-legacy-anon-jwt    permit an old-style anon JWT key (owner-explicit only)",
    "",
    "  The userData directory per OS:",
    "  " + userDataGuidance(),
  ].join("\n");
}

export function main(argv = process.argv.slice(2), env = process.env, io = { writeFileSync, renameSync, mkdirSync, readFileSync }) {
  const flags = {
    write: argv.includes("--write"),
    allowLegacyAnonJwt: argv.includes("--allow-legacy-anon-jwt"),
  };
  const userDataIdx = argv.indexOf("--userData");
  const userData = userDataIdx !== -1 ? argv[userDataIdx + 1] : undefined;
  const noteIdx = argv.indexOf("--note");
  const note = noteIdx !== -1 ? argv[noteIdx + 1] : undefined;
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return { exitCode: 0 };
  }

  const verdict = buildCutoverProfile(env, { allowLegacyAnonJwt: flags.allowLegacyAnonJwt, note });
  if (!verdict.ok) {
    console.error(`✗ ${verdict.reason}\n\n${usage()}`);
    return { exitCode: 2 };
  }
  const profile = verdict.profile;
  const json = JSON.stringify(profile, null, 2) + "\n";

  if (!flags.write) {
    console.log("DRY-RUN (nothing written) — the profile that WOULD land:");
    console.log(json);
    console.log(`  target file: <userData>/${PROFILE_FILE_NAME}   (pass --write --userData <dir> to persist)`);
    console.log("  userData per OS:\n  " + userDataGuidance());
    console.log("  After writing: relaunch the app — the profile GOVERNS url/key/useSupabase in every build mode (T-573).");
    return { exitCode: 0, dryRun: true, profile };
  }

  if (!userData) {
    console.error(`✗ --write requires --userData <dir> — the app's userData directory:\n  ${userDataGuidance()}`);
    return { exitCode: 2 };
  }
  const targetPath = join(userData, PROFILE_FILE_NAME);
  // Preserve an existing profile as .bak (the rollback artifact — §A.5's
  // "what to clear / what to preserve" discipline: revert = restore the .bak
  // or delete the file; the factory default then governs again).
  let backupNote = "";
  try {
    const existing = io.readFileSync(targetPath, "utf8");
    if (existing.trim()) {
      const backupPath = targetPath + ".bak";
      io.writeFileSync(backupPath, existing, "utf8");
      backupNote = `  (previous profile preserved at ${backupPath})`;
    }
  } catch {
    // no existing file — nothing to back up
  }
  io.mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = targetPath + ".tmp";
  io.writeFileSync(tmpPath, json, "utf8");
  io.renameSync(tmpPath, targetPath);
  console.log(`✓ profile written: ${targetPath}${backupNote}`);
  console.log("  Relaunch the app — the profile GOVERNS url/key/useSupabase in every build mode (T-573).");
  console.log("  Rollback: restore the .bak (or delete the file) — the factory default governs again.");
  return { exitCode: 0, written: targetPath, profile };
}

// CLI entry (guarded so the vitest import exercises the pure surface only).
if (process.argv[1] && process.argv[1].endsWith("prepare-cutover-profile.mjs")) {
  const result = main();
  process.exit(result.exitCode ?? 0);
}
