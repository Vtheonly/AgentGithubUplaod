#!/usr/bin/env node

/**
 * Reproducible Windows packaging entry point.
 *
 * This script delegates the actual packaging to electron-builder and adds
 * preflight/post-build checks so a successful command means the expected
 * Windows artifacts and the correct live backend binding were emitted.
 *
 * Supabase secret/service-role keys are never read or packaged here.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// T-573 (the OPS-016 unlock): the target-readiness resolution + probe.
import {
  isValidTargetKey,
  isValidTargetUrl,
  probeTargetReadiness,
  resolvePackageTarget,
} from "./package-target.mjs";
// T-575 (the OPS-016 unlock, the deep gate): the preflight of record.
import { runPreflight } from "./preflight-target.mjs";

const scriptDir = join(fileURLToPath(new URL(".", import.meta.url)));
const projectDir = join(scriptDir, "..");
const packagePath = join(projectDir, "package.json");
const lockPath = join(projectDir, "package-lock.json");
const releaseDir = join(projectDir, "release");

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

function fail(message) {
  console.error(`\n[package:win] ERROR: ${message}`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  console.log(`\n[package:win] > ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
    env,
  });
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`${label} is missing: ${relative(projectDir, path)}`);
  }
}

function assertDir(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(`${label} is missing: ${relative(projectDir, path)}`);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertPayloadContainsText(rootPath, expectedText, label) {
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!/\.(?:js|html|css|map)$/.test(entry.name)) continue;
      const text = readFileSync(entryPath, "utf8");
      if (text.includes(expectedText)) return;
    }
  }
  fail(`${label} was not found in the generated renderer payload.`);
}

async function verifyTargetReadiness(url, publicKey) {
  // T-573: the preflight probes THE RESOLVED TARGET (readiness, not the
  // canonical identity). A quota-blocked target (402) fails honestly and
  // points the owner at EL_IMTIYAZ_TARGET_URL / the G2 action.
  const verdict = await probeTargetReadiness(url, publicKey);
  if (!verdict.ok) {
    fail(
      `Target-readiness preflight rejected the packaged target (HTTP ${verdict.status}). ${verdict.detail} ` +
        "The Windows package was not built.",
    );
  }
}

console.log("============================================================");
console.log(" El-Imtiyaz Desktop — Windows EXE Packager");
console.log("============================================================");

assertFile(packagePath, "package.json");
assertFile(lockPath, "package-lock.json");

const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const build = pkg.build ?? {};
const winTargets = Array.isArray(build.win?.target) ? build.win.target : [];
const targetNames = winTargets.map((target) =>
  typeof target === "string" ? target : target?.target,
);

if (!targetNames.includes("nsis") || !targetNames.includes("portable")) {
  fail("package.json must define both NSIS and portable Windows targets.");
}

const hasX64 = winTargets.every((target) => {
  if (typeof target === "string") return true;
  return Array.isArray(target?.arch) && target.arch.includes("x64");
});
if (!hasX64) {
  fail("Every Windows target must include the x64 architecture.");
}

if (build.directories?.output !== "release") {
  fail('package.json build.directories.output must be "release".');
}

if (build.asar !== undefined && build.asar !== true) {
  fail("ASAR packaging must remain enabled so the complete app payload is bundled.");
}

const files = Array.isArray(build.files) ? build.files : [];
for (const requiredPattern of ["dist/**/*", "dist-electron/**/*"]) {
  if (!files.includes(requiredPattern)) {
    fail(`package.json build.files is missing required payload: ${requiredPattern}`);
  }
}

const iconPath = join(projectDir, build.win?.icon ?? "resources/icon.ico");
assertFile(iconPath, "Windows application icon");
assertFile(join(projectDir, "electron", "main.cts"), "Electron main process source");
assertFile(join(projectDir, "electron", "preload.cts"), "Electron preload source");
assertFile(join(projectDir, "vite.config.ts"), "Vite configuration");

if (!existsSync(join(projectDir, "node_modules"))) {
  console.log("\n[package:win] node_modules not found; running reproducible npm ci first.");
  run(npm, ["ci"]);
}

