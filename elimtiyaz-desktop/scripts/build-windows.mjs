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
 * Supabase credentials are not packaged; the desktop app reads its backend
 * configuration at runtime as documented by the project operating manual.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

function run(command, args) {
  console.log(`\n[package:win] > ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: projectDir,
    stdio: "inherit",
    env: process.env,
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

// Remove stale release output so verification can never accidentally pass
// because an older EXE is still present.
rmSync(releaseDir, { recursive: true, force: true });

// The existing dist:win command is the canonical build pipeline:
// Vite renderer -> Electron TypeScript -> electron-builder Windows targets.
run(npm, ["run", "dist:win", "--", "--publish", "never"]);

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
console.log("  - No generated .env files in packaged payloads");
console.log("");
console.log("Output directory: release/");
