#!/bin/bash
# For each branch: find the merge commit that brought it into main (if any),
# and list the files the branch introduced/changed vs its fork point.
cd /home/z/my-project/repos/AgentGithubUplaod || exit 1
MAIN=origin/main

echo "=== MERGE-COMMIT MAP (how each branch entered main) ==="
for b in $(git branch -r | grep -v HEAD | sed 's/ *//' | grep -v 'origin/main$'); do
  name=${b#origin/}
  tip=$(git rev-parse "$b")
  # find merge commits in main's history whose second parent is the branch tip (exact tip merge)
  exact=$(git log --merges --format='%h %s' $MAIN | head -400 | while read -r line; do
    h=$(echo "$line" | awk '{print $1}')
    # check parents
    p2=$(git rev-parse "$h^2" 2>/dev/null)
    if [ "$p2" = "$tip" ]; then echo "$line"; break; fi
  done)
  if [ -n "$exact" ]; then
    printf "%-45s MERGED-AT: %s\n" "$name" "$(echo $exact | cut -c1-90)"
  else
    # branch tip reached main via direct push / fast-forward? Check if tip is on main first-parent path
    printf "%-45s (tip reached main without a merge commit — direct/FF)\n" "$name"
  fi
done
