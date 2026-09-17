@echo off
setlocal

rem El-Imtiyaz Desktop — repository-root Windows EXE builder.
rem This script intentionally delegates to the desktop package's canonical
rem build pipeline so the same Electron/Vite/electron-builder configuration
rem is used from the repository root.

cd /d "%~dp0"
if errorlevel 1 (
  echo [build-windows] ERROR: Could not enter repository root.
  exit /b 1
)

if not exist "elimtiyaz-desktop\package.json" (
  echo [build-windows] ERROR: elimtiyaz-desktop\package.json was not found.
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [build-windows] ERROR: npm was not found on PATH.
  echo Install Node.js LTS and ensure npm is available in PATH.
  exit /b 1
)

cd /d "%~dp0elimtiyaz-desktop"
if errorlevel 1 (
  echo [build-windows] ERROR: Could not enter elimtiyaz-desktop.
  exit /b 1
)

echo [build-windows] Installing locked dependencies...
call npm ci
if errorlevel 1 (
  echo [build-windows] ERROR: npm ci failed.
  exit /b 1
)

echo [build-windows] Building Windows NSIS installer and portable EXE...
call npm run package:win
if errorlevel 1 (
  echo [build-windows] ERROR: Windows packaging failed.
  exit /b 1
)

echo.
echo [build-windows] SUCCESS.
echo [build-windows] Artifacts: %~dp0elimtiyaz-desktop\release\
exit /b 0
