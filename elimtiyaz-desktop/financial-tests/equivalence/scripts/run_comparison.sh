#!/usr/bin/env bash
# Run the comparator after both sides have produced results.
#
# Usage:
#   ./scripts/run_comparison.sh             # compare desktop vs android
#   ./scripts/run_comparison.sh --strict    # treat warnings as errors
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EQUIV_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$EQUIV_DIR/../.." && pwd)"
cd "$REPO_ROOT"

npx tsx financial-tests/equivalence/comparison/comparator.ts "$@"

echo ""
echo "─── Comparator complete ───"
echo "Reports: financial-tests/equivalence/reports/"
echo "Regression cases: financial-tests/equivalence/regression/"
