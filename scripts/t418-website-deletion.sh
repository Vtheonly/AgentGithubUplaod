#!/bin/bash
# T-418 Phase 1 (website) — guarded deletion of the 3 merged refs, same ADR-028 rule 2 protocol
set -u
cd /home/z/my-project/repos/elimtiyaz-website || exit 1

echo "=== PRE-DELETION: fresh fetch + re-census (website) ==="
git fetch origin --prune 2>&1 | tail -2
MAIN_SHA_BEFORE=$(git rev-parse origin/main)
echo "origin/main before: $MAIN_SHA_BEFORE"

DELETED=0; SKIPPED=0
for b in $(git branch -r | grep -v HEAD | sed 's/ *//' | grep -v 'origin/main$'); do
  name=${b#origin/}
  if git merge-base --is-ancestor "$b" origin/main 2>/dev/null && \
     [ "$(git rev-list --count origin/main..$b 2>/dev/null)" = "0" ]; then
    echo "DELETE: $name (verified ancestor + 0 unique)"
    if git push origin --delete "$name" >/dev/null 2>&1; then
      DELETED=$((DELETED+1))
    else
      echo "  !! failed: $name"
      SKIPPED=$((SKIPPED+1))
    fi
  else
    echo "SKIP (NOT VERIFIABLY MERGED): $name"
    SKIPPED=$((SKIPPED+1))
  fi
done

echo ""
echo "=== POST-DELETION census (website) ==="
git fetch origin --prune 2>&1 | tail -1
MAIN_SHA_AFTER=$(git rev-parse origin/main)
echo "deleted: $DELETED | skipped: $SKIPPED"
echo "main before: $MAIN_SHA_BEFORE | after: $MAIN_SHA_AFTER"
[ "$MAIN_SHA_BEFORE" = "$MAIN_SHA_AFTER" ] && echo "INVARIANCE PROOF: main unchanged ✓"
echo ""
echo "=== Remaining remote heads (website) ==="
git ls-remote --heads origin | awk '{print $2}'