// T-573 — resolve the packaged TARGET (target-readiness, NOT canonical
// identity): EL_IMTIYAZ_TARGET_URL/KEY win, then the VITE_* / SUPABASE_* env
// chain, then the FACTORY DEFAULT (the canonical project — identical to the
// pre-T-573 behavior when nothing is set). The foreign-key hard-fail rule is
// GONE: re-pointing a packaged build at a healthy target is the whole point
// (the RUNTIME re-point without a rebuild is the BackendProfile's job —
// electron/backend-profile-contract.ts). Deterministic default = the
// canonical public key (PUBLIC only — a secret/service-role key is still a
// hard failure via isValidTargetKey).
const { loadEnv } = await import("vite");
const viteEnv = loadEnv("production", projectDir, "VITE_");
const allEnv = loadEnv("production", projectDir, "");
const target = resolvePackageTarget({ processEnv: process.env, viteEnv, allEnv });
const resolvedPublicKey = target.key;

if (!isValidTargetUrl(target.url)) {
  fail(
    `The resolved target URL is not a valid https origin: ${target.url}. ` +
      "Set EL_IMTIYAZ_TARGET_URL (or VITE_SUPABASE_URL) to a healthy Supabase project.",
  );
}
if (!resolvedPublicKey || !isValidTargetKey(resolvedPublicKey)) {
  fail(
    "No valid PUBLIC Supabase key could be resolved (or the value is still a placeholder/secret). " +
      "Set EL_IMTIYAZ_TARGET_KEY / SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY or the VITE_* equivalent before packaging.",
  );
}

console.log(`\n[package:win] Supabase target: ${target.url} (${target.source})`);
console.log("[package:win] Supabase mode : forced production / live Supabase (re-pointable at runtime via backend-profile.json)");
console.log("[package:win] Public key   : resolved (value hidden)");

await verifyTargetReadiness(target.url, resolvedPublicKey);
console.log("[package:win] Target-readiness preflight: OK");

// T-575 — the PREFLIGHT OF RECORD (the deep target-parity gate after T-573's
// quick readiness probe): the consolidated-baseline census + the 54001 RLS-helper
// parity + verify_t-376 12/12 (the T-446 Management-SQL convention) + the
// authenticated REST smoke + the local repo lanes (the ARCH-046 EF 1:1 census,
// the append-only guard, the 0001 layout). The management token is read by the
// preflight tool from the OPERATOR's environment (SUPABASE_ACCESS_TOKEN) —
// never by the packager beyond this pass-through, never packaged; an absent
// token fails CLOSED. These remote lanes execute ONLY here, inside a real
// packaging run (the t-573 precedent; OPS-015's zero-live-traffic fence).
const preflight = await runPreflight({
  targetUrl: target.url,
  publicKey: resolvedPublicKey,
  processEnv: process.env,
  repoDir: projectDir,
});
if (!preflight.ok) {
  fail(
    `T-575 preflight of record REJECTED the target — "N/N migrations applied" is NOT parity. ` +
      `Failures: ${preflight.failures.join(" | ")}. The Windows package was not built.`,
  );
}
console.log(`[package:win] T-575 preflight of record: OK (${preflight.summary})`);

const buildEnv = {
  ...process.env,
  VITE_SUPABASE_URL: target.url,
  VITE_SUPABASE_PUBLISHABLE_KEY: resolvedPublicKey,
  VITE_SUPABASE_ANON_KEY: resolvedPublicKey,
  VITE_USE_SUPABASE: "true",
  VITE_DESKTOP_PRODUCTION: "true",
};
// T-575: the management token is OPERATOR-only — it must never flow into the
// build children (or their logs/artifacts).
delete buildEnv.SUPABASE_ACCESS_TOKEN;

