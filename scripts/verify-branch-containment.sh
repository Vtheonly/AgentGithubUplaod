#!/bin/bash
# Deep verification that every branch's unique work is contained in main (both repos)
# Checks: (1) tip is ancestor, (2) zero unique commits, (3) file-level: every file the branch's
# merge-base diff touched still exists in main OR was deliberately evolved (report only).
cd /home/z/my-project/repos/AgentGithubUplaod || exit 1
MAIN=origin/main

echo "=== DEEP VERIFICATION: every branch's changes contained in main ==="
echo ""
TOTAL=0; PROBLEMS=0
for b in $(git branch -r | grep -v HEAD | sed 's/ *//' | grep -v 'origin/main$'); do
  name=${b#origin/}
  TOTAL=$((TOTAL+1))
  # 1. ancestor check
  git merge-base --is-ancestor "$b" $MAIN 2>/dev/null && anc="OK" || anc="FAIL"
  # 2. unique commits check
  uniq=$(git rev-list --count $MAIN..$b)
  # 3. files changed by branch relative to merge-base with main
  MB=$(git merge-base $MAIN $b)
  files=$(git diff --name-only $MB $b | wc -l)
  # 4. Of those files, how many paths no longer exist in main's tree?
  missing=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! git cat-file -e "${MAIN}:${f}" 2>/dev/null; then
      missing=$((missing+1))
    fi
  done < <(git diff --name-only $MB $b)
  status="OK"
  [ "$anc" = "FAIL" ] && { status="NOT-ANCESTOR"; PROBLEMS=$((PROBLEMS+1)); }
  [ "$uniq" != "0" ] && { status="HAS-UNIQUE-COMMITS"; PROBLEMS=$((PROBLEMS+1)); }
  printf "%-45s ancestor=%-4s unique_commits=%s branch_files=%-4s paths_gone_in_main=%s\n" "$name" "$anc" "$uniq" "$files" "$missing"
done
echo ""
echo "TOTAL branches checked: $TOTAL | hard problems: $PROBLEMS"
