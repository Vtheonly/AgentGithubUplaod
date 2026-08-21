#!/usr/bin/env bash
# Run the desktop side of the equivalence test suite.
#
# Usage:
#   ./scripts/run_desktop.sh                # run all (hand-crafted + generated)
#   ./scripts/run_desktop.sh --no-generated  # run only hand-crafted scenarios
#
# Prerequisites:
#   - npm install (installs tsx)
#   - npx tsx available
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EQUIV_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$EQUIV_DIR/../.." && pwd)"
cd "$REPO_ROOT"

INCLUDE_GENERATED=true
if [[ "${1:-}" == "--no-generated" ]]; then
  INCLUDE_GENERATED=false
fi

# 1. Generate scenarios (deterministic — seed=42 → same scenarios every run)
echo "─── Generating scenarios ───"
npx tsx financial-tests/equivalence/generators/scenario_generator.ts \
  --count=500 --seed=42

# 2. Run the desktop engine on all scenarios
echo ""
echo "─── Running desktop engine ───"
if $INCLUDE_GENERATED; then
  npx tsx financial-tests/equivalence/desktop/desktop_runner.ts --generated
else
  npx tsx financial-tests/equivalence/desktop/desktop_runner.ts
fi

echo ""
echo "─── Desktop side complete ───"
echo "Results: financial-tests/equivalence/results/desktop/"
