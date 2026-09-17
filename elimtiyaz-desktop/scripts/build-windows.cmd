@echo off
setlocal

rem El-Imtiyaz Desktop - Windows EXE build entry point.
rem The canonical packaging logic lives in build-windows.mjs so CI, Linux,
rem macOS, and Windows all use the same validation and electron-builder flow.

cd /d "%~dp0.."
if errorlevel 1 exit /b 1

where npm >nul 2>&1
if errorlevel 1 (
  echo [build-windows] ERROR: npm was not found on PATH.
  exit /b 1
)

echo [build-windows] Installing/validating locked dependencies...
npm ci
if errorlevel 1 exit /b 1

echo [build-windows] Building verified NSIS and portable Windows artifacts...
npm run package:win
if errorlevel 1 exit /b 1

echo.
echo [build-windows] SUCCESS: Windows artifacts are available in release\
exit /b 0
