#!/usr/bin/env bash
# Full pipeline: generate scenarios → run desktop → (optionally) run android → compare.
#
# Usage:
#   ./scripts/run_all.sh                 # desktop only + comparator (android must be run separately)
#   ./scripts/run_all.sh --sanity        # desktop + copy desktop results to android + compare (self-check)
#   ./scripts/run_all.sh --with-android  # also run android side via gradle
#
# This is the recommended entry point. It runs the full desktop pipeline
# and produces a fresh equivalence report.
#
# For a TRUE cross-platform verification:
#   1. Run this script (produces desktop results)
#   2. Run the Android side via `./scripts/run_android.sh` (produces android results)
#   3. Run `./scripts/run_comparison.sh` (compares both)
#
# For a desktop-only sanity check (verifies the framework works):
#   ./scripts/run_all.sh --sanity
#   This copies desktop results to android results and compares them.
#   Should produce 100% equivalence (since they're the same data).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EQUIV_DIR="$(dirname "$SCRIPT_DIR")"

SANITY=false
WITH_ANDROID=false
for arg in "$@"; do
  case "$arg" in
    --sanity) SANITY=true ;;
    --with-android) WITH_ANDROID=true ;;
  esac
done

# 1. Run desktop side (generates + runs).
bash "$SCRIPT_DIR/run_desktop.sh"

# 2. Optionally run Android side.
if $WITH_ANDROID; then
  echo ""
  echo "─── Running Android side ───"
  bash "$SCRIPT_DIR/run_android.sh" || {
    echo "WARNING: Android side failed. Comparator will run with desktop-only results."
  }
elif $SANITY; then
  # Sanity check: copy desktop results to android dir, then compare.
  # This verifies the framework itself works (desktop vs desktop copy = 100% equivalence).
  echo ""
  echo "─── Sanity check: copying desktop results to android dir ───"
  mkdir -p "$EQUIV_DIR/results/android"
  cp "$EQUIV_DIR/results/desktop/"*.json "$EQUIV_DIR/results/android/"
  echo "    (Desktop results copied to android dir for self-comparison)"
fi

# 3. Run comparator.
echo ""
echo "─── Running comparator ───"
bash "$SCRIPT_DIR/run_comparison.sh"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Full pipeline complete."
echo "View the latest report:"
echo "  ls -t $EQUIV_DIR/reports/*.md | head -1"
echo "═══════════════════════════════════════════════════════════════"
