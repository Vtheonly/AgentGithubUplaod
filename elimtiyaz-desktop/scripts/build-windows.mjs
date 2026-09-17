#!/usr/bin/env node

/**
 * Reproducible Windows packaging entry point.
 *
 * This script intentionally delegates the actual packaging to the existing
 * electron-builder configuration in package.json. It adds a preflight and a
 * post-build verification layer so a successful command means the expected
 * Windows artifacts and packaged application payload were actually emitted.
 *
 * Usage:
 *   npm run package:win
 *
 * The first run automatically performs `npm ci` when node_modules is missing.
 * The production Windows build is explicitly bound to the canonical El-Imtiyaz
 * Supabase project. The public Supabase key is resolved from the same production
 * Vite env loading rules used by `vite build`, but is never printed.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = join(fileURLToPath(new URL(".", import.meta.url)));
const projectDir = join(scriptDir, "..");
const packagePath = join(projectDir, "package.json");
const lockPath = join(projectDir, "package-lock.json");
const releaseDir = join(projectDir, "release");

const CANONICAL_SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co";

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

async function verifyCanonicalSupabase(url, anonKey) {
  try {
    const response = await fetch(`${url}/rest/v1/tenants?select=id&limit=1`, {
      headers: {
        apikey: anonKey,
      },
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

// Resolve Vite's production env using Vite itself so .env, .env.local,
// .env.production, and .env.production.local follow the same precedence as
// the subsequent `vite build`. Existing process.env values keep highest priority.
const { loadEnv } = await import("vite");
const viteEnv = loadEnv("production", projectDir, "VITE_");
const resolvedAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY?.trim();

if (!resolvedAnonKey) {
  fail(
    "VITE_SUPABASE_ANON_KEY could not be resolved from the production Vite environment. " +
      "Configure the public Supabase key in the local production env before packaging.",
  );
}

if (/^(?:changeme|change-me|your[-_]?key|placeholder|replace[-_]?me)$/i.test(resolvedAnonKey)) {
  fail("VITE_SUPABASE_ANON_KEY still contains a placeholder value. The Windows package was not built.");
}

console.log(`\n[package:win] Supabase target: ${CANONICAL_SUPABASE_URL}`);
console.log("[package:win] Supabase mode : forced production / live Supabase");
console.log("[package:win] Public key   : resolved (value hidden)");

await verifyCanonicalSupabase(CANONICAL_SUPABASE_URL, resolvedAnonKey);
console.log("[package:win] Canonical Supabase preflight: OK");

const buildEnv = {
  ...process.env,
  VITE_SUPABASE_URL: CANONICAL_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: resolvedAnonKey,
  VITE_USE_SUPABASE: "true",
  VITE_DESKTOP_PRODUCTION: "true",
};

// Remove stale release output so verification can never accidentally pass
// because an older EXE is still present.
rmSync(releaseDir, { recursive: true, force: true });

// The existing dist:win command is the canonical build pipeline:
// Vite renderer -> Electron TypeScript -> electron-builder Windows targets.
run(npm, ["run", "dist:win", "--", "--publish", "never"], buildEnv);

const version = pkg.version;
const productName = pkg.productName ?? build.productName ?? "El-Imtiyaz Desktop";
const expectedSetup = `${productName}-${version}-win-x64-setup.exe`;
const expectedPortable = `${productName}-${version}-win-x64-portable.exe`;

const setupPath = join(releaseDir, expectedSetup);
const portablePath = join(releaseDir, expectedPortable);
const unpackedDir = join(releaseDir, "win-unpacked");
const unpackedExe = join(unpackedDir, `${productName}.exe`);
const asarPath = join(unpackedDir, "resources", "app.asar");

assertFile(setupPath, "Windows NSIS installer");
assertFile(portablePath, "Windows portable executable");
assertDir(unpackedDir, "Windows unpacked application directory");
assertFile(unpackedExe, "unpacked Windows executable");
assertFile(asarPath, "packaged ASAR archive");

const setupSize = statSync(setupPath).size;
const portableSize = statSync(portablePath).size;
const asarSize = statSync(asarPath).size;

if (setupSize < 5 * 1024 * 1024) fail(`NSIS installer is unexpectedly small (${setupSize} bytes).`);
if (portableSize < 5 * 1024 * 1024) fail(`Portable executable is unexpectedly small (${portableSize} bytes).`);
if (asarSize < 512 * 1024) fail(`ASAR archive is unexpectedly small (${asarSize} bytes).`);

// Verify that build-stage payloads exist before packaging and that no .env file
// was accidentally copied into either of the packaged source trees.
for (const payload of ["dist", "dist-electron"]) {
  assertDir(join(projectDir, payload), `Build payload ${payload}`);
}

const forbiddenEnvNames = new Set([".env", ".env.local", ".env.production", ".env.development"]);
for (const payload of ["dist", "dist-electron"]) {
  const payloadText = relative(projectDir, join(projectDir, payload));
  // The packaging file allow-list already excludes project-root .env files.
  // This explicit path check catches accidental generated env files in the
  // directories that are intentionally packaged.
  for (const name of forbiddenEnvNames) {
    if (existsSync(join(projectDir, payload, name))) {
      fail(`Refusing to package a generated secret file: ${payloadText}/${name}`);
    }
  }
}

// The canonical project URL must actually be present in the built renderer.
// This catches a future packaging regression where the enforced build env is
// accidentally dropped before Vite substitutes import.meta.env values.
assertPayloadContainsText(
  join(projectDir, "dist"),
  CANONICAL_SUPABASE_URL,
  "Canonical Supabase URL",
);

const hashes = [
  `${sha256(setupPath)}  ${expectedSetup}`,
  `${sha256(portablePath)}  ${expectedPortable}`,
].join("\n") + "\n";
const hashesPath = join(releaseDir, "SHA256SUMS.txt");
writeFileSync(hashesPath, hashes, "utf8");

console.log("\n============================================================");
console.log(" WINDOWS PACKAGE VERIFIED");
console.log("============================================================");
console.log(`Installer : ${expectedSetup} (${Math.round(setupSize / 1024 / 1024)} MB)`);
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
console.log("  - Canonical Supabase production project enforced at build time");
console.log("  - No generated .env files in packaged payloads");
console.log("");
console.log("Output directory: release/");