// T-404 (2026-09-22) — wine-aware cross-build:
//   * rcedit (icon/version resource edits on the exe) needs wine on Linux
//     → skipped via signAndEditExecutable=false when wine is absent
//     (signing was never configured; the raw exe keeps Electron defaults).
//   * The NSIS SETUP target executes the built installer under wine to
//     extract the uninstaller (app-builder-lib NsisTarget) → without wine
//     ONLY the PORTABLE target is built. A wine-equipped or native-Windows
//     host builds both via the same script (npm run package:win).
const wineAvailable = (() => {
  try {
    execFileSync("which", ["wine"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      execFileSync("which", ["wine64"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
})();

// A native Windows runner does not need Wine to build the NSIS installer.
const canBuildNsis = isWindows || wineAvailable;

rmSync(releaseDir, { recursive: true, force: true });
if (canBuildNsis) {
  run(npm, ["run", "dist:win", "--", "--publish", "never"], buildEnv);
} else {
  console.log(
    "[package:win] wine not found — building the Windows x64 PORTABLE executable only " +
      "(signAndEditExecutable=false; the NSIS setup target requires wine to extract the " +
      "uninstaller — run the same script on a wine-equipped or Windows host for the installer).",
  );
  run(npm, ["run", "build"], buildEnv);
  run(npm, ["run", "build:electron"], buildEnv);
  execFileSync(
    npm,
    ["exec", "--", "electron-builder", "--win", "portable", "--publish", "never",
      "--config.win.signAndEditExecutable=false"],
    { cwd: projectDir, stdio: "inherit", env: buildEnv },
  );
}

const version = pkg.version;
const productName = pkg.productName ?? build.productName ?? "El-Imtiyaz Desktop";
const expectedSetup = `${productName}-${version}-win-x64-setup.exe`;
const expectedPortable = `${productName}-${version}-win-x64-portable.exe`;
const setupPath = join(releaseDir, expectedSetup);
const portablePath = join(releaseDir, expectedPortable);
const unpackedDir = join(releaseDir, "win-unpacked");
const unpackedExe = join(unpackedDir, `${productName}.exe`);
const asarPath = join(unpackedDir, "resources", "app.asar");

// NOTE (T-506 smoke-run fix): `setupSize` used to be declared with `const` INSIDE
// the `if (wineAvailable)` block below while the final summary referenced it from
// the outer scope → `ReferenceError: setupSize is not defined` on every
// wine-equipped host, AFTER the artifacts and SHA256SUMS.txt were already
// written. The build is correct; the reporting tail crashed and the script exited
// non-zero. Declared here so both scopes see the same binding.
let setupSize = 0;

if (canBuildNsis) {
  assertFile(setupPath, "Windows NSIS installer");
  setupSize = statSync(setupPath).size;
  if (setupSize < 5 * 1024 * 1024) fail(`NSIS installer is unexpectedly small (${setupSize} bytes).`);
}
assertFile(portablePath, "Windows portable executable");
assertDir(unpackedDir, "Windows unpacked application directory");
assertFile(unpackedExe, "unpacked Windows executable");
assertFile(asarPath, "packaged ASAR archive");

const portableSize = statSync(portablePath).size;
const asarSize = statSync(asarPath).size;
if (portableSize < 5 * 1024 * 1024) fail(`Portable executable is unexpectedly small (${portableSize} bytes).`);
if (asarSize < 512 * 1024) fail(`ASAR archive is unexpectedly small (${asarSize} bytes).`);

for (const payload of ["dist", "dist-electron"]) {
  assertDir(join(projectDir, payload), `Build payload ${payload}`);
}

const forbiddenEnvNames = new Set([".env", ".env.local", ".env.production", ".env.development"]);
for (const payload of ["dist", "dist-electron"]) {
  const payloadText = relative(projectDir, join(projectDir, payload));
  for (const name of forbiddenEnvNames) {
    if (existsSync(join(projectDir, payload, name))) {
      fail(`Refusing to package a generated secret file: ${payloadText}/${name}`);
    }
  }
}

assertPayloadContainsText(
  join(projectDir, "dist"),
  target.url,
  "The packaged backend target URL",
);

// T-404 (packaging gate): the bundled native timetable solver MUST be in
// the packaged renderer payload — generation on the target machine depends
// on NOTHING from the developer environment (ADR-020 §4).
assertPayloadContainsText(
  join(projectDir, "dist"),
  "ts-greedy-v1",
  "Bundled native timetable solver (ts-greedy-v1)",
);

// And inside the PACKAGED ASAR archive itself (the portable .exe payload).
{
  const asarList = execFileSync(
    process.execPath,
    [join(projectDir, "node_modules", "@electron", "asar", "bin", "asar.js"), "list", asarPath],
    { encoding: "utf8" },
  );
  const bundleFiles = asarList
    .split("\n")
    .filter((line) => /^\/dist\/assets\/index-.*\.js$/.test(line.trim()));
  if (bundleFiles.length === 0) {
    fail("No renderer bundle found inside the packaged ASAR archive.");
  }
  let solverFound = false;
  for (const bundleFile of bundleFiles) {
    // extract-file writes the file under its BASENAME into the cwd.
    const extractTarget = join(releaseDir, basename(bundleFile.trim()));
    execFileSync(
      process.execPath,
      [join(projectDir, "node_modules", "@electron", "asar", "bin", "asar.js"),
        // NOTE: @electron/asar extract-file wants the path WITHOUT the
        // leading slash (the list output includes it, extract-file does not).
        "extract-file", asarPath, bundleFile.trim().replace(/^\//, "")],
      { cwd: releaseDir, stdio: "ignore" },
    );
    if (existsSync(extractTarget) && readFileSync(extractTarget, "utf8").includes("ts-greedy-v1")) {
      solverFound = true;
    }
    rmSync(extractTarget, { force: true });
  }
  if (!solverFound) {
    fail("Bundled native timetable solver (ts-greedy-v1) was NOT found inside the packaged ASAR.");
  }
  console.log("[package:win] T-404 solver-in-ASAR check: OK");
}

const hashLines = [`${sha256(portablePath)}  ${expectedPortable}`];
if (canBuildNsis) {
  hashLines.unshift(`${sha256(setupPath)}  ${expectedSetup}`);
}
const hashes = hashLines.join("\n") + "\n";
const hashesPath = join(releaseDir, "SHA256SUMS.txt");
writeFileSync(hashesPath, hashes, "utf8");

// T-506 (2026-09-30): ship the one-click Windows launch smoke test NEXT TO the
// executables, so the owner can prove the build runs on a real PC without any
// command line. The tracked source lives in scripts/; release/ is gitignored, so
// it must be copied on every build or it silently goes missing from the delivery.
const smokeSource = join(projectDir, "scripts", "smoke-test-windows.cmd");
if (existsSync(smokeSource)) {
  const smokeTarget = join(releaseDir, "smoke-test-windows.cmd");
  writeFileSync(smokeTarget, readFileSync(smokeSource, "utf8"), "utf8");
  console.log("[package:win] Windows launch smoke test copied into release/.");
} else {
  fail("scripts/smoke-test-windows.cmd is missing — the delivery would ship without a launch test.");
}

console.log("\n============================================================");
console.log(" WINDOWS PACKAGE VERIFIED");
console.log("============================================================");
if (canBuildNsis) {
  console.log(`Installer : ${expectedSetup} (${Math.round(setupSize / 1024 / 1024)} MB)`);
} else {
  console.log("Installer : SKIPPED (wine unavailable on this host — run on a wine/Linux or Windows host for the NSIS setup.exe)");
}
console.log(`Portable  : ${expectedPortable} (${Math.round(portableSize / 1024 / 1024)} MB)`);
console.log(`ASAR      : ${relative(projectDir, asarPath)} (${Math.round(asarSize / 1024 / 1024)} MB)`);
console.log(`Checksums : ${relative(projectDir, hashesPath)}`);
console.log("");
console.log("Packaged payload coverage:");
console.log("  - Vite React renderer: dist/**/*");
console.log("  - Electron main/preload: dist-electron/**/*");
console.log("  - Production npm dependencies: electron-builder application dependency packaging");
console.log("  - Electron/Chromium runtime: provided by electron-builder");
console.log("  - Windows icon: resources/icon.ico");
console.log(`  - Packaged backend target (readiness-probed): ${target.url}`);
console.log("  - No generated .env files in packaged payloads");
console.log("");
console.log("Output directory: release/");
