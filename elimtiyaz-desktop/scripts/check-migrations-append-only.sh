#!/usr/bin/env bash
# ============================================================================
# check-migrations-append-only.sh — T-058 (REG-001) process guard
# ============================================================================
# Enforces the append-only migration discipline that AGENTS.md §15.9 and
# docs/recovery/recovery-rules.md prescribe for the canonical chain
# (elimtiyaz-desktop/supabase/migrations/ — ADR-001):
#
#   1. WORKING TREE/INDEX: no modification, deletion or rename of an
#      EXISTING migration file. New (untracked/staged-add) files are fine —
#      that is what "append-only" means. Schema changes are NEW migrations
#      with the next free number; already-applied files are forensic
#      evidence (the ARCH-011 lesson: silent edits desync live databases
#      from the committed chain).
#   2. BASELINE DIFF: git diff --name-status <base> -- <migrations> must
#      contain ONLY additions ('A'). Base defaults to the upstream branch
#      (origin/main) when present — exactly the PR check the task
#      prescribes — and falls back to HEAD (working-tree-only guard).
#   3. HEADER DISCIPLINE: every migration file (tracked or new) must start
#      with a `--` SQL comment line naming the migration (what/why), and
#      must match NNNN_name.sql (4-digit zero-padded prefix, .sql).
#
# Usage:
#   scripts/check-migrations-append-only.sh [--dir <migrations-dir>] [--base <git-ref>]
#
#     --dir   migrations directory to guard
#             (default: <script-dir>/../supabase/migrations)
#     --base  git ref to diff against (default: origin/<upstream> or HEAD)
#
# Exit codes:
#   0 — guard passed (chain is append-only + headers well-formed)
#   1 — violations found (listed on stderr)
#   2 — environment/usage error (not usable as a repo)
#
# Wired into the desktop suite via
# src/tests/infrastructure/t-058-migration-append-only.test.ts (npm test).
# Standalone: npm run check:migrations (or bash scripts/…sh in a PR check).
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_DIR="$SCRIPT_DIR/../supabase/migrations"
MIG_DIR=""
BASE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)  MIG_DIR="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "usage: $0 [--dir <migrations-dir>] [--base <git-ref>]" >&2; exit 2 ;;
  esac
done

MIG_DIR="${MIG_DIR:-$DEFAULT_DIR}"
# Resolve the nearest EXISTING ancestor so a fully deleted migrations
# directory is still diagnosable (git rm prunes empty dirs).
PROBE="$MIG_DIR"
while [[ ! -d "$PROBE" ]] && [[ "$PROBE" != "/" ]]; do PROBE="$(dirname "$PROBE")"; done
REPO_ROOT="$(git -C "$PROBE" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "GUARD ERROR: $MIG_DIR is not inside a git repository" >&2
  exit 2
}
# Pathspec relative to the repo root.
MIG_REL="${MIG_DIR#"$REPO_ROOT"/}"

if [[ -z "$BASE" ]]; then
  UPSTREAM="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [[ -n "$UPSTREAM" ]] && git -C "$REPO_ROOT" rev-parse --verify --quiet "$UPSTREAM" >/dev/null 2>&1; then
    BASE="$UPSTREAM"
  elif git -C "$REPO_ROOT" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    BASE="origin/main"
  else
    BASE="HEAD"
  fi
fi
git -C "$REPO_ROOT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null 2>&1 || {
  echo "GUARD ERROR: --base ref does not resolve: $BASE" >&2
  exit 2
}

VIOLATIONS=()

if [[ ! -d "$MIG_DIR" ]]; then
  # The migrations directory itself is gone: if the base knew files under
  # it, that is a wholesale deletion — a violation, not an env error.
  if [[ -n "$(git -C "$REPO_ROOT" ls-tree -r --name-only "$BASE" -- "$MIG_REL" 2>/dev/null)" ]] \
     || [[ -n "$(git -C "$REPO_ROOT" ls-files -- "$MIG_REL" 2>/dev/null)" ]]; then
    VIOLATIONS+=("worktree: the migrations directory itself is deleted: $MIG_REL")
  else
    echo "GUARD ERROR: migrations directory not found: $MIG_DIR" >&2
    exit 2
  fi
fi

# --- Check 1: working tree / index ------------------------------------------
# Allowed statuses: '??' (new file) and 'A?' (new file, staged — any worktree
# state on a NEW file is fine; it has never been applied anywhere).
# Denied: anything where an EXISTING (tracked) file is modified, deleted or
# renamed — X in {M,D,R,C}, or X=' ' with Y in {M,D,R,C} (unstaged).
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  X="${line:0:1}"; Y="${line:1:1}"; ENTRY="${line:3}"
  if [[ "$X" == "?" ]]; then
    continue # new untracked migration — allowed (checked for header below)
  fi
  if [[ "$X" == "A" ]]; then
    if [[ "$Y" =~ [DRC] ]]; then
      VIOLATIONS+=("worktree: staged-new migration later deleted/renamed: $ENTRY")
    fi
    continue # new staged migration — allowed
  fi
  if [[ "$X" =~ [MDRC] ]] || { [[ "$X" == " " ]] && [[ "$Y" =~ [MDRC] ]]; }; then
    VIOLATIONS+=("worktree: existing migration modified/deleted/renamed (status '${X}${Y}'): $ENTRY")
  fi
done < <(git -C "$REPO_ROOT" status --porcelain -- "$MIG_REL")

# --- Check 2: baseline diff (additions only) ---------------------------------
while IFS=$'\t' read -r status file; do
  [[ -z "${status:-}" ]] && continue
  if [[ "$status" != "A" ]]; then
    VIOLATIONS+=("diff vs $BASE: migration not added but '${status}': $file")
  fi
done < <(git -C "$REPO_ROOT" diff --name-status "$BASE" -- "$MIG_REL")

# --- Check 3: header + naming discipline ------------------------------------
shopt -s nullglob
for f in "$MIG_DIR"/*.sql; do
  base="$(basename "$f")"
  if [[ ! "$base" =~ ^[0-9]{4}_.+\.sql$ ]]; then
    VIOLATIONS+=("naming: migration must match NNNN_name.sql: $base")
  fi
  first="$(head -n 1 "$f")"
  if [[ "${first:0:2}" != "--" ]]; then
    VIOLATIONS+=("header: migration must start with a '--' comment (what/why): $base")
  fi
done
shopt -u nullglob

# --- Result -------------------------------------------------------------------
if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo "MIGRATION APPEND-ONLY GUARD FAILED (${#VIOLATIONS[@]} violation(s)):" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  - $v" >&2
  done
  echo "Rule (AGENTS.md §15.9 / ADR-001): already-applied migrations are NEVER edited —" >&2
  echo "ship a NEW migration with the next free number instead." >&2
  exit 1
fi

ADDED_STATUS="$(git -C "$REPO_ROOT" status --porcelain -- "$MIG_REL" | grep -cE '^\?\?|^A' || true)"
ADDED_DIFF="$(git -C "$REPO_ROOT" diff --name-status "$BASE" -- "$MIG_REL" | grep -cE $'^A\t' || true)"
FILES="$(ls -1 "$MIG_DIR"/*.sql 2>/dev/null | wc -l)"
echo "append-only guard OK: $FILES migration file(s), +${ADDED_DIFF:-0} added vs $BASE, +${ADDED_STATUS:-0} new in worktree."
exit 0
