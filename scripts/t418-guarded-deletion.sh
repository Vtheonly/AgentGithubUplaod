#!/bin/bash
# T-418 Phase 1 — GUARDED branch-ref deletion per ADR-028 rule 2:
#   A ref may be deleted ONLY when (freshly re-verified, after fetch --prune):
#     1. tip is ancestor of origin/main  (merge-base --is-ancestor)
#     2. zero unique commits             (rev-list --count origin/main..ref = 0)
#   Any branch failing either check is SKIPPED and reported (never force-deleted).
# Post-deletion: ls-remote census + main SHA invariance proof.
set -u
cd /home/z/my-project/repos/AgentGithubUplaod || exit 1

echo "=== PRE-DELETION: fresh fetch + full re-census ==="
git fetch origin --prune 2>&1 | grep -v "^$" | head -5
MAIN_SHA_BEFORE=$(git rev-parse origin/main)
echo "origin/main before deletions: $MAIN_SHA_BEFORE"
echo ""

DELETED=0; SKIPPED=0; SKIP_LIST=""
for b in $(git branch -r | grep -v HEAD | sed 's/ *//' | grep -v 'origin/main$'); do
  name=${b#origin/}
  # Re-verify containment RIGHT NOW (per ADR-028 rule 2)
  if git merge-base --is-ancestor "$b" origin/main 2>/dev/null && \
     [ "$(git rev-list --count origin/main..$b 2>/dev/null)" = "0" ]; then
    echo "DELETE: $name (verified ancestor + 0 unique)"
    if git push origin --delete "$name" 2>&1 | grep -qE "deleted|- \[deleted\]"; then
      DELETED=$((DELETED+1))
    else
      echo "  !! push --delete failed for $name — re-checking remote state"
      # Retry via direct refspec (some git versions print differently)
      if git push origin --delete "refs/heads/$name" >/dev/null 2>&1; then
        DELETED=$((DELETED+1))
      else
        echo "  !! STILL FAILED for $name — skipping"
        SKIPPED=$((SKIPPED+1)); SKIP_LIST="$SKIP_LIST $name"
      fi
    fi
  else
    echo "SKIP (NOT VERIFIABLY MERGED): $name"
    SKIPPED=$((SKIPPED+1)); SKIP_LIST="$SKIP_LIST $name"
  fi
done

echo ""
echo "=== POST-DELETION census ==="
git fetch origin --prune 2>&1 | tail -2
MAIN_SHA_AFTER=$(git rev-parse origin/main)
echo "deleted: $DELETED | skipped: $SKIPPED ($SKIP_LIST)"
echo "origin/main before: $MAIN_SHA_BEFORE"
echo "origin/main after : $MAIN_SHA_AFTER"
if [ "$MAIN_SHA_BEFORE" = "$MAIN_SHA_AFTER" ]; then
  echo "INVARIANCE PROOF: main's SHA unchanged by the deletions ✓ (refs are labels, not history)"
else
  echo "!! MAIN MOVED — a concurrent push landed; re-fetch and investigate before proceeding"
fi
echo ""
echo "=== Remaining remote heads (hub) ==="
git ls-remote --heads origin | awk '{print $2}'
