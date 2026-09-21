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

const scriptDir = join(fileURLToPath(new URL(".", import.meta.url)));
const projectDir = join(scriptDir, "..");
const packagePath = join(projectDir, "package.json");
const lockPath = join(projectDir, "package-lock.json");
const releaseDir = join(projectDir, "release");

const CANONICAL_SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";

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

async function verifyCanonicalSupabase(url, publicKey) {
  try {
    const response = await fetch(`${url}/rest/v1/tenants?select=id&limit=1`, {
      headers: { apikey: publicKey },
    });
    if (!response.ok) {
      fail(
        `Canonical Supabase preflight rejected the configured public key (HTTP ${response.status}). ` +
          "The Windows package was not built.",
      );
    }
  } catch (error) {
    fail(
      `Canonical Supabase preflight failed: ${error instanceof Error ? error.message : String(error)}. ` +
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

// Resolve the public key from the project's actual environment conventions.
// Prefer VITE_* values used by the renderer; also support the canonical
// SUPABASE_* names used by the shared deployment configuration.
//
// Deterministic default (publishable PUBLIC key only — safe to embed in the
// client bundle; never a secret/service-role key): the canonical NEW project
// vebfehrpzajhstyhinnw. An explicit env value (VITE_* file, SUPABASE_* or
// process env) overrides this default; an explicit non-empty but FOREIGN
// project key is a hard failure (fail-closed: never package a production
// build against the wrong backend).
const CANONICAL_PUBLIC_KEYS = new Set([
  "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg",
]);
const { loadEnv } = await import("vite");
const viteEnv = loadEnv("production", projectDir, "VITE_");
const allEnv = loadEnv("production", projectDir, "");
const explicitPublicKey = (
  viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY ??
  viteEnv.VITE_SUPABASE_ANON_KEY ??
  allEnv.SUPABASE_PUBLISHABLE_KEY ??
  allEnv.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY
)?.trim();
if (explicitPublicKey && !CANONICAL_PUBLIC_KEYS.has(explicitPublicKey)) {
  fail(
    "Refusing to package: the configured public Supabase key does not match " +
      "the canonical NEW project (vebfehrpzajhstyhinnw). Remove the override " +
      "or set the canonical sb_publishable_ key.",
  );
}
const resolvedPublicKey =
  explicitPublicKey || "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";

if (!resolvedPublicKey) {
  fail(
    "No public Supabase key could be resolved. Set SUPABASE_PUBLISHABLE_KEY/SUPABASE_ANON_KEY " +
      "or the VITE_* equivalent before packaging.",
  );
}

if (/^(?:changeme|change-me|your[-_]?key|placeholder|replace[-_]?me)$/i.test(resolvedPublicKey)) {
  fail("The resolved public Supabase key is still a placeholder. The Windows package was not built.");
}

console.log(`\n[package:win] Supabase target: ${CANONICAL_SUPABASE_URL}`);
console.log("[package:win] Supabase mode : forced production / live Supabase");
console.log("[package:win] Public key   : resolved (value hidden)");

await verifyCanonicalSupabase(CANONICAL_SUPABASE_URL, resolvedPublicKey);
console.log("[package:win] Canonical Supabase preflight: OK");

const buildEnv = {
  ...process.env,
  VITE_SUPABASE_URL: CANONICAL_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: resolvedPublicKey,
  VITE_SUPABASE_ANON_KEY: resolvedPublicKey,
  VITE_USE_SUPABASE: "true",
  VITE_DESKTOP_PRODUCTION: "true",
};

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

rmSync(releaseDir, { recursive: true, force: true });
if (wineAvailable) {
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

if (wineAvailable) {
  assertFile(setupPath, "Windows NSIS installer");
  const setupSize = statSync(setupPath).size;
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
  CANONICAL_SUPABASE_URL,
  "Canonical Supabase URL",
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
if (wineAvailable) {
  hashLines.unshift(`${sha256(setupPath)}  ${expectedSetup}`);
}
const hashes = hashLines.join("\n") + "\n";
const hashesPath = join(releaseDir, "SHA256SUMS.txt");
writeFileSync(hashesPath, hashes, "utf8");

console.log("\n============================================================");
console.log(" WINDOWS PACKAGE VERIFIED");
console.log("============================================================");
if (wineAvailable) {
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
console.log(`  - Canonical Supabase production project: ${CANONICAL_SUPABASE_URL}`);
console.log("  - No generated .env files in packaged payloads");
console.log("");
console.log("Output directory: release/");
